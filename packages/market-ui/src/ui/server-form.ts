import type { ServerPolicyPayload } from '../../../market-contracts/src/contracts/market.js'

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

/** The same drafts, read off a document's policy half. */
export function policyDraftOfDocument(policy: Record<string, unknown>): ServerPolicyDraft {
  // A string is what the user typed and could not be parsed yet; it comes back
  // as written so the field keeps showing it.
  const text = (value: unknown): string => (typeof value === 'number' || typeof value === 'string' ? String(value) : '')
  return { toolCallTimeoutMs: text(policy['toolCallTimeoutMs']), startupTimeoutMs: text(policy['startupTimeoutMs']) }
}

/**
 * Write the timeout drafts back into a document's policy half. An emptied field
 * asks for inheritance, which the document spells `null` — the value the save
 * route reads as "clear what was stored". An unparsable draft is left alone:
 * the editor's validity signal blocks that save instead of rewriting the value.
 */
export function policyDocumentOfDraft(policy: Record<string, unknown>, draft: ServerPolicyDraft): Record<string, unknown> {
  const next = { ...policy }
  for (const [field, raw] of [
    ['toolCallTimeoutMs', draft.toolCallTimeoutMs],
    ['startupTimeoutMs', draft.startupTimeoutMs]
  ] as const) {
    const value = timeoutMsFromText(raw)
    if (value === undefined) {
      // A draft the field cannot parse is kept as typed, so the user sees what
      // they wrote and the save is what refuses it.
      next[field] = raw
      continue
    }
    if (value === null) {
      // An empty field asks for inheritance. A field that held nothing keeps
      // holding nothing; one that held a value records the clear.
      if (field in policy) next[field] = null
      else delete next[field]
      continue
    }
    next[field] = value
  }
  return next
}

/**
 * The policy half of one save: only the entries the user changed, because a
 * value edited on one backend must not ride along to another, where the same
 * value can be refused. A key dropped from the document asks for inheritance,
 * which the route reads as `null`.
 */
export function policyRequestOfDocuments(initial: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown> {
  const request: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(current)) {
    if (JSON.stringify(value) !== JSON.stringify(initial[field])) request[field] = value
  }
  for (const field of Object.keys(initial)) {
    if (!(field in current)) request[field] = null
  }
  return request
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

/**
 * Read one pasted block into rows.
 *
 * The two separators that appear in MCP documentation are `=` and `:`, taking
 * whichever comes first on a line, and values arrive quoted about as often as
 * not — so a pasted `"KEY": "value"` lands as a full row instead of one long
 * value. A list (arguments) keeps whole lines.
 */
export function rowsFromPastedText(text: string, map: boolean): Array<[string, string]> {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')
  if (!map) return lines.map(line => ['', line] as [string, string])
  const rows: Array<[string, string]> = []
  for (const line of lines) {
    const equals = line.indexOf('=')
    const colon = line.indexOf(':')
    const separator = equals === -1 ? colon : colon === -1 ? equals : Math.min(equals, colon)
    if (separator <= 0) continue
    const key = stripQuotes(line.slice(0, separator).trim())
    if (key === '') continue
    rows.push([key, stripQuotes(line.slice(separator + 1).trim())])
  }
  return rows
}

/** Drop one pair of matching quotes, the shape a value is copied in. */
function stripQuotes(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) return value.slice(1, -1)
  return value
}

/** The namespace seat this client's own per-server policy rides. */
export const HARNESS_NAMESPACE = 'com.deepseek.harness'

/** One service's editable document: the portable definition plus this client's policy. */
export interface ServerDocument {
  config: Record<string, unknown>
  policy: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

/**
 * Read one service document: the definition under `mcpServers`, and this
 * client's policy under the `com.deepseek.harness` namespace — the two seats
 * the Agent Plugins specification gives a portable `mcp.json` and its client
 * extension. Keyed documents must contain exactly the service being edited;
 * a missing or additional service key is rejected instead of discarded. The
 * policy half is optional. An empty `key` reads a standalone definition.
 */
export function parseServerDocument(text: string, key: string): ServerDocument {
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Configuration must be a JSON object')
  const record = parsed as Record<string, unknown>
  if (key === '') return { config: record, policy: {} }
  const servers = asRecord(record['mcpServers'])
  const config = asRecord(servers?.[key])
  if (config === undefined || Object.keys(servers!).some(name => name !== key))
    throw new Error(`mcpServers must contain only the service key "${key}"; restore that key before editing the name`)
  const namespace = asRecord(record[HARNESS_NAMESPACE])
  const policies = asRecord(namespace?.['mcpServers'])
  if (policies !== undefined && Object.keys(policies).some(name => name !== key)) throw new Error(`MCP policy must use the service key "${key}"`)
  const policy = asRecord(policies?.[key]) ?? {}
  return { config, policy }
}

/**
 * Write the document back in the shape the specification seats it in. Without a
 * declaration key the definition is the whole document: wrapping it under an
 * empty `mcpServers` key would store a nested document as the service.
 */
export function composeServerDocument(key: string, config: Record<string, unknown>, policy: Record<string, unknown>): string {
  if (key === '') return JSON.stringify(config, null, 2)
  const document: Record<string, unknown> = { mcpServers: { [key]: config } }
  if (Object.keys(policy).length > 0) document[HARNESS_NAMESPACE] = { mcpServers: { [key]: policy } }
  return JSON.stringify(document, null, 2)
}

/**
 * The policy half of a document, built from what the user stored. Suite
 * declarations stay out: the editor shows them as the value in force, and a
 * document that repeated them would invite an edit the client cannot honour.
 */
export function serverPolicyDocument(policy: ServerPolicyPayload | undefined): Record<string, unknown> {
  if (policy === undefined) return {}
  const document: Record<string, unknown> = {}
  if (policy.toolCallTimeout.user !== null) document['toolCallTimeoutMs'] = policy.toolCallTimeout.user
  if (policy.startupTimeout.user !== null) document['startupTimeoutMs'] = policy.startupTimeout.user
  if (policy.deniedTools.user !== null) document['disabledTools'] = policy.deniedTools.user
  if (policy.auth.user !== null) document['auth'] = { enabled: policy.auth.user }
  return document
}

/**
 * Fold the API's field list into the map an editor renders. The first path
 * segment names the editor field; a nested key rides along with it, so a
 * rejected header lands on the headers field.
 */
export function fieldErrorsOf(reason: unknown): Record<string, string> | undefined {
  const fields = (reason as { fields?: unknown }).fields
  if (!Array.isArray(fields)) return undefined
  const map: Record<string, string> = {}
  for (const entry of fields) {
    if (typeof entry !== 'object' || entry === null) continue
    const { field, message } = entry as { field?: unknown; message?: unknown }
    if (typeof field !== 'string' || field === '' || typeof message !== 'string') continue
    const key = field.split('.')[0] ?? field
    map[key] = map[key] === undefined ? message : `${map[key]}; ${message}`
  }
  return Object.keys(map).length === 0 ? undefined : map
}
