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
import { formatSchemaErrors, isRecognizedSchema, validatePluginManifest } from './validate.js'
import { EXTENSION_NAMESPACE, NAMESPACE_SCHEMA_VERSIONS, V1_IGNORED_MANIFEST_KEYS, type ManifestKind } from '../model/layouts.js'
import type { HarnessMcpPolicy, HarnessNamespace, SuiteManifest, SuiteComponents } from '../model/types.js'
import { PLUGIN_LAYOUTS, MANIFEST_ALIASES, MARKETPLACE_PATHS } from '../model/layouts.js'

export type { ManifestKind } from '../model/layouts.js'

/** One manifest candidate: its file path and the dialect it selects. */
export interface ManifestCandidate {
  kind: ManifestKind
  path: string
}

/**
 * Every manifest file a directory carries, in selection order: highest
 * precedence first, aliases of one dialect in their own listed order.
 */
export async function detectManifests(dir: string): Promise<ManifestCandidate[]> {
  const found: ManifestCandidate[] = []
  for (const { kind, manifest } of PLUGIN_LAYOUTS) {
    for (const relative of [...(MANIFEST_ALIASES[kind] ?? []), manifest]) {
      const path = join(dir, relative)
      if (await isFile(path)) found.push({ kind, path })
    }
  }
  return found
}

/** The highest-precedence manifest file a directory carries, if any. */
export async function detectManifest(dir: string): Promise<ManifestCandidate | undefined> {
  return (await detectManifests(dir))[0]
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
  extensions?: unknown
}

export function componentDeclarations(record: object): SuiteComponents {
  const value = record as Record<string, unknown>
  return Object.fromEntries(['skills', 'commands', 'agents', 'hooks', 'mcpServers', 'lspServers'].filter(key => value[key] !== undefined).map(key => [key, value[key]]))
}

/**
 * Read a suite manifest by walking the layout priority list from the top.
 *
 * A candidate that cannot be parsed or validated fails closed *for itself*:
 * its diagnostics are recorded and the next candidate by priority is tried.
 * Diagnostics of a rejected candidate that a lower-priority manifest replaced
 * go to `fallbacks`, so the winner stays usable while the caller can still
 * report why the higher-priority declaration was ignored. The winner's own
 * diagnostics stay in `errors` and remain fatal.
 *
 * `notes` carries the winner's non-fatal diagnostics — §5.2 unknown
 * top-level fields, §8.1 extension data problems. Callers surface them
 * without failing the suite.
 */
export async function readManifest(
  root: string,
  errors: string[],
  hint: ({ name?: string; version?: string; description?: string } & SuiteComponents) | undefined,
  fallbacks: string[] = [],
  notes: string[] = []
): Promise<SuiteManifest | undefined> {
  const candidates = await detectManifests(root)
  for (const [index, candidate] of candidates.entries()) {
    const attempt: string[] = []
    const attemptNotes: string[] = []
    const manifest = await readOneManifest(root, candidate, attempt, hint, attemptNotes)
    if (manifest !== undefined) {
      errors.push(...attempt)
      notes.push(...attemptNotes)
      return manifest
    }
    if (index === candidates.length - 1) errors.push(...attempt)
    else fallbacks.push(...attempt)
  }
  return undefined
}

/** Parse one manifest candidate; undefined when this candidate is unusable. */
async function readOneManifest(
  root: string,
  candidate: ManifestCandidate,
  errors: string[],
  hint: ({ name?: string; version?: string; description?: string } & SuiteComponents) | undefined,
  notes: string[] = []
): Promise<SuiteManifest | undefined> {
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
  // v1 validation verdicts split per §5.2: fatal violations reject this
  // candidate (the next one by priority is tried), ignored violations —
  // unknown top-level fields and the whole `extensions` subtree — are
  // reported through `notes` and the manifest keeps loading.
  const verdict = kind === 'agent-plugin-v1' ? await validatePluginManifest(raw) : undefined
  if (verdict !== undefined && verdict.fatal.length > 0) {
    errors.push(...formatSchemaErrors(verdict.fatal).map(problem => `${candidate.path}: ${problem}`))
    return undefined
  }
  const ignored: string[] = verdict === undefined ? [] : formatSchemaErrors(verdict.ignored)
  if (kind === 'agent-plugin-v1') {
    // §5.2 / §6.1: the portable manifest carries no component configuration
    // and no client semantics beyond `extensions`; every inline key this
    // manager would otherwise read is an unknown top-level field here.
    for (const key of V1_IGNORED_MANIFEST_KEYS) {
      if ((raw as Record<string, unknown>)[key] !== undefined) ignored.push(`${key}: not part of the portable manifest; ignored`)
    }
  }
  notes.push(...ignored.map(problem => `${candidate.path}: ${problem}`))
  const harness = kind === 'agent-plugin-v1' ? parseHarnessExtension(record['extensions'], notes) : undefined
  const name = pickString(record.name) ?? hint?.name ?? syntheticManifestName(root)
  const version = pickString(record.version) ?? hint?.version
  const description = pickString(record.description) ?? hint?.description
  const author = record.author as { name?: string; url?: string } | undefined
  return {
    components: {
      ...(kind === 'agent-plugin-v1' ? {} : componentDeclarations(hint ?? {})),
      ...fallbackComponents,
      ...(kind === 'agent-plugin-v1' ? {} : componentDeclarations(raw))
    },
    ...(typeof (raw as Record<string, unknown>).skillInstructions === 'string' && kind !== 'agent-plugin-v1'
      ? { skillInstructions: (raw as Record<string, unknown>).skillInstructions as string }
      : {}),
    ...(typeof (raw as Record<string, unknown>).systemPrompt === 'string' && kind !== 'agent-plugin-v1'
      ? { systemPrompt: (raw as Record<string, unknown>).systemPrompt as string }
      : {}),
    ...(typeof (raw as Record<string, unknown>).systemPromptPath === 'string' && kind !== 'agent-plugin-v1'
      ? { systemPromptPath: (raw as Record<string, unknown>).systemPromptPath as string }
      : {}),
    ...(kind !== 'agent-plugin-v1' && typeof (raw as { sessionStart?: { skill?: unknown } }).sessionStart?.skill === 'string'
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
    ...(isRecognizedSchema(record.$schema) ? { schemaVersion: record.$schema as string } : {}),
    ...(harness === undefined ? {} : { harness })
  }
}

/**
 * Read this client's §8.1 extension data from a v1 manifest's `extensions`
 * object. Unknown namespaces are ignored without validating their contents
 * (§8.1); our own namespace is validated against the namespace contract, and
 * an unusable value is reported through `notes` instead of failing the
 * plugin.
 *
 * @returns the parsed namespace data, or undefined when the suite declares
 *   none; diagnostics land in `notes`.
 */
function parseHarnessExtension(extensions: unknown, notes: string[]): HarnessNamespace | undefined {
  if (!isRecord(extensions) || extensions[EXTENSION_NAMESPACE] === undefined) return undefined
  return parseHarnessNamespace(extensions[EXTENSION_NAMESPACE], notes)
}

/** Validate one namespace value against the namespace contract; diagnostics go to `notes`. */
function parseHarnessNamespace(value: unknown, notes: string[]): HarnessNamespace | undefined {
  if (!isRecord(value)) {
    notes.push(`extensions.${EXTENSION_NAMESPACE}: value must be an object; ignored`)
    return undefined
  }
  const schemaVersion = value['schemaVersion']
  if (typeof schemaVersion !== 'string' || !NAMESPACE_SCHEMA_VERSIONS.has(schemaVersion)) {
    notes.push(
      `extensions.${EXTENSION_NAMESPACE}: unsupported or missing schemaVersion ${JSON.stringify(schemaVersion)}; supported: ${[...NAMESPACE_SCHEMA_VERSIONS].join(', ')}; namespace extensions are ignored`
    )
    return undefined
  }
  const policies: Record<string, HarnessMcpPolicy> = Object.create(null) as Record<string, HarnessMcpPolicy>
  const rawPolicies = value['mcpServers']
  if (rawPolicies !== undefined) {
    if (!isRecord(rawPolicies)) {
      notes.push(`extensions.${EXTENSION_NAMESPACE}.mcpServers: value must be an object; ignored`)
      return { schemaVersion, mcpServers: policies }
    }
    for (const [name, policy] of Object.entries(rawPolicies)) {
      if (!isRecord(policy)) {
        notes.push(`extensions.${EXTENSION_NAMESPACE}.mcpServers.${name}: policy must be an object; ignored`)
        continue
      }
      const auth = policy['auth']
      if (
        auth !== undefined &&
        (!isRecord(auth) || (auth['enabled'] !== undefined && typeof auth['enabled'] !== 'boolean') || (auth['scope'] !== undefined && typeof auth['scope'] !== 'string'))
      ) {
        notes.push(`extensions.${EXTENSION_NAMESPACE}.mcpServers.${name}.auth: invalid auth declaration; ignored`)
        continue
      }
      const enabledTools = optionalStringArray(policy['enabledTools'], `extensions.${EXTENSION_NAMESPACE}.mcpServers.${name}.enabledTools`, notes)
      const disabledTools = optionalStringArray(policy['disabledTools'], `extensions.${EXTENSION_NAMESPACE}.mcpServers.${name}.disabledTools`, notes)
      const startupTimeoutMs = optionalPositiveNumber(policy['startupTimeoutMs'], `extensions.${EXTENSION_NAMESPACE}.mcpServers.${name}.startupTimeoutMs`, notes)
      const toolCallTimeoutMs = optionalPositiveNumber(policy['toolCallTimeoutMs'], `extensions.${EXTENSION_NAMESPACE}.mcpServers.${name}.toolCallTimeoutMs`, notes)
      policies[name] = {
        ...(enabledTools === undefined ? {} : { enabledTools }),
        ...(disabledTools === undefined ? {} : { disabledTools }),
        ...(startupTimeoutMs === undefined ? {} : { startupTimeoutMs }),
        ...(toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs }),
        ...(auth === undefined || !isRecord(auth) ? {} : { auth: { enabled: auth['enabled'] !== false, ...(typeof auth['scope'] === 'string' ? { scope: auth['scope'] } : {}) } })
      }
    }
  }
  return { schemaVersion, mcpServers: policies }
}

function optionalStringArray(value: unknown, label: string, notes: string[]): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string')) {
    notes.push(`${label}: must be an array of strings; ignored`)
    return undefined
  }
  return value
}

function optionalPositiveNumber(value: unknown, label: string, notes: string[]): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    notes.push(`${label}: must be a positive number; ignored`)
    return undefined
  }
  return value
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
    const soleEntry = entries.length === 1 ? entries[0] : undefined
    if (soleEntry !== undefined) {
      // A single-suite marketplace: the plugin entry names the repo (vercel → vercel-plugin).
      const entryName = pickString(soleEntry.name)
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
