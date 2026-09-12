/**
 * Scan strategies and the marketplace-entry handler chain.
 *
 * Three filters answer the source scan question, most specific first
 * (classloader-style parent-first delegation):
 *
 * 1. `MarketplaceStrategy` — a Claude Code (`.claude-plugin/`) or Codex
 *    (`.agents/plugins/`) marketplace manifest. Dialects are tried in
 *    precedence order and each must prove productive (≥1 suite) before it
 *    wins, so a shadowed dialect can still carry the scan when the
 *    higher-precedence one yields nothing. Marketplace entries resolve
 *    through a per-entry handler chain: local paths, self-references
 *    (the entry points back at this very source), and remote references
 *    (URL or GitHub `repo` shorthand). Unclaimed entries are diagnosed,
 *    never silently dropped.
 * 2. `RootedStrategy` — nested plugin roots carrying a suite manifest or
 *    skill files, up to four levels deep.
 * 3. `FlatCollectionsStrategy` — the terminal fallback: manifest-less
 *    `<root>/<name>/SKILL.md` collections.
 */
import { realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isWithin, sanitizeId } from './paths.js'
import { isDirectory, isFile, listChildDirs } from './fs-probes.js'
import type { DiscoveredSuite, SuiteComponents, SuiteDimension, SuiteManifest } from '../model/types.js'
import { componentDeclarations, hasSuiteManifest, readManifest, readMarketplaces, syntheticManifestName, type MarketplaceEntry } from './manifests.js'
import { countSurfaces, discoverMcp, discoverSkills, listMdFiles } from './surfaces.js'
import { discoverMarkdownResources, isUnknownArray } from './component-files.js'
import { discoverSuiteHooks, discoverSuiteLsp, discoverSystemPrompt } from './suite-components.js'
import type { ScanChain, ScanContext, ScanFilter, ScanResolution, ScanResult } from './scan-pipeline.js'
import { runScanChain } from './scan-pipeline.js'

const CONTAINER_DIRS = ['plugins', 'external_plugins', 'skills'] as const

export interface SuiteHint extends SuiteComponents {
  layout?: import('../model/layouts.js').ManifestKind
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

// ---------------------------------------------------------------------------
// Marketplace entry resolution: a handler chain over entry `source` shapes.
// ---------------------------------------------------------------------------

/** Normalized resolution of one marketplace entry inside its checkout. */
export type EntryResolution = { kind: 'local'; dir: string } | { kind: 'remote'; url: string } | { kind: 'unclaimed'; reason: string } | { kind: 'rejected'; reason: string }

interface EntryContext {
  checkout: string
  entry: MarketplaceEntry
}

interface EntryChain {
  next(context: EntryContext): EntryResolution | Promise<EntryResolution>
}

/** One handler in the marketplace-entry chain. */
export interface EntryHandler {
  name: string
  handle(context: EntryContext, chain: EntryChain): EntryResolution | Promise<EntryResolution>
}

/**
 * Canonical `https://host/owner/repo` form of a git URL, for equality
 * comparisons between a source's configured URL and an entry's remote.
 */
export function canonicalGitUrl(url: string): string {
  let value = url.trim()
  // scp-like ssh shorthand: git@github.com:owner/repo(.git)
  const scp = /^git@([^:/]+):(.+)$/.exec(value)
  if (scp !== null) value = `https://${scp[1]}/${scp[2]}`
  value = value.replace(/^ssh:\/\//, 'https://').replace(/^git:\/\//, 'https://')
  try {
    const parsed = new URL(value)
    const path = decodeURIComponent(parsed.pathname)
      .replace(/\/+$/, '')
      .replace(/\.git$/, '')
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`
  } catch {
    // Not an absolute URL; normalize the trailing bits only.
    return value.replace(/\/+$/, '').replace(/\.git$/, '')
  }
}

/** GitHub shorthand `{ source: 'github', repo: 'owner/repo' }` → web URL. */
function githubRepoUrl(record: Record<string, unknown>): string | undefined {
  if (record['source'] !== 'github' && record['source'] !== 'github-release') return undefined
  if (typeof record['repo'] !== 'string' || record['repo'] === '') return undefined
  return `https://github.com/${record['repo']}`
}

/** The remote URL an entry points at, across every dialect's shape. */
export function entryRemoteUrl(entry: MarketplaceEntry): string | undefined {
  if (typeof entry.source === 'string') return undefined
  if (entry.source === null || typeof entry.source !== 'object') return undefined
  const record = entry.source as Record<string, unknown>
  if (typeof record['url'] === 'string' && record['url'] !== '') return record['url']
  return githubRepoUrl(record)
}

async function claimLocal(checkout: string, declaredPath: string): Promise<EntryResolution> {
  const dir = resolve(checkout, declaredPath)
  // Containment guard: a relative entry must stay inside the checkout.
  if (!isWithin(checkout, dir)) {
    // `rejected`: the handler positively identified a local path, but the
    // path escapes the checkout. Its verdict is authoritative — later
    // handlers must not reinterpret it as something else.
    return { kind: 'rejected', reason: `path "${declaredPath}" escapes the checkout` }
  }
  try {
    const [realCheckout, realDir] = await Promise.all([realpath(checkout), realpath(dir)])
    if (!isWithin(realCheckout, realDir)) {
      return { kind: 'rejected', reason: `path "${declaredPath}" escapes the checkout through a symlink` }
    }
  } catch {
    return { kind: 'rejected', reason: `path "${declaredPath}" is missing or unreadable` }
  }
  return { kind: 'local', dir }
}

function unclaimed(reason: string): EntryResolution {
  return { kind: 'unclaimed', reason }
}

/** String source: a checkout-relative path (Claude Code `"./skills/x"` form). */
const STRING_PATH_HANDLER: EntryHandler = {
  name: 'local-string-path',
  async handle(context): Promise<EntryResolution> {
    const source = context.entry.source
    if (typeof source !== 'string') return unclaimed('source is not a path string')
    return claimLocal(context.checkout, source)
  }
}

/** Object source with `path`: Codex `{ source: 'local', path }` and Claude `{ path }`. */
const OBJECT_PATH_HANDLER: EntryHandler = {
  name: 'local-object-path',
  async handle(context): Promise<EntryResolution> {
    const source = context.entry.source
    if (source === null || typeof source !== 'object') return unclaimed('source is not an object')
    const record = source as Record<string, unknown>
    if (entryRemoteUrl(context.entry) !== undefined) return unclaimed('path belongs to a remote source')
    if (typeof record['path'] !== 'string' || record['path'] === '') return unclaimed('object source carries no path')
    return claimLocal(context.checkout, record['path'])
  }
}

/** Remote entries: `{ url }` (Claude/Codex) and `{ source: 'github', repo }` shorthand. */
const REMOTE_URL_HANDLER: EntryHandler = {
  name: 'remote-url',
  handle(context): EntryResolution {
    const url = entryRemoteUrl(context.entry)
    if (url === undefined) return unclaimed('source carries no resolvable remote url or repo')
    return { kind: 'remote', url }
  }
}

const ENTRY_HANDLERS: readonly EntryHandler[] = [STRING_PATH_HANDLER, OBJECT_PATH_HANDLER, REMOTE_URL_HANDLER]

/**
 * Resolve one marketplace entry's source against its checkout. Self-
 * references (an entry pointing back at this very source, as Claude Code
 * ships for single-repo marketplaces) resolve to the local checkout so the
 * repo's own manifest and surfaces are scanned directly.
 */
export async function resolveMarketplaceEntry(checkout: string, entry: MarketplaceEntry, sourceUrl: string | undefined): Promise<EntryResolution> {
  const remoteUrl = entryRemoteUrl(entry)
  if (sourceUrl !== undefined && remoteUrl !== undefined && canonicalGitUrl(remoteUrl) === canonicalGitUrl(sourceUrl) && (await isDirectory(checkout))) {
    const source = entry.source
    return typeof source === 'object' && source !== null && typeof source.path === 'string' ? claimLocal(checkout, source.path) : { kind: 'local', dir: checkout }
  }
  let lastReason = 'no handler claimed the entry'
  for (const handler of ENTRY_HANDLERS) {
    const resolution = await handler.handle({ checkout, entry }, { next: () => unclaimed(lastReason) })
    if (resolution.kind === 'rejected') return resolution
    if (resolution.kind !== 'unclaimed') return resolution
    lastReason = resolution.reason
  }
  return { kind: 'unclaimed', reason: lastReason }
}

// ---------------------------------------------------------------------------
// Marketplace strategy
// ---------------------------------------------------------------------------

/** Read one checkout through marketplace manifests, dialect by dialect. */
export class MarketplaceStrategy implements ScanFilter {
  readonly name = 'marketplace'

  async doScan(context: ScanContext, chain: ScanChain): Promise<ScanResolution> {
    const marketplaces = await readMarketplaces(context.checkout, context.notes)
    for (const marketplace of marketplaces) {
      const roots = await this.marketplaceRoots(context, marketplace.entries)
      if (roots.length === 0) {
        context.notes.push(`marketplace ${marketplace.path}: no entry resolved (all ${marketplace.entries.length} dropped or remote)`)
        continue
      }
      const resolved = await readSuites(roots, context)
      if (resolved.length === 0) {
        context.notes.push(`marketplace ${marketplace.path}: every resolved entry failed to parse a manifest`)
        continue
      }
      // A productive dialect wins; supplement with containers it did not list.
      context.marketplacePath = marketplace.path
      for (const container of CONTAINER_DIRS) {
        const containerDir = join(context.checkout, container)
        if (!(await isDirectory(containerDir))) continue
        for (const child of await listChildDirs(containerDir)) {
          if (roots.some(root => root.dir === child) || !(await hasSuiteManifest(child))) continue
          const extra = await readSuite(child, context.sourceId, context.dimension, undefined, context.notes)
          if (extra !== undefined) resolved.push(extra)
        }
      }
      return { kind: 'resolved', suites: resolved }
    }
    if (marketplaces.length > 0) {
      context.notes.push('no marketplace dialect produced suites; falling through to rooted discovery')
    }
    return chain.next(context)
  }

  private async marketplaceRoots(context: ScanContext, entries: readonly MarketplaceEntry[]): Promise<SuiteRoot[]> {
    const roots: SuiteRoot[] = []
    const seen = new Set<string>()
    for (const entry of entries) {
      const hint: SuiteHint = {
        ...componentDeclarations(entry),
        layout: entry.layout,
        name: entry.name,
        version: entry.version,
        description: entry.description,
        // Claude Code declares LSP servers inline on the marketplace entry
        // (typescript-lsp & co. ship no manifest at all).
        ...(entry.lspServers !== undefined ? { lspServers: entry.lspServers } : {})
      }
      const resolution = await resolveMarketplaceEntry(context.checkout, entry, context.sourceUrl)
      if (resolution.kind === 'unclaimed' || resolution.kind === 'rejected') {
        context.notes.push(`marketplace entry "${String(entry.name ?? '<unnamed>')}": ${resolution.reason}`)
        continue
      }
      if (resolution.kind === 'remote') {
        const entryName = typeof entry.name === 'string' && entry.name !== '' ? entry.name : resolution.url
        // Dedupe by entry name, not URL: one remote repo can host several
        // plugins that each appear as their own marketplace entry.
        if (entryName !== undefined && !seen.has(entryName)) {
          roots.push({ hint, remoteUrl: resolution.url })
          seen.add(entryName)
        }
        continue
      }
      roots.push(...(await collectRoots(resolution.dir, hint, seen)))
    }
    return roots
  }
}

// ---------------------------------------------------------------------------
// Rooted and flat-collection strategies
// ---------------------------------------------------------------------------

/** Read nested plugin roots up to four levels deep. */
export class RootedStrategy implements ScanFilter {
  readonly name = 'rooted'

  async doScan(context: ScanContext, chain: ScanChain): Promise<ScanResolution> {
    if (await hasSuiteManifest(context.checkout)) {
      const suite = await readSuite(context.checkout, context.sourceId, context.dimension, undefined, context.notes)
      return suite === undefined ? chain.next(context) : { kind: 'resolved', suites: [suite] }
    }
    const found = await collectRoots(context.checkout, undefined, new Set())
    if (found.length === 0) return chain.next(context)
    const resolved = await readSuites(found, context)
    return resolved.length === 0 ? chain.next(context) : { kind: 'resolved', suites: resolved }
  }
}

/** Terminal fallback: manifest-less flat `<child>/SKILL.md` collections. */
export class FlatCollectionsStrategy implements ScanFilter {
  readonly name = 'flat-collections'

  async doScan(context: ScanContext): Promise<ScanResolution> {
    // A declared suite has already been evaluated by rooted discovery.
    // Reinterpreting its children would bypass a rejected manifest.
    if (await hasSuiteManifest(context.checkout)) return { kind: 'resolved', suites: [] }
    const collection: SuiteRoot[] = []
    for (const child of await listChildDirs(context.checkout)) {
      if (await hasSkillFiles(child)) collection.push({ dir: child })
    }
    if (collection.length === 0) {
      context.notes.push('checkout declares no recognizable plugin shape')
      return { kind: 'resolved', suites: [] }
    }
    const suites = await readSuites(collection, context)
    return { kind: 'resolved', suites }
  }
}

/** The default chain, most specific first with a terminal fallback. */
export function defaultScanFilters(): readonly ScanFilter[] {
  return [new MarketplaceStrategy(), new RootedStrategy(), new FlatCollectionsStrategy()]
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Scan one checkout through the filter chain with full diagnostics. */
export async function scanSource(checkoutDir: string, sourceId: string, dimension: SuiteDimension, sourceUrl?: string): Promise<ScanResult> {
  return runScanChain(defaultScanFilters(), { checkout: checkoutDir, sourceId, dimension, ...(sourceUrl !== undefined ? { sourceUrl } : {}), notes: [] })
}

// ---------------------------------------------------------------------------
// Shared root/manifest plumbing
// ---------------------------------------------------------------------------

/**
 * Materialize resolved suite roots into suites: a remote root becomes a
 * metadata-only suite, a local root that fails to parse drops out.
 */
async function readSuites(roots: readonly SuiteRoot[], context: ScanContext): Promise<DiscoveredSuite[]> {
  const suites = await Promise.all(
    roots.map(root =>
      root.dir === undefined
        ? Promise.resolve(remoteSuite(context.sourceId, context.dimension, root))
        : readSuite(root.dir, context.sourceId, context.dimension, root.hint, context.notes)
    )
  )
  return suites.filter((suite): suite is DiscoveredSuite => suite !== undefined)
}

/**
 * Collect nested plugin roots up to four levels deep. Sibling subtrees are
 * traversed concurrently (readdir/stat are I/O-bound); results concat in
 * deterministic lexicographic order because each level maps children in
 * order before flattening.
 */
async function collectRoots(dir: string, hint: SuiteHint | undefined, seen: Set<string>, depth = 0): Promise<SuiteRoot[]> {
  if (depth > 4 || seen.has(dir)) return []
  // An entry carrying inline LSP declarations is a suite by declaration alone
  // (official CC lsp plugins ship only a README), but only at the marketplace
  // entry root — never deeper, so containers cannot self-declare.
  if ((await hasSuiteManifest(dir)) || (await hasSkillFiles(dir)) || (hint !== undefined && Object.keys(componentDeclarations(hint)).length > 0 && depth === 0)) {
    seen.add(dir)
    return [{ dir, hint }]
  }
  const children = await listChildDirs(dir)
  const nested = await Promise.all(children.map(child => collectRoots(child, hint, seen, depth + 1)))
  return nested.flat()
}

/** Whether a directory carries skill files in the flat or bundled shape. */
export async function hasSkillFiles(dir: string): Promise<boolean> {
  if (await isFile(join(dir, 'SKILL.md'))) return true
  const skillsDir = join(dir, 'skills')
  if (!(await isDirectory(skillsDir))) return false
  if ((await listMdFiles(skillsDir)).length > 0) return true
  for (const child of await listChildDirs(skillsDir)) {
    if (await isFile(join(child, 'SKILL.md'))) return true
  }
  return false
}

/** Read one suite root into the normalized shape, or undefined when no manifest parses. */
export async function readSuite(
  root: string,
  sourceId: string,
  dimension: SuiteDimension,
  hint: SuiteHint | undefined,
  notes: string[] = []
): Promise<DiscoveredSuite | undefined> {
  const errors: string[] = []
  const declaredManifest = await hasSuiteManifest(root)
  let manifest = declaredManifest ? await readManifest(root, errors, hint) : await syntheticManifest(root)
  if (declaredManifest && (manifest === undefined || errors.length > 0)) {
    notes.push(...errors, `suite ${root}: rejected declared manifest`)
    return undefined
  }
  // A declaration-only suite (official CC lsp plugins ship just a README):
  // the marketplace entry's inline lspServers are its manifest.
  if (manifest === undefined && hint !== undefined && Object.keys(componentDeclarations(hint)).length > 0) {
    const name = hint.name ?? syntheticManifestName(root)
    manifest = {
      layout: hint.layout ?? 'claude-code',
      components: componentDeclarations(hint),
      path: '',
      id: sanitizeId(name),
      name,
      ...(hint.version === undefined ? {} : { version: hint.version }),
      ...(hint.description === undefined ? {} : { description: hint.description })
    }
  }
  if (manifest === undefined) return undefined
  let declared = manifest.components?.skills
  if (declared !== undefined && (manifest.layout === 'claude-code' || manifest.layout === 'codex') && (await isDirectory(join(root, 'skills')))) {
    declared = ['skills', ...(isUnknownArray(declared) ? declared : [declared])]
  }
  const skills = await discoverSkills(root, errors, declared)
  if (manifest.layout === 'skill-collection' && skills.length === 0) {
    notes.push(...errors)
    return undefined
  }
  const mcp = await discoverMcp(root, errors, manifest)
  // Effective component declarations include marketplace fallbacks and manifest overrides.
  const lsp = await discoverSuiteLsp(root, manifest, errors)
  const hooks = await discoverSuiteHooks(root, manifest, errors)
  const resources = {
    commands: await discoverMarkdownResources(
      root,
      'commands',
      manifest.components?.commands,
      manifest.path,
      errors,
      manifest.layout === 'cursor' ? ['.md', '.mdc', '.markdown', '.txt'] : ['.md']
    ),
    agents: await discoverMarkdownResources(root, 'agents', manifest.components?.agents, manifest.path, errors)
  }
  const systemPrompt = await discoverSystemPrompt(root, manifest, errors)
  const surfaces = await countSurfaces(root, skills, mcp, lsp)
  surfaces.commands = resources.commands.length
  surfaces.agents = resources.agents.length
  surfaces.hooks = Object.values(hooks?.events ?? {}).reduce((count, groups) => count + groups.reduce((sum, group) => sum + group.hooks.length, 0), 0)
  return {
    resources,
    ...(hooks === undefined ? {} : { hooks }),
    ...(systemPrompt === undefined ? {} : { systemPrompt }),
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
function remoteSuite(sourceId: string, dimension: SuiteDimension, root: SuiteRoot): DiscoveredSuite {
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
