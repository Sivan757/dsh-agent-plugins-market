/**
 * Maps one validated suite `mcp.json` onto self-built bridge config rows.
 *
 * The portable format is translated, not executed directly: stdio commands
 * resolve against the suite root (spec §7.2.1), `${PLUGIN_ROOT}` /
 * `${PLUGIN_DATA}` expand against the suite root and its data directory, and
 * every `${NAME}` — including ones inside a streamable-http `url` — expands
 * through the optional DSH credentials seam at mount time. Legacy HTTP+SSE
 * servers are supported by the market's own bridge (the host client had no
 * such transport); unrecognized shapes are still skipped with a per-server
 * reason.
 */
import { createHash } from 'node:crypto'
import type { Config, SseConfig } from './mcp-client/config.js'
import { DEFAULT_TOOL_CALL_TIMEOUT_MS } from './mcp-client/config.js'
import { resolveCwd } from '../catalog/validate.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import { applyOverride, type McpServerOverride, type McpSuiteOverrides } from './mcp-overrides.js'
import type { McpServer, McpServerSse, McpServerStdio, McpServerStreamableHttp, Suite } from '../model/types.js'
import { PLUGIN_ROOT_VARIABLES, PLUGIN_DATA_VARIABLES } from '../model/layouts.js'

/** The max length the bridge accepts for a serverName. */
const SERVER_NAME_MAX = 32
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g
const BUILTIN_PLACEHOLDERS = new Set([...PLUGIN_ROOT_VARIABLES, ...PLUGIN_DATA_VARIABLES])

export interface McpMountRequest {
  suiteId: string
  serverKey: string
  config: Config
}

/** One `mcp.json` server as it will actually be used, with the user's override applied. */
export interface EffectiveMcpServer {
  serverKey: string
  server: McpServerStdio | McpServerStreamableHttp | McpServerSse
  /** The override that produced this view; consumers render its state from it. */
  override: McpServerOverride | undefined
  /** Whether the server is used at all — an override can disable a declaration without removing it. */
  enabled: boolean
  /** External credential references the effective definition needs. */
  credentialRefs: string[]
}

export type McpMountFailureCode =
  | 'unsupported-transport'
  | 'missing-credential'
  | 'credential-error'
  | 'unmount-failed'
  | 'mount-failed'
  /** The derived serverName's namespace is already mounted by another MCP client — informational, not a failure. */
  | 'foreign-mount'
  /** Another source's identical suite/server pair mounted first — this copy is redundant, informational. */
  | 'duplicate-mount'

export interface McpMountFailure {
  serverKey: string
  reason: string
  code?: McpMountFailureCode
  credentialRefs?: string[]
}

/** Optional DSH credential resolver used while building an in-memory mount. */
export interface McpCredentialResolver {
  resolve(ref: string): Promise<{ value: string; source?: string } | undefined>
}

/**
 * The effective view of one suite's `mcp.json` servers: the user's per-server
 * overrides applied, every row flagged with whether it is used at all, and each
 * row's credential references read off the effective shape. Mounting, status
 * and detail rendering read this one projection, so a server cannot be listed
 * as enabled while mounting something else.
 */
export function effectiveMcpServers(suite: Suite, overrides: McpSuiteOverrides = {}): EffectiveMcpServer[] {
  const rows: EffectiveMcpServer[] = []
  for (const [serverKey, source] of Object.entries(suite.mcp?.servers ?? {})) {
    const override = overrides[serverKey]
    const server = applyOverride(source, override)
    rows.push({ serverKey, server, override, enabled: override?.enabled !== false, credentialRefs: credentialRefsInServer(server) })
  }
  return rows
}

/**
 * Build one mount request per supported mcp.json server, resolving every
 * `${NAME}` through the credential resolver before a child process or HTTP
 * request is created. Missing references fail closed per server instead of
 * becoming empty strings.
 *
 * @param overrides user-owned per-server overrides (url/headers/env/args
 *   replacement plus enable/disable); applied before mount. Disabled servers
 *   are omitted entirely.
 * @returns mount requests, per-server failures, and the credential references
 *   the effective servers need. serverName collisions are reported by the
 *   mount registry, not here.
 */
export async function toMcpMounts(
  suite: Suite,
  pluginDataRoot: string,
  overrides: McpSuiteOverrides = {},
  resolver: McpCredentialResolver = { resolve: async () => undefined }
): Promise<{ mounts: McpMountRequest[]; failures: McpMountFailure[]; credentialRefs: string[] }> {
  if (suite.mcp === undefined) return { mounts: [], failures: [], credentialRefs: [] }
  const mounts: McpMountRequest[] = []
  const failures: McpMountFailure[] = []
  const credentialRefs = new Set<string>()
  for (const row of effectiveMcpServers(suite, overrides)) {
    if (!row.enabled) continue
    for (const ref of row.credentialRefs) credentialRefs.add(ref)
    try {
      const target = suite.mcp.root === undefined ? suite : { ...suite, root: suite.mcp.root }
      const result = await toResolvedMount(target, row.serverKey, row.server, pluginDataRoot, resolver)
      if (result.failure !== undefined) failures.push(result.failure)
      if (result.request !== undefined) mounts.push(result.request)
    } catch {
      failures.push({ serverKey: row.serverKey, code: 'credential-error', credentialRefs: row.credentialRefs, reason: 'credential lookup failed' })
    }
  }
  return { mounts, failures, credentialRefs: [...credentialRefs] }
}

/** Find external credential references used by one MCP server definition. */
export function credentialRefsInServer(server: McpServer): string[] {
  const values: string[] = []
  if (server.type === 'stdio') {
    values.push(...(server.args ?? []), ...(server.cwd === undefined ? [] : [server.cwd]), ...Object.values(server.env ?? {}))
  } else {
    // A remote endpoint may carry the token in the URL query as well as in a
    // header, so both are scanned and both are resolved at mount time.
    values.push(server.url ?? '', ...Object.values(server.headers ?? {}))
  }
  const refs = new Set<string>()
  for (const value of values) {
    for (const match of value.matchAll(PLACEHOLDER)) {
      const name = match[1]
      if (name !== undefined && !BUILTIN_PLACEHOLDERS.has(name)) refs.add(name)
    }
  }
  return [...refs].sort()
}

async function toResolvedMount(
  suite: Suite,
  serverKey: string,
  server: McpServer,
  pluginDataRoot: string,
  resolver: McpCredentialResolver
): Promise<{ request?: McpMountRequest; failure?: McpMountFailure }> {
  if (server.type === 'sse') {
    // The market bridge supports the legacy HTTP+SSE transport natively.
    const expand = expander(suite, joinInside(pluginDataRoot, qualifiedSuiteId(suite.sourceId, suite.id)), resolver)
    const url = await expand.one(server.url)
    const headers = await expand.map(server.headers ?? {})
    const missing = unique([...url.missing, ...headers.missing])
    if (missing.length > 0) return { failure: missingFailure(serverKey, missing) }
    const sseConfig: SseConfig = {
      transport: 'sse',
      serverName: deriveServerName(suite.id, serverKey),
      url: url.value,
      headers: headers.values,
      ...(server.auth === undefined ? {} : { auth: mapAuth(server.auth) }),
      ...bridgePolicy(server),
      failOnStartupError: true
    }
    return { request: { suiteId: qualifiedSuiteId(suite.sourceId, suite.id), serverKey, config: sseConfig } }
  }
  const expand = expander(suite, joinInside(pluginDataRoot, qualifiedSuiteId(suite.sourceId, suite.id)), resolver)
  const serverName = deriveServerName(suite.id, serverKey)
  if (server.type === 'stdio') {
    const args = await expand.all(server.args ?? [])
    const env = await expand.map(server.env ?? {})
    const cwd = server.cwd === undefined ? { value: suite.root, missing: [] as string[] } : await expand.one(server.cwd)
    const missing = unique([...args.missing, ...env.missing, ...cwd.missing])
    if (missing.length > 0) return { failure: missingFailure(serverKey, missing) }
    return {
      request: {
        suiteId: qualifiedSuiteId(suite.sourceId, suite.id),
        serverKey,
        config: {
          transport: 'stdio',
          serverName,
          command: server.command.startsWith('./') ? joinInside(suite.root, server.command.slice(2)) : server.command,
          args: args.values,
          env: env.values,
          cwd: resolveCwd(cwd.value, suite.root, joinInside(pluginDataRoot, qualifiedSuiteId(suite.sourceId, suite.id))),
          ...bridgePolicy(server),
          failOnStartupError: true
        }
      }
    }
  }
  const url = await expand.one(server.url)
  const headers = await expand.map(server.headers ?? {})
  const missing = unique([...url.missing, ...headers.missing])
  if (missing.length > 0) return { failure: missingFailure(serverKey, missing) }
  return {
    request: {
      suiteId: qualifiedSuiteId(suite.sourceId, suite.id),
      serverKey,
      config: {
        transport: 'streamable-http',
        serverName,
        url: url.value,
        headers: headers.values,
        ...(server.auth === undefined ? {} : { auth: mapAuth(server.auth) }),
        ...bridgePolicy(server),
        failOnStartupError: true
      }
    }
  }
}

/**
 * Map the suite format's auth declaration onto the bridge's OAuth config.
 * `enabled: false` must survive the mapping — it is the explicit opt-out —
 * while `enabled: true` (or a bare declaration) requests the default-on
 * flow, optionally with a scope.
 */
function mapAuth(auth: { enabled: boolean; scope?: string }): { enabled: boolean; scope?: string } {
  return {
    enabled: auth.enabled !== false,
    ...(auth.scope === undefined ? {} : { scope: auth.scope })
  }
}

function bridgePolicy(server: McpServer) {
  return {
    toolCallTimeoutMs: server.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS,
    ...(server.startupTimeoutMs === undefined ? {} : { startupTimeoutMs: server.startupTimeoutMs }),
    ...(server.enabledTools === undefined ? {} : { enabledTools: server.enabledTools }),
    ...(server.disabledTools === undefined ? {} : { disabledTools: server.disabledTools })
  }
}

/** Per-mount expansion context; credential lookups are memoized per call. */
function expander(suite: Suite, pluginData: string, resolver: McpCredentialResolver) {
  // Promise-valued cache: concurrent expansions of the same reference share
  // one in-flight lookup, so a config using a token twice resolves it once.
  const inflight = new Map<string, Promise<{ value: string; source?: string } | undefined>>()
  const lookup = (name: string): Promise<{ value: string; source?: string } | undefined> => {
    const pending = inflight.get(name)
    if (pending !== undefined) return pending
    const created = Promise.resolve(resolver.resolve(name))
    inflight.set(name, created)
    return created
  }
  const one = async (value: string): Promise<{ value: string; missing: string[] }> => {
    let cursor = 0
    let output = ''
    const missing: string[] = []
    for (const match of value.matchAll(PLACEHOLDER)) {
      const index = match.index ?? 0
      const name = match[1]
      if (name === undefined) continue
      output += value.slice(cursor, index)
      const fallback = match[2]
      let replacement: string | undefined
      if (PLUGIN_ROOT_VARIABLES.has(name)) replacement = suite.root
      else if (PLUGIN_DATA_VARIABLES.has(name)) replacement = pluginData
      else replacement = (await lookup(name))?.value
      if (replacement === undefined || replacement === '') {
        if (fallback !== undefined && fallback !== '') replacement = fallback
        else {
          missing.push(name)
          replacement = ''
        }
      }
      output += replacement
      cursor = index + match[0].length
    }
    output += value.slice(cursor)
    return { value: output, missing }
  }
  return {
    one,
    async all(values: string[]): Promise<{ values: string[]; missing: string[] }> {
      const expanded = await Promise.all(values.map(one))
      return { values: expanded.map(item => item.value), missing: expanded.flatMap(item => item.missing) }
    },
    async map(values: Record<string, string>): Promise<{ values: Record<string, string>; missing: string[] }> {
      const entries = await Promise.all(Object.entries(values).map(async ([key, value]) => [key, await one(value)] as const))
      return {
        values: Object.fromEntries(entries.map(([key, result]) => [key, result.value])),
        missing: entries.flatMap(([, result]) => result.missing)
      }
    }
  }
}

function missingFailure(serverKey: string, refs: string[]): McpMountFailure {
  const uniqueRefs = unique(refs)
  return {
    serverKey,
    code: 'missing-credential',
    credentialRefs: uniqueRefs,
    reason: uniqueRefs.map(ref => `missing credential reference ${ref}`).join('; ')
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function joinInside(root: string, segment: string): string {
  return `${root.replace(/[\\/]$/, '')}/${segment}`
}

/** Sanitize one token into `[A-Za-z0-9_-]`. */
function sanitizeToken(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned === '' ? 'server' : cleaned
}

/**
 * Derive a bridge serverName from the suite and server ids:
 * `${suiteId}__${serverKey}` sanitized, clamped to 32 chars with a
 * deterministic 12-hex suffix when the join exceeds the budget.
 *
 * Deliberately NOT source-qualified: two sources shipping the same
 * suite/server pair are the same server for the model, so the second mount
 * is skipped with a `duplicate-mount` diagnostic instead of registering a
 * shadow copy under a mangled name.
 */
export function deriveServerName(suiteId: string, serverKey: string): string {
  const candidate = `${sanitizeToken(suiteId)}__${sanitizeToken(serverKey)}`
  if (candidate.length <= SERVER_NAME_MAX) return candidate
  const hash = createHash('sha256').update(`${suiteId}\u0000${serverKey}`).digest('hex').slice(0, 12)
  return `${candidate.slice(0, SERVER_NAME_MAX - 13)}-${hash}`
}
