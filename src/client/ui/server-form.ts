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

/** One starting point offered by the new-service dialog. */
export interface McpTemplate {
  id: string
  /** Locale key holding the template's display name. */
  labelKey: 'mcpTemplateFilesystem' | 'mcpTemplateMemory' | 'mcpTemplateFetch' | 'mcpTemplateContext7' | 'mcpTemplateGithub'
  /** The server definition the template fills in. */
  config: ServerConfig
}

/**
 * Common MCP services, in the three shapes a new service takes: a local
 * process with no credential, a local process behind one, and a remote
 * endpoint behind one. The GitHub entry points at the vendor's remote server
 * because the old npm package is no longer maintained.
 */
export const MCP_TEMPLATES: McpTemplate[] = [
  { id: 'filesystem', labelKey: 'mcpTemplateFilesystem', config: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] } },
  { id: 'memory', labelKey: 'mcpTemplateMemory', config: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] } },
  { id: 'fetch', labelKey: 'mcpTemplateFetch', config: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] } },
  {
    id: 'context7',
    labelKey: 'mcpTemplateContext7',
    config: { type: 'streamable-http', url: 'https://mcp.context7.com/mcp', headers: { Authorization: 'Bearer ${CONTEXT7_API_KEY}' } }
  },
  {
    id: 'github',
    labelKey: 'mcpTemplateGithub',
    config: { type: 'streamable-http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' } }
  }
]

/**
 * Read one pasted configuration: a whole `mcpServers` map (its first entry
 * supplies the name), or a bare server definition. Claude-shaped files spell
 * the remote transport `http` and a stdio server `local`; a definition that
 * carries no transport is read from its command or url. The result is a form
 * document, not a validated server — the save path still validates it.
 */
/** Normalize one pasted definition: Claude-shaped aliases and an inferred transport. */
export function normalizePastedServer(body: unknown): ServerConfig {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('Configuration must be a JSON object')
  const config = { ...(body as Record<string, unknown>) }
  if (config['type'] === 'local') config['type'] = 'stdio'
  if (config['type'] === 'http') config['type'] = 'streamable-http'
  if (config['type'] === undefined) {
    if (typeof config['command'] === 'string') config['type'] = 'stdio'
    else if (typeof config['url'] === 'string' || typeof config['httpUrl'] === 'string') config['type'] = 'streamable-http'
  }
  if (config['type'] !== 'stdio' && config['url'] === undefined && typeof config['httpUrl'] === 'string') {
    config['url'] = config['httpUrl']
    delete config['httpUrl']
  }
  return config
}

/**
 * Read every server out of one pasted document: an `mcpServers` map (each key
 * becomes the service name) or a bare definition (which carries no name).
 */
export function parsePastedServers(text: string): Array<{ name?: string; config: ServerConfig }> {
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Configuration must be a JSON object')
  const record = parsed as Record<string, unknown>
  const servers = record['mcpServers']
  if (typeof servers === 'object' && servers !== null && !Array.isArray(servers)) {
    const entries = Object.entries(servers as Record<string, unknown>)
    if (entries.length === 0) throw new Error('mcpServers is empty')
    return entries.map(([name, body]) => ({ name, config: normalizePastedServer(body) }))
  }
  return [{ config: normalizePastedServer(record) }]
}

/** The first server of a pasted document, for filling the form rather than importing. */
export function parsePastedServer(text: string): { name?: string; config: ServerConfig } {
  const [first] = parsePastedServers(text)
  if (first === undefined) throw new Error('mcpServers is empty')
  return first
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
