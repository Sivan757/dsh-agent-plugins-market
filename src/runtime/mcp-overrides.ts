/**
 * MCP server overrides: user-owned edits layered over a suite's read-only
 * `mcp.json`.
 *
 * The suite's mcp.json is source-controlled content — editing it in place
 * would be clobbered by the next refresh and would blur authorship. Overrides
 * live in `${dataRoot}/overrides/<suiteId>.json` and win at mount time.
 * Editable scope is deliberate: connection inputs (`url`, `headers`, `env`,
 * `args`) and enable/disable are local-adaptation concerns; transport type,
 * command, and the derived serverName stay source-owned so mounts stay
 * coherent across refreshes. Secret values should reference the process
 * environment through `${NAME}` placeholders so keys never persist in plain
 * text.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { McpServerStreamableHttp, McpServerStdio } from '../model/types.js'

/** Per-server override record; absent fields pass through from the source. */
export type McpServerOverride = {
  /** Disabled servers are not mounted at all (default enabled). */
  enabled?: boolean
  /** Replaces the source URL (streamable-http only). */
  url?: string
  /** Replaces the whole header map (streamable-http only). */
  headers?: Record<string, string>
  /** Replaces the whole env map (stdio). */
  env?: Record<string, string>
  /** Replaces the whole args list (stdio). */
  args?: string[]
}

/** Overrides for one suite, keyed by mcp.json server key. */
export type McpSuiteOverrides = Record<string, McpServerOverride>

/** The overrides directory under the plugin data root. */
export function overridesDir(dataRoot: string): string {
  return join(dataRoot, 'overrides')
}

/** One suite's override file path. */
export function suiteOverridePath(dataRoot: string, suiteId: string): string {
  return join(overridesDir(dataRoot), `${sanitizeFileName(suiteId)}.json`)
}

/** Load one suite's persisted overrides; unreadable files yield none. */
export async function loadSuiteOverrides(dataRoot: string, suiteId: string): Promise<McpSuiteOverrides> {
  try {
    const raw: unknown = JSON.parse(await readFile(suiteOverridePath(dataRoot, suiteId), 'utf8'))
    if (typeof raw !== 'object' || raw === null) return {}
    const parsed = sanitizeOverrides(raw)
    return parsed
  } catch {
    return {}
  }
}

/** Persist one suite's overrides atomically-ish (single writer, small file). */
export async function saveSuiteOverrides(dataRoot: string, suiteId: string, overrides: McpSuiteOverrides): Promise<void> {
  const path = suiteOverridePath(dataRoot, suiteId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8')
}

/** Keep only recognized fields with correct shapes; drop everything else. */
export function sanitizeOverrides(raw: unknown): McpSuiteOverrides {
  if (typeof raw !== 'object' || raw === null) return {}
  const result: McpSuiteOverrides = {}
  for (const [serverKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const record = value as Record<string, unknown>
    const override: McpServerOverride = {}
    if (typeof record['enabled'] === 'boolean') override.enabled = record['enabled']
    if (typeof record['url'] === 'string' && record['url'] !== '') override.url = record['url']
    const headers = stringMap(record['headers'])
    if (headers !== undefined) override.headers = headers
    const env = stringMap(record['env'])
    if (env !== undefined) override.env = env
    if (Array.isArray(record['args']) && record['args'].every(entry => typeof entry === 'string')) {
      override.args = record['args'] as string[]
    }
    if (Object.keys(override).length > 0) result[serverKey] = override
  }
  return result
}

/** Validate a client-supplied patch for one server into an override value. */
export function sanitizeOverridePatch(patch: unknown): McpServerOverride | undefined {
  return sanitizeOverrides({ server: patch })['server']
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') continue
    result[key] = entry
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Apply one server's overrides onto its source shape. Field replacement is
 * whole-map (headers/env/args), never per-key merge, so removing a key in the
 * UI actually removes it at mount time. Values pass through the ordinary
 * mount-time placeholder pipeline afterwards, so override authors may
 * reference secrets as `${NAME}` or `${NAME:-fallback}` (resolved from the
 * process environment in memory) instead of persisting them here.
 */
export function applyOverride(server: McpServerStdio | McpServerStreamableHttp, override: McpServerOverride | undefined): McpServerStdio | McpServerStreamableHttp {
  if (override === undefined) return server
  if (server.type === 'stdio') {
    return {
      ...server,
      ...(override.args !== undefined ? { args: override.args } : {}),
      ...(override.env !== undefined ? { env: override.env } : {})
    }
  }
  return {
    ...server,
    ...(override.url !== undefined ? { url: override.url } : {}),
    ...(override.headers !== undefined ? { headers: override.headers } : {})
  }
}

function sanitizeFileName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]+/g, '_')
}
