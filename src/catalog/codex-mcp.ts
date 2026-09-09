/** Codex TOML MCP tables normalize into the existing transport and credential contracts. */
import type { McpServer, McpServerPolicy } from '../model/types.js'
import { PLUGIN_DATA_VARIABLES, PLUGIN_ROOT_VARIABLES } from '../model/layouts.js'

const FIELDS = new Set([
  'command',
  'args',
  'env',
  'env_vars',
  'cwd',
  'url',
  'http_headers',
  'env_http_headers',
  'bearer_token_env_var',
  'enabled',
  'enabled_tools',
  'disabled_tools',
  'startup_timeout_sec',
  'startup_timeout_ms',
  'tool_timeout_sec'
])
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`)
  return value
}
function strings(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error(`${field} must be an array of strings`)
  return value as string[]
}
function table(value: unknown, field: string): Record<string, string> {
  if (value === undefined) return {}
  if (!record(value) || !Object.values(value).every(item => typeof item === 'string')) throw new Error(`${field} must be a string table`)
  return value as Record<string, string>
}
function reference(value: unknown, field: string): string {
  const name = text(value, field)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || PLUGIN_ROOT_VARIABLES.has(name) || PLUGIN_DATA_VARIABLES.has(name))
    throw new Error(`${field} must name a non-reserved environment variable`)
  return `\${${name}}`
}
function timeout(value: unknown, field: string, factor: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value * factor > 2_147_483_647)
    throw new Error(`${field} must be a positive finite timeout within the timer range`)
  return Math.max(1, Math.ceil(value * factor))
}

/** Unknown or malformed server options reject that server; other servers stay independently usable. */
export function normalizeCodexMcp(raw: Record<string, unknown>, errors: string[]): Record<string, McpServer> {
  const servers: Record<string, McpServer> = Object.create(null) as Record<string, McpServer>
  for (const [name, value] of Object.entries(raw)) {
    try {
      if (!record(value)) throw new Error('server must be a table')
      if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error('enabled must be a boolean')
      if (value.enabled === false) continue
      const unsupported = Object.keys(value).filter(key => !FIELDS.has(key))
      if (unsupported.length > 0) throw new Error(`unsupported fields: ${unsupported.join(', ')}`)
      const enabledTools = strings(value.enabled_tools, 'enabled_tools')
      const disabledTools = strings(value.disabled_tools, 'disabled_tools')
      const startupTimeoutMs =
        value.startup_timeout_sec === undefined ? timeout(value.startup_timeout_ms, 'startup_timeout_ms', 1) : timeout(value.startup_timeout_sec, 'startup_timeout_sec', 1000)
      const toolCallTimeoutMs = timeout(value.tool_timeout_sec, 'tool_timeout_sec', 1000)
      const policy: McpServerPolicy = {
        ...(enabledTools === undefined ? {} : { enabledTools }),
        ...(disabledTools === undefined ? {} : { disabledTools }),
        ...(startupTimeoutMs === undefined ? {} : { startupTimeoutMs }),
        ...(toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs })
      }
      if (value.command !== undefined) {
        if (['url', 'http_headers', 'env_http_headers', 'bearer_token_env_var'].some(key => value[key] !== undefined))
          throw new Error('HTTP options cannot be combined with a stdio command')
        const inherited = Object.fromEntries((strings(value.env_vars, 'env_vars') ?? []).map(key => [key, reference(key, 'env_vars')]))
        servers[name] = {
          ...policy,
          type: 'stdio',
          command: text(value.command, 'command'),
          args: strings(value.args, 'args') ?? [],
          env: { ...inherited, ...table(value.env, 'env') },
          ...(value.cwd === undefined ? {} : { cwd: text(value.cwd, 'cwd') })
        }
      } else {
        if (['args', 'env', 'env_vars', 'cwd'].some(key => value[key] !== undefined)) throw new Error('stdio options cannot be combined with an HTTP endpoint')
        const url = text(value.url, 'url')
        if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error('url must use HTTP or HTTPS')
        const headers = {
          ...table(value.http_headers, 'http_headers'),
          ...Object.fromEntries(Object.entries(table(value.env_http_headers, 'env_http_headers')).map(([key, variable]) => [key, reference(variable, 'env_http_headers')]))
        }
        if (value.bearer_token_env_var !== undefined) {
          if (Object.keys(headers).some(key => key.toLowerCase() === 'authorization')) throw new Error('bearer_token_env_var conflicts with an Authorization header')
          headers.Authorization = `Bearer ${reference(value.bearer_token_env_var, 'bearer_token_env_var')}`
        }
        servers[name] = { ...policy, type: 'streamable-http', url, headers }
      }
    } catch (error) {
      errors.push(`Codex MCP server "${name}": ${error instanceof Error ? error.message : 'invalid configuration'}`)
    }
  }
  return servers
}
