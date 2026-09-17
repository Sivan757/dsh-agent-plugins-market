import type { ServerPolicyRequest } from '../../contracts/market.js'

export type ServerKind = 'mcp' | 'lsp'
export type ServerConfig = Record<string, unknown>

/** The largest timeout a bridge config and the host timer can hold. */
export const TIMEOUT_MAX_MS = 2_147_483_647

/**
 * The two timeouts as the editor holds them: raw millisecond text, where an
 * empty field means "inherit". They sit outside the JSON document because the
 * portable server shape has no seat for them.
 */
export interface ServerPolicyDraft {
  toolCallTimeoutMs: string
  startupTimeoutMs: string
}

/**
 * Read one timeout field: empty inherits (`null`), a positive whole number of
 * milliseconds within the timer range is the value, and anything else is
 * `undefined`, which leaves the editor unsaveable.
 */
export function timeoutMsFromText(raw: string): number | null | undefined {
  const text = raw.trim()
  if (text === '') return null
  if (!/^\d+$/.test(text)) return undefined
  const value = Number(text)
  return Number.isSafeInteger(value) && value > 0 && value <= TIMEOUT_MAX_MS ? value : undefined
}

/** The stored values as editable text. */
export function policyDraftOf(toolCall: number | null, startup: number | null): ServerPolicyDraft {
  return { toolCallTimeoutMs: toolCall === null ? '' : String(toolCall), startupTimeoutMs: startup === null ? '' : String(startup) }
}

/**
 * The policy request for one save: only the timeouts whose text moved from the
 * loaded baseline. A value the user edited on one backend therefore never rides
 * along to another, where the same value can be refused.
 */
export function policyRequestOf(draft: ServerPolicyDraft | undefined, initial: ServerPolicyDraft | undefined): ServerPolicyRequest | undefined {
  if (draft === undefined || initial === undefined) return undefined
  const request: ServerPolicyRequest = {}
  if (draft.toolCallTimeoutMs !== initial.toolCallTimeoutMs) {
    const value = timeoutMsFromText(draft.toolCallTimeoutMs)
    if (value !== undefined) request.toolCallTimeoutMs = value
  }
  if (draft.startupTimeoutMs !== initial.startupTimeoutMs) {
    const value = timeoutMsFromText(draft.startupTimeoutMs)
    if (value !== undefined) request.startupTimeoutMs = value
  }
  return Object.keys(request).length === 0 ? undefined : request
}

export function parseServerConfig(text: string): ServerConfig {
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object')
  return value as ServerConfig
}

/** Switching transport removes only transport-specific fields; all unrelated keys survive edits. */
export function changeTransport(config: ServerConfig, type: string): ServerConfig {
  const next: ServerConfig = { ...config, type }
  if (type === 'stdio') {
    delete next['url']
    delete next['headers']
    delete next['auth']
  } else {
    delete next['command']
    delete next['args']
    delete next['env']
    delete next['cwd']
  }
  return next
}

export function serverFormCompatible(config: ServerConfig, kind: ServerKind): boolean {
  const isMap = (value: unknown): boolean =>
    value === undefined || (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string'))
  if (!['command', 'url', 'cwd'].every(key => config[key] === undefined || typeof config[key] === 'string')) return false
  if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some(value => typeof value !== 'string'))) return false
  if (!isMap(config.env) || !isMap(config.headers) || !isMap(config.extensionToLanguage)) return false
  if (kind === 'mcp' && config.type !== undefined && (typeof config.type !== 'string' || !['stdio', 'streamable-http', 'sse'].includes(config.type))) return false
  if (config.auth !== undefined && (config.auth === null || typeof config.auth !== 'object' || Array.isArray(config.auth))) return false
  const auth = config.auth as Record<string, unknown> | undefined
  if (auth?.enabled !== undefined && typeof auth.enabled !== 'boolean') return false
  if (auth?.scope !== undefined && typeof auth.scope !== 'string') return false
  return true
}
