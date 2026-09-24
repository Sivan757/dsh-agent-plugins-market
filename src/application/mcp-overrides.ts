/**
 * MCP server overrides: user-owned edits layered over a suite's read-only
 * `mcp.json`.
 *
 * The suite's mcp.json is source-controlled content — editing it in place
 * would be clobbered by the next refresh and would blur authorship. Overrides
 * live in `${dataRoot}/overrides/<suiteId>.json` and win at mount time.
 * Legacy patches edit connection inputs and enablement; the service editor
 * stores a validated complete configuration while retaining server identity.
 * Secret values should use `${NAME}` references
 * resolved by the Host credentials service (or launch-environment fallback)
 * so keys never persist in plain text.
 */
import { join } from 'node:path'
import { readJsonFile, writeJsonDocument } from '../application/json-file.js'
import { isSensitiveKey } from './mcp-redaction.js'
import type { McpServerSse, McpServerStreamableHttp, McpServerStdio } from '../model/types.js'

/** HTTP-shaped server sources (url + headers carriers) overrides can edit. */
type McpServerHttp = McpServerStreamableHttp | McpServerSse

/** The largest timeout a bridge config and the host timer can hold. */
export const MAX_TIMEOUT_MS = 2_147_483_647

/** Per-server override record; absent fields pass through from the source. */
export type McpServerOverride = {
  /** Validated complete user configuration, retaining source-owned identity. */
  config?: McpServerStdio | McpServerHttp
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
  /** Replaces the OAuth block (streamable-http only); `enabled: false` disables a source-declared flow. */
  auth?: { enabled: boolean; scope?: string }
  /** Per-tool-call timeout in milliseconds; absent inherits the suite's value or the bridge default. */
  toolCallTimeoutMs?: number
  /** Startup timeout in milliseconds; absent inherits the suite's value or the bridge default. */
  startupTimeoutMs?: number
  /** Tool names the user turned off; the suite's own deny list stays in force beside them. */
  disabledTools?: string[]
}

/** Timeout fields a policy save can set (`number`) or clear back to inheritance (`null`). */
export interface McpTimeoutPatch {
  toolCallTimeoutMs?: number | null
  startupTimeoutMs?: number | null
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
    const raw = await readJsonFile(suiteOverridePath(dataRoot, suiteId))
    if (typeof raw !== 'object' || raw === null) return {}
    const parsed = sanitizeOverrides(raw)
    return parsed
  } catch {
    return {}
  }
}

/** Persist one suite's overrides through the harness atomic write. */
export async function saveSuiteOverrides(dataRoot: string, suiteId: string, overrides: McpSuiteOverrides): Promise<void> {
  await writeJsonDocument(suiteOverridePath(dataRoot, suiteId), overrides)
}

/** Keep only recognized fields with correct shapes; drop everything else. */
export function sanitizeOverrides(raw: unknown): McpSuiteOverrides {
  if (typeof raw !== 'object' || raw === null) return {}
  const result: McpSuiteOverrides = {}
  for (const [serverKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const record = value as Record<string, unknown>
    const override: McpServerOverride = {}
    if (typeof record['config'] === 'object' && record['config'] !== null) override.config = record['config'] as McpServerStdio | McpServerHttp
    if (typeof record['enabled'] === 'boolean') override.enabled = record['enabled']
    if (typeof record['url'] === 'string' && record['url'] !== '') override.url = record['url']
    const headers = stringMap(record['headers'])
    if (headers !== undefined) override.headers = headers
    const auth = sanitizeAuth(record['auth'])
    if (auth !== undefined) override.auth = auth
    const env = stringMap(record['env'])
    if (env !== undefined) override.env = env
    if (Array.isArray(record['args']) && record['args'].every(entry => typeof entry === 'string')) {
      override.args = record['args']
    }
    const toolCallTimeoutMs = timeoutMs(record['toolCallTimeoutMs'])
    if (toolCallTimeoutMs !== undefined) override.toolCallTimeoutMs = toolCallTimeoutMs
    const startupTimeoutMs = timeoutMs(record['startupTimeoutMs'])
    if (startupTimeoutMs !== undefined) override.startupTimeoutMs = startupTimeoutMs
    const disabledTools = toolNames(record['disabledTools'])
    if (disabledTools !== undefined) override.disabledTools = disabledTools
    if (Object.keys(override).length > 0) result[serverKey] = override
  }
  return result
}

/**
 * Keep a timeout that a millisecond count can hold. Anything else passes
 * nothing through, so one malformed field cannot take the rest of the record
 * with it.
 */
function timeoutMs(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > MAX_TIMEOUT_MS) return undefined
  return raw
}

/**
 * Keep a tool-name list for a deny list: non-empty names, deduplicated, with
 * the empty result reading as "nothing denied" so the field never persists as
 * an empty array.
 */
function toolNames(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const names = [...new Set(raw.filter((entry): entry is string => typeof entry === 'string' && entry !== ''))]
  return names.length > 0 ? names : undefined
}

/** Keep a well-formed auth block; anything else passes nothing through. */
function sanitizeAuth(raw: unknown): { enabled: boolean; scope?: string } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  if (typeof record['enabled'] !== 'boolean') return undefined
  return {
    enabled: record['enabled'],
    ...(typeof record['scope'] === 'string' && record['scope'] !== '' ? { scope: record['scope'] } : {})
  }
}

/** Validate a client-supplied patch for one server into an override value. */
export function sanitizeOverridePatch(patch: unknown): McpServerOverride | undefined {
  if (typeof patch === 'object' && patch !== null && 'config' in patch) return undefined
  if (containsLiteralSensitiveValue(patch)) return undefined
  return sanitizeOverrides({ server: patch })['server']
}

/**
 * Validate one policy save as it arrives over the wire. An absent field leaves
 * its stored value alone, `null` clears one back to inheritance, and a positive
 * whole number of milliseconds within the timer range sets it; anything else
 * rejects the save with a readable reason.
 */
export function parseTimeoutPatch(raw: unknown): McpTimeoutPatch {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('policy must be an object')
  const record = raw as Record<string, unknown>
  return {
    ...(record['toolCallTimeoutMs'] === undefined ? {} : { toolCallTimeoutMs: timeoutField(record['toolCallTimeoutMs'], 'tool call timeout') }),
    ...(record['startupTimeoutMs'] === undefined ? {} : { startupTimeoutMs: timeoutField(record['startupTimeoutMs'], 'startup timeout') })
  }
}

/** The client policy a service-config save may carry alongside the definition. */
export interface McpPolicyPatch {
  toolCallTimeoutMs?: number | null
  startupTimeoutMs?: number | null
  /** The user's deny list; null clears it, an absent field keeps it. */
  disabledTools?: string[] | null
  /** The user's OAuth opt-in; null clears it, an absent field keeps it. */
  auth?: { enabled: boolean; scope?: string } | null
}

/**
 * Validate a client-supplied policy patch. An absent field keeps its stored
 * value, `null` clears it back to the suite's declaration or the default, and
 * any other shape is rejected with the reason it failed.
 */
export function parseMcpPolicyPatch(raw: unknown): McpPolicyPatch {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('policy must be an object')
  const record = raw as Record<string, unknown>
  const patch: McpPolicyPatch = {}
  if (record['toolCallTimeoutMs'] !== undefined) patch.toolCallTimeoutMs = timeoutField(record['toolCallTimeoutMs'], 'tool call timeout')
  if (record['startupTimeoutMs'] !== undefined) patch.startupTimeoutMs = timeoutField(record['startupTimeoutMs'], 'startup timeout')
  if (record['disabledTools'] !== undefined) {
    if (record['disabledTools'] === null) patch.disabledTools = null
    else {
      const names = toolNames(record['disabledTools'])
      if (names === undefined && (record['disabledTools'] as unknown[]).length > 0) throw new Error('denied tools must be a list of tool names')
      patch.disabledTools = names ?? []
    }
  }
  if (record['auth'] !== undefined) {
    if (record['auth'] === null) patch.auth = null
    else {
      const auth = sanitizeAuth(record['auth'])
      if (auth === undefined) throw new Error('auth must be an object with a boolean "enabled"')
      patch.auth = auth
    }
  }
  return patch
}

function timeoutField(value: unknown, label: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
    throw new Error(`${label} must be a positive whole number of milliseconds no greater than ${MAX_TIMEOUT_MS}`)
  }
  return value
}

/**
 * Merge one client patch into the override already on disk.
 *
 * The UI redacts secret-shaped values before rendering them, so a patch built
 * from that redacted view must not be written verbatim — that would silently
 * drop keys the user did not intend to change. Existing stored values are
 * therefore preserved and only the fields the patch actually carries replace
 * them.
 */
export function mergeOverridePatch(existing: McpServerOverride, patch: McpServerOverride): McpServerOverride {
  const headers = mergeStringMap(existing.headers, patch.headers)
  const env = mergeStringMap(existing.env, patch.env)
  return {
    ...(existing.config === undefined ? {} : { config: existing.config }),
    enabled: patch.enabled ?? existing.enabled ?? true,
    ...(patch.url !== undefined ? { url: patch.url } : existing.url === undefined ? {} : { url: existing.url }),
    ...(headers === undefined ? {} : { headers }),
    ...(env === undefined ? {} : { env }),
    ...(patch.args !== undefined ? { args: patch.args } : existing.args === undefined ? {} : { args: existing.args }),
    ...(patch.auth !== undefined ? { auth: patch.auth } : existing.auth === undefined ? {} : { auth: existing.auth }),
    ...(patch.toolCallTimeoutMs !== undefined
      ? { toolCallTimeoutMs: patch.toolCallTimeoutMs }
      : existing.toolCallTimeoutMs === undefined
        ? {}
        : { toolCallTimeoutMs: existing.toolCallTimeoutMs }),
    ...(patch.startupTimeoutMs !== undefined
      ? { startupTimeoutMs: patch.startupTimeoutMs }
      : existing.startupTimeoutMs === undefined
        ? {}
        : { startupTimeoutMs: existing.startupTimeoutMs }),
    ...(patch.disabledTools !== undefined ? { disabledTools: patch.disabledTools } : existing.disabledTools === undefined ? {} : { disabledTools: existing.disabledTools })
  }
}

function mergeStringMap(existing: Record<string, string> | undefined, patch: Record<string, string> | undefined): Record<string, string> | undefined {
  if (existing === undefined && patch === undefined) return undefined
  const merged = { ...(existing ?? {}) }
  for (const [key, value] of Object.entries(patch ?? {})) merged[key] = value
  return Object.keys(merged).length > 0 ? merged : undefined
}

function containsLiteralSensitiveValue(value: unknown, key = ''): boolean {
  if (isSensitiveKey(key) && typeof value === 'string') return !value.includes('${')
  if (Array.isArray(value)) return value.some(item => containsLiteralSensitiveValue(item, key))
  if (typeof value === 'object' && value !== null)
    return Object.entries(value as Record<string, unknown>).some(([childKey, childValue]) => containsLiteralSensitiveValue(childValue, childKey))
  return false
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
 * reference secrets as `${NAME}` or `${NAME:-fallback}` (resolved through the
 * Host credentials service or launch environment in memory) instead of
 * persisting them here.
 */
export function applyOverride(server: McpServerStdio | McpServerHttp, override: McpServerOverride | undefined): McpServerStdio | McpServerHttp {
  if (override === undefined) return server
  const policy = policyFields(override)
  if (override.config !== undefined) server = override.config
  if (server.type === 'stdio') {
    return {
      ...server,
      ...policy,
      ...(override.args !== undefined ? { args: override.args } : {}),
      ...(override.env !== undefined ? { env: override.env } : {})
    }
  }
  return {
    ...server,
    ...policy,
    ...(override.url !== undefined ? { url: override.url } : {}),
    ...(override.headers !== undefined ? { headers: override.headers } : {}),
    ...(override.auth !== undefined ? { auth: override.auth } : {})
  }
}

/** The user-owned policy fields of one override, in server shape. */
function policyFields(override: McpServerOverride): Record<string, unknown> {
  return {
    ...(override.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: override.toolCallTimeoutMs }),
    ...(override.startupTimeoutMs === undefined ? {} : { startupTimeoutMs: override.startupTimeoutMs }),
    ...(override.disabledTools === undefined ? {} : { disabledTools: override.disabledTools })
  }
}

/**
 * One server with its client policy fields removed: the shape the portable
 * `mcp.json` schema accepts. The service editor renders and saves this shape,
 * so a timeout never reaches a document that has no seat for it.
 */
export function withoutPolicyFields<T extends McpServerStdio | McpServerHttp>(server: T): T {
  const portable = { ...server } as Record<string, unknown>
  delete portable['enabledTools']
  delete portable['disabledTools']
  delete portable['startupTimeoutMs']
  delete portable['toolCallTimeoutMs']
  return portable as T
}

function sanitizeFileName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]+/g, '_')
}
