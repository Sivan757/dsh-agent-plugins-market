/**
 * Manifest layer: detects and parses the suite-manifest dialects a checkout
 * can carry, and resolves a repo-level name for source-id derivation.
 *
 * Dialects (each a JSON document at the suite root):
 * - agent-plugin-v1: root `plugin.json` (agent-plugins.org), schema-validated;
 * - universal: `.plugin/plugin.json`;
 * - claude-code: `.claude-plugin/plugin.json`;
 * - cursor: `.cursor-plugin/plugin.json`;
 * - kimi: `.kimi-plugin/plugin.json`;
 * - codex: `.codex-plugin/plugin.json`.
 *
 * The same repo can declare several dialects (e.g. vercel/vercel-plugin ships
 * all of them); a suite's identity comes from the highest-precedence dialect
 * present, while surfaces (skills/commands/agents/hooks/mcp) are scanned from
 * the directories regardless of which dialect won.
 */
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { sanitizeId } from './paths.js'
import { isRecognizedSchema, validatePluginManifest } from './validate.js'
import type { SuiteManifest } from '../model/types.js'

export type ManifestKind = 'agent-plugin-v1' | 'universal' | 'claude-code' | 'cursor' | 'kimi' | 'codex'

/** One manifest candidate: its file path and the dialect it selects. */
export interface ManifestCandidate {
  kind: ManifestKind
  path: string
}

/** Dialect precedence: v1 wins over universal over claude over cursor over kimi over codex. */
const KIND_PRECEDENCE: ManifestKind[] = ['agent-plugin-v1', 'universal', 'claude-code', 'cursor', 'kimi', 'codex']

const MANIFEST_PATHS: Record<ManifestKind, string> = {
  'agent-plugin-v1': 'plugin.json',
  universal: join('.plugin', 'plugin.json'),
  'claude-code': join('.claude-plugin', 'plugin.json'),
  cursor: join('.cursor-plugin', 'plugin.json'),
  kimi: join('.kimi-plugin', 'plugin.json'),
  codex: join('.codex-plugin', 'plugin.json')
}

/** The highest-precedence manifest file a directory carries, if any. */
export async function detectManifest(dir: string): Promise<ManifestCandidate | undefined> {
  for (const kind of KIND_PRECEDENCE) {
    const path = join(dir, MANIFEST_PATHS[kind])
    try {
      if ((await stat(path)).isFile()) return { kind, path }
    } catch {
      // try the next dialect
    }
  }
  return undefined
}

/** Whether a directory carries any known suite manifest. */
export async function hasSuiteManifest(dir: string): Promise<boolean> {
  return (await detectManifest(dir)) !== undefined
}

/** Fallback suite identity for manifest-less skill collections. */
export function syntheticManifestName(root: string): string {
  return root.split(/[\\/]/).at(-1) ?? 'plugin'
}

interface ParsedRecord {
  name?: unknown
  version?: unknown
  description?: unknown
  author?: unknown
  homepage?: unknown
  keywords?: unknown
  $schema?: unknown
}

/**
 * Parse one manifest document into a normalized SuiteManifest. The v1 dialect
 * is schema-validated (fail-closed); the others are structurally read with
 * light tolerance, and `hint` (a marketplace plugin entry) fills in gaps.
 */
export async function readManifest(
  root: string,
  errors: string[],
  hint: { name?: string; version?: string; description?: string } | undefined
): Promise<SuiteManifest | undefined> {
  const candidate = await detectManifest(root)
  if (candidate === undefined) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(candidate.path, 'utf8'))
  } catch (error) {
    errors.push(`${candidate.path} unparsable: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) {
    errors.push(`${candidate.path}: manifest is not a JSON object`)
    return undefined
  }
  const record = raw as ParsedRecord
  const problems = candidate.kind === 'agent-plugin-v1' ? await validatePluginManifest(raw) : []
  errors.push(...problems.map(problem => `${candidate.path}: ${problem}`))
  const name = pickString(record.name) ?? hint?.name ?? syntheticManifestName(root)
  const version = pickString(record.version) ?? hint?.version
  const description = pickString(record.description) ?? hint?.description
  const author = record.author as { name?: string; url?: string } | undefined
  return {
    layout:
      candidate.kind === 'agent-plugin-v1'
        ? 'agent-plugin-v1'
        : candidate.kind === 'universal'
          ? 'universal'
          : candidate.kind === 'claude-code'
            ? 'claude-code'
            : candidate.kind === 'cursor'
              ? 'cursor'
              : candidate.kind === 'kimi'
                ? 'kimi'
                : 'codex',
    path: candidate.path,
    id: sanitizeId(name),
    name,
    ...(version === undefined ? {} : { version }),
    ...(description === undefined ? {} : { description }),
    ...(author?.name !== undefined ? { author: author.name } : pickString(record.homepage) !== undefined ? { author: pickString(record.homepage) } : {}),
    keywords: Array.isArray(record.keywords) ? (record.keywords as unknown[]).filter((entry): entry is string => typeof entry === 'string') : [],
    ...(isRecognizedSchema(record.$schema) ? { schemaVersion: record.$schema as string } : {})
  }
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export interface MarketplaceEntry {
  name?: string
  version?: string
  description?: string
  /** Claude Code: inline `lspServers` table declared on the entry itself. */
  lspServers?: unknown
  /** Claude Code: a relative path string or `{ source: 'url', url }`.
   *  Codex: `{ source: 'local', path }` or `{ source: 'remote', url }`. */
  source: string | { source?: string; url?: string; path?: string }
}

export interface Marketplace {
  name?: string
  entries: MarketplaceEntry[]
}

/** Marketplace manifest locations per dialect (Claude Code, Codex). */
const MARKETPLACE_PATHS = ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json']

/** Read a marketplace manifest from a checkout root, or undefined when absent. */
export async function readMarketplace(checkoutDir: string): Promise<Marketplace | undefined> {
  for (const relative of MARKETPLACE_PATHS) {
    let text: string
    try {
      text = await readFile(join(checkoutDir, relative), 'utf8')
    } catch {
      continue
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null) continue
      const record = parsed as Record<string, unknown>
      const plugins = record['plugins']
      if (!Array.isArray(plugins)) continue
      return {
        ...(typeof record['name'] === 'string' ? { name: record['name'] } : {}),
        entries: plugins as MarketplaceEntry[]
      }
    } catch {
      continue
    }
  }
  return undefined
}

/** Resolve one marketplace entry to a local checkout-relative directory, or
 *  `undefined` for remote-URL entries that are not present in the clone. */
export function marketplaceEntryDir(checkoutDir: string, entry: MarketplaceEntry): string | undefined {
  const source = entry.source
  if (typeof source === 'string') return resolve(checkoutDir, source)
  if (source?.path !== undefined) return resolve(checkoutDir, source.path)
  return undefined
}

/**
 * Resolve a repo-level name for source-id derivation, in precedence order:
 * marketplace plugin entry name > marketplace name > root manifest name >
 * the checkout basename. The suite repo's own JSON is authoritative; the
 * basename is only the fallback.
 */
export async function repoName(checkoutDir: string): Promise<string> {
  const marketplace = await readMarketplace(checkoutDir)
  if (marketplace !== undefined) {
    const entries = marketplace.entries
    if (entries.length === 1) {
      // A single-suite marketplace: the plugin entry names the repo (vercel → vercel-plugin).
      const entryName = pickString(entries[0]!.name)
      if (entryName !== undefined) return entryName
    }
    const marketplaceName = pickString(marketplace.name)
    if (marketplaceName !== undefined) return marketplaceName
    if (entries.length === 1) {
      const entryName = pickString(entries[0]!.name)
      if (entryName !== undefined) return entryName
    }
  }
  const candidate = await detectManifest(checkoutDir)
  if (candidate !== undefined) {
    try {
      const raw: unknown = JSON.parse(await readFile(candidate.path, 'utf8'))
      if (typeof raw === 'object' && raw !== null) {
        const name = (raw as Record<string, unknown>)['name']
        if (typeof name === 'string' && name !== '') return name
      }
    } catch {
      // fall through to basename
    }
  }
  return syntheticManifestName(checkoutDir)
}

/** The winning manifest's declared `skills` path (string or array), or undefined. */
export async function declaredSkillsPath(root: string): Promise<unknown> {
  const candidate = await detectManifest(root)
  if (candidate === undefined) return undefined
  try {
    const raw: unknown = JSON.parse(await readFile(candidate.path, 'utf8'))
    if (typeof raw === 'object' && raw !== null) {
      return (raw as Record<string, unknown>)['skills']
    }
  } catch {
    return undefined
  }
  return undefined
}

/** The winning manifest's inline `mcpServers`, or undefined. */
export async function declaredMcpServers(root: string): Promise<Record<string, unknown> | undefined> {
  const candidate = await detectManifest(root)
  if (candidate === undefined) return undefined
  try {
    const raw: unknown = JSON.parse(await readFile(candidate.path, 'utf8'))
    if (typeof raw === 'object' && raw !== null) {
      const servers = (raw as Record<string, unknown>)['mcpServers']
      if (typeof servers === 'object' && servers !== null) return servers as Record<string, unknown>
    }
  } catch {
    return undefined
  }
  return undefined
}

/** The winning manifest's inline `lspServers`, or undefined. */
export async function declaredLspServers(root: string): Promise<Record<string, unknown> | undefined> {
  const candidate = await detectManifest(root)
  if (candidate === undefined) return undefined
  try {
    const raw: unknown = JSON.parse(await readFile(candidate.path, 'utf8'))
    if (typeof raw === 'object' && raw !== null) {
      const servers = (raw as Record<string, unknown>)['lspServers']
      if (typeof servers === 'object' && servers !== null) return servers as Record<string, unknown>
    }
  } catch {
    return undefined
  }
  return undefined
}
