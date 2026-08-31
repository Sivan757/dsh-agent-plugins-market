/**
 * Scan one source checkout into normalized suites.
 *
 * This module owns root selection inside one checkout and delegates manifest and
 * surface parsing to the established discovery adapters. Source-list policy
 * (configured, local, and project checkout selection) belongs to source-catalog.
 */
import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { isDirectory, sanitizeId } from './paths.js'
import type { Suite, SuiteDimension, SuiteManifest } from '../model/types.js'
import { declaredSkillsPath, detectManifest, marketplaceEntryDir, readManifest, readMarketplace, repoName, syntheticManifestName, declaredLspServers } from './manifests.js'
import { countSurfaces, discoverLspEntries, discoverMcp, discoverSkills, listMdFiles, type LspEntry } from './surfaces.js'
import { parseLspServers } from './lsp-spec.js'

export { repoName, listMdFiles, discoverLspEntries }
export type { LspEntry }

const CONTAINER_DIRS = ['plugins', 'external_plugins', 'skills'] as const
const DOT_DIRS = new Set(['.git', '.github', '.claude', '.cursor', '.kimi', '.plugin', '.sources', 'node_modules'])

/** Discover every suite under one source checkout. */
export async function discoverSuitesInSource(checkoutDir: string, sourceId: string, dimension: SuiteDimension): Promise<Suite[]> {
  const roots = await suiteRoots(checkoutDir)
  const suites = await Promise.all(roots.map(async root => (root.dir === undefined ? remoteSuite(sourceId, dimension, root) : readSuite(root.dir, sourceId, dimension, root.hint))))
  return suites.filter((suite): suite is Suite => suite !== undefined)
}

interface SuiteHint {
  name?: string
  version?: string
  description?: string
  /** Inline `lspServers` declared on the marketplace entry itself (Claude Code). */
  lspServers?: unknown
}

interface SuiteRoot {
  dir?: string
  hint?: SuiteHint
  remoteUrl?: string
}

/** Resolve all suite roots selected by a marketplace or checkout layout. */
async function suiteRoots(checkoutDir: string): Promise<SuiteRoot[]> {
  const marketplace = await readMarketplace(checkoutDir)
  if (marketplace !== undefined && marketplace.entries.length > 0) {
    const roots: SuiteRoot[] = []
    const seen = new Set<string>()
    for (const entry of marketplace.entries) {
      const hint = {
        name: entry.name,
        version: entry.version,
        description: entry.description,
        // Claude Code declares LSP servers inline on the marketplace entry
        // (typescript-lsp & co. ship no manifest at all).
        ...(entry.lspServers !== undefined ? { lspServers: entry.lspServers } : {})
      }
      const dir = marketplaceEntryDir(checkoutDir, entry)
      if (dir === undefined) {
        const remoteUrl = typeof entry.source === 'object' ? entry.source?.url : undefined
        // Dedupe by entry name, not URL: one remote repo can host several
        // plugins that each appear as their own marketplace entry.
        const entryName = typeof entry.name === 'string' && entry.name !== '' ? entry.name : remoteUrl
        if (remoteUrl !== undefined && entryName !== undefined && !seen.has(entryName)) {
          roots.push({ hint, remoteUrl })
          seen.add(entryName)
        }
        continue
      }
      await collectRoot(dir, hint, roots, seen)
    }
    for (const container of CONTAINER_DIRS) {
      const containerDir = join(checkoutDir, container)
      if (!(await isDirectory(containerDir))) continue
      for (const child of await listChildDirs(containerDir)) {
        if (!seen.has(child) && (await hasSuiteManifest(child))) roots.push({ dir: child })
      }
    }
    return roots
  }
  if (await hasSuiteManifest(checkoutDir)) return [{ dir: checkoutDir }]
  const found: SuiteRoot[] = []
  await collectRoot(checkoutDir, undefined, found, new Set())
  if (found.length > 0) return found
  // Manifest-less skill collection (the flat `<root>/<name>/SKILL.md` shape).
  const collection: SuiteRoot[] = []
  for (const child of await listChildDirs(checkoutDir)) {
    if (await hasSkillFiles(child)) collection.push({ dir: child })
  }
  return collection
}

/** Collect nested plugin roots up to four levels deep. */
async function collectRoot(dir: string, hint: SuiteHint | undefined, out: SuiteRoot[], seen: Set<string>, depth = 0): Promise<void> {
  if (depth > 4 || seen.has(dir)) return
  // An entry carrying inline LSP declarations is a suite by declaration alone
  // (official CC lsp plugins ship only a README), but only at the marketplace
  // entry root — never deeper, so containers cannot self-declare.
  if ((await hasSuiteManifest(dir)) || (await hasSkillFiles(dir)) || (hint?.lspServers !== undefined && depth === 0)) {
    out.push({ dir, hint })
    seen.add(dir)
    return
  }
  for (const child of await listChildDirs(dir)) {
    await collectRoot(child, hint, out, seen, depth + 1)
  }
}

/** Whether a directory carries any known suite manifest. */
async function hasSuiteManifest(dir: string): Promise<boolean> {
  return (await detectManifest(dir)) !== undefined
}

/** Whether a directory carries skill files in the flat or bundled shape. */
async function hasSkillFiles(dir: string): Promise<boolean> {
  if (await isFile(join(dir, 'SKILL.md'))) return true
  const skillsDir = join(dir, 'skills')
  if (!(await isDirectory(skillsDir))) return false
  for (const child of await listChildDirs(skillsDir)) {
    if (await isFile(join(child, 'SKILL.md'))) return true
  }
  return false
}

async function listChildDirs(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter(entry => entry.isDirectory() && !DOT_DIRS.has(entry.name) && !entry.name.startsWith('.')).map(entry => join(dir, entry.name))
}

/** Read one suite root into the normalized shape, or undefined when no manifest parses. */
async function readSuite(root: string, sourceId: string, dimension: SuiteDimension, hint: SuiteHint | undefined): Promise<Suite | undefined> {
  const errors: string[] = []
  let manifest = (await readManifest(root, errors, hint)) ?? (await syntheticManifest(root))
  // A declaration-only suite (official CC lsp plugins ship just a README):
  // the marketplace entry's inline lspServers are its manifest.
  if (manifest === undefined && hint?.lspServers !== undefined) {
    const name = hint.name ?? syntheticManifestName(root)
    manifest = {
      layout: 'claude-code',
      path: '',
      id: sanitizeId(name),
      name,
      ...(hint.version === undefined ? {} : { version: hint.version }),
      ...(hint.description === undefined ? {} : { description: hint.description })
    }
  }
  if (manifest === undefined) return undefined
  const declared = await declaredSkillsPath(root)
  const skills = await discoverSkills(root, errors, declared)
  const mcp = await discoverMcp(root, errors)
  // Inline LSP declarations: the marketplace entry wins over the manifest
  // (Claude Code ships lspServers on the entry), and either is optional.
  const lspRaw = hint?.lspServers ?? (await declaredLspServers(root))
  const lspServers = parseLspServers(lspRaw, errors)
  const lsp = Object.keys(lspServers).length > 0 ? { servers: lspServers } : undefined
  const surfaces = await countSurfaces(root, skills, mcp, lsp)
  return {
    sourceId,
    id: manifest.id,
    root,
    manifest,
    skills,
    ...(mcp === undefined ? {} : { mcp }),
    ...(lsp === undefined ? {} : { lsp }),
    surfaces,
    dimension,
    enabled: false,
    errors
  }
}

/** Metadata-only suite for a marketplace entry whose content is remote. */
function remoteSuite(sourceId: string, dimension: SuiteDimension, root: SuiteRoot): Suite {
  const name = root.hint?.name ?? 'remote-plugin'
  return {
    sourceId,
    id: sanitizeId(name),
    root: '',
    manifest: {
      layout: 'remote',
      path: '',
      id: sanitizeId(name),
      name,
      version: root.hint?.version,
      description: root.hint?.description
    },
    skills: [],
    surfaces: { skills: 0, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: 0 },
    dimension,
    enabled: false,
    remote: { url: root.remoteUrl ?? '' },
    errors: []
  }
}

/** Manifest-less directories still produce a synthetic suite identity. */
async function syntheticManifest(root: string): Promise<SuiteManifest | undefined> {
  if (!(await hasSkillFiles(root))) return undefined
  const name = syntheticManifestName(root)
  return {
    layout: 'skill-collection',
    path: join(root, 'SKILL.md'),
    id: sanitizeId(name),
    name
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Whether a suite root path lies outside the checkout. */
export function isOutside(root: string, candidate: string): boolean {
  return isAbsolute(candidate) ? !candidate.startsWith(root) : false
}
