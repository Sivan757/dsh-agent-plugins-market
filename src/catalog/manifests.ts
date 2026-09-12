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
 * - codex: `.codex-plugin/plugin.json`;
 * - zcode: `.zcode-plugin/plugin.json`;
 * - qoder: `.qoder-plugin/plugin.json`;
 * - github-copilot: `.github/plugin/plugin.json`.
 *
 * The same repo can declare several dialects (e.g. vercel/vercel-plugin ships
 * all of them); a suite's identity comes from the highest-precedence dialect
 * present, while surfaces (skills/commands/agents/hooks/mcp) are scanned from
 * the directories regardless of which dialect won.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeId } from './paths.js'
import { isFile } from './fs-probes.js'
import { isRecord } from './component-files.js'
import { isRecognizedSchema, validatePluginManifest } from './validate.js'
import type { SuiteManifest, SuiteComponents } from '../model/types.js'
import { PLUGIN_LAYOUTS, MANIFEST_ALIASES, MARKETPLACE_PATHS, type ManifestKind } from '../model/layouts.js'

export type { ManifestKind } from '../model/layouts.js'

/** One manifest candidate: its file path and the dialect it selects. */
export interface ManifestCandidate {
  kind: ManifestKind
  path: string
}

/** The highest-precedence manifest file a directory carries, if any. */
export async function detectManifest(dir: string): Promise<ManifestCandidate | undefined> {
  for (const { kind, manifest } of PLUGIN_LAYOUTS) {
    for (const relative of [...(MANIFEST_ALIASES[kind] ?? []), manifest]) {
      const path = join(dir, relative)
      if (await isFile(path)) return { kind, path }
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

export function componentDeclarations(record: object): SuiteComponents {
  const value = record as Record<string, unknown>
  return Object.fromEntries(['skills', 'commands', 'agents', 'hooks', 'mcpServers', 'lspServers'].filter(key => value[key] !== undefined).map(key => [key, value[key]]))
}

/**
 * Parse one manifest document into a normalized SuiteManifest. The v1 dialect
 * is schema-validated (fail-closed); the others are structurally read with
 * light tolerance, and `hint` (a marketplace plugin entry) fills in gaps.
 */
export async function readManifest(
  root: string,
  errors: string[],
  hint: ({ name?: string; version?: string; description?: string } & SuiteComponents) | undefined
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push(`${candidate.path}: manifest is not a JSON object`)
    return undefined
  }
  const record = raw as ParsedRecord
  // The v1 dialect is identified by position AND declaration: the spec's
  // schema requires `$schema`, so a root `plugin.json` without it is not a
  // v1 manifest. Real-world single-repo marketplaces (agent-skills) ship a
  // plain metadata object at the root alongside their Claude dialect
  // manifests; reading that as strict v1 would fail-closed on a repo that
  // is perfectly usable. Such a file is read leniently as the Claude
  // layout instead — strict validation only ever applies to manifests
  // that actually declare the v1 schema.
  const kind: ManifestKind = candidate.kind === 'agent-plugin-v1' && !isRecognizedSchema(record.$schema) ? 'claude-code' : candidate.kind
  let fallbackComponents: SuiteComponents = {}
  if (candidate.kind === 'agent-plugin-v1' && kind === 'claude-code') {
    const path = join(root, '.claude-plugin/plugin.json')
    let text: string | undefined
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`${path}: component fallback is unreadable`)
    }
    if (text !== undefined) {
      try {
        const fallback: unknown = JSON.parse(text)
        if (typeof fallback !== 'object' || fallback === null || Array.isArray(fallback)) errors.push(`${path}: component fallback must be an object`)
        else fallbackComponents = componentDeclarations(fallback)
      } catch {
        errors.push(`${path}: invalid component fallback JSON`)
      }
    }
  }
  const problems = kind === 'agent-plugin-v1' ? await validatePluginManifest(raw) : []
  errors.push(...problems.map(problem => `${candidate.path}: ${problem}`))
  const name = pickString(record.name) ?? hint?.name ?? syntheticManifestName(root)
  const version = pickString(record.version) ?? hint?.version
  const description = pickString(record.description) ?? hint?.description
  const author = record.author as { name?: string; url?: string } | undefined
  return {
    components: { ...componentDeclarations(hint ?? {}), ...fallbackComponents, ...componentDeclarations(raw) },
    ...(typeof (raw as Record<string, unknown>).skillInstructions === 'string' ? { skillInstructions: (raw as Record<string, unknown>).skillInstructions as string } : {}),
    ...(typeof (raw as Record<string, unknown>).systemPrompt === 'string' ? { systemPrompt: (raw as Record<string, unknown>).systemPrompt as string } : {}),
    ...(typeof (raw as Record<string, unknown>).systemPromptPath === 'string' ? { systemPromptPath: (raw as Record<string, unknown>).systemPromptPath as string } : {}),
    ...(typeof (raw as { sessionStart?: { skill?: unknown } }).sessionStart?.skill === 'string'
      ? { startupSkill: (raw as { sessionStart: { skill: string } }).sessionStart.skill }
      : {}),
    layout: kind,
    path: candidate.path,
    id: sanitizeId(name),
    name,
    ...(version === undefined ? {} : { version }),
    ...(description === undefined ? {} : { description }),
    ...(typeof record.author === 'string'
      ? { author: record.author }
      : author?.name !== undefined
        ? { author: author.name }
        : pickString(record.homepage) !== undefined
          ? { author: pickString(record.homepage) }
          : {}),
    keywords: Array.isArray(record.keywords) ? (record.keywords as unknown[]).filter((entry): entry is string => typeof entry === 'string') : [],
    ...(isRecognizedSchema(record.$schema) ? { schemaVersion: record.$schema as string } : {})
  }
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export interface MarketplaceEntry extends SuiteComponents {
  layout?: ManifestKind
  strict?: boolean
  name?: string
  version?: string
  description?: string
  /** Claude Code: inline `lspServers` table declared on the entry itself. */
  lspServers?: unknown
  /** Claude Code: a relative path string, `{ source: 'url', url }`, or the
   *  `{ source: 'github', repo: 'owner/name' }` shorthand.
   *  Codex: `{ source: 'local', path }` or `{ source: 'remote', url }`. */
  source: string | { source?: string; url?: string; path?: string; repo?: string }
}

export interface Marketplace {
  pluginRoot?: string
  name?: string
  entries: MarketplaceEntry[]
}

export interface ReadMarketplaceResult extends Marketplace {
  /** The manifest file the entries were read from. */
  path: string
}

/** Read one marketplace manifest file; malformed documents are diagnosed, not thrown. */
async function readOneMarketplace(path: string, errors: string[]): Promise<ReadMarketplaceResult | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    errors.push(`marketplace ${path} unparsable: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    errors.push(`marketplace ${path}: manifest is not a JSON object`)
    return undefined
  }
  const record = parsed as Record<string, unknown>
  const rawPlugins = record['plugins']
  const plugins: unknown[] | undefined = Array.isArray(rawPlugins)
    ? rawPlugins
    : isRecord(rawPlugins)
      ? Object.entries(rawPlugins).map(([name, entry]) => (isRecord(entry) ? { ...entry, name } : entry))
      : undefined
  if (plugins === undefined) {
    errors.push(`marketplace ${path}: "plugins" is not an array`)
    return undefined
  }
  return {
    ...(typeof (record.metadata as { pluginRoot?: unknown } | undefined)?.pluginRoot === 'string' ? { pluginRoot: (record.metadata as { pluginRoot: string }).pluginRoot } : {}),
    ...(typeof record['name'] === 'string' ? { name: record['name'] } : {}),
    entries: plugins
      .map(entry => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry
        const value = entry as Record<string, unknown>
        if (typeof value.id !== 'string') return value
        const source = [value.source, value.url, value.downloadUrl].find(candidate => typeof candidate === 'string' && candidate.trim() !== '') ?? value.source
        return { ...value, name: value.id, description: value.description ?? value.shortDescription, source, layout: 'kimi' }
      })
      .filter((entry): entry is MarketplaceEntry => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry) || !('source' in entry)) {
          errors.push(`marketplace ${path}: invalid plugin entry`)
          return false
        }
        const metadata = entry as Record<string, unknown>
        if (
          ['name', 'version', 'description'].some(key => metadata[key] !== undefined && typeof metadata[key] !== 'string') ||
          (typeof metadata.name === 'string' && metadata.name.trim() === '')
        ) {
          errors.push(`marketplace ${path}: invalid plugin entry metadata`)
          return false
        }
        return true
      }),
    path
  }
}

/**
 * Read every marketplace manifest the checkout carries, in dialect
 * precedence order shared with suite manifests, then the shared root catalog.
 * The scan strategy selects the first catalog that produces suites; an empty
 * or invalid catalog allows the next candidate to be tried.
 */
export async function readMarketplaces(checkoutDir: string, errors: string[] = []): Promise<ReadMarketplaceResult[]> {
  const results: ReadMarketplaceResult[] = []
  for (const relative of MARKETPLACE_PATHS) {
    const result = await readOneMarketplace(join(checkoutDir, relative), errors)
    if (result !== undefined) {
      const kind = PLUGIN_LAYOUTS.find(layout => layout.marketplaces.some(path => path === relative))?.kind
      for (const entry of result.entries) {
        entry.layout ??= kind
        if (typeof entry.source === 'string' && /^https?:\/\//.test(entry.source)) entry.source = { source: 'url', url: entry.source }
        if (typeof entry.source === 'string' && result.pluginRoot !== undefined && !entry.source.startsWith('.')) entry.source = join(result.pluginRoot, entry.source)
      }
      results.push(result)
    }
  }
  return results
}

/** Read the highest-precedence marketplace manifest, or undefined when absent. */
async function readMarketplace(checkoutDir: string): Promise<Marketplace | undefined> {
  const results = await readMarketplaces(checkoutDir)
  return results[0]
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
      const entryName = pickString(entries[0].name)
      if (entryName !== undefined) return entryName
    }
    const marketplaceName = pickString(marketplace.name)
    if (marketplaceName !== undefined) return marketplaceName
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
