/**
 * Maps one validated suite `mcp.json` onto self-built bridge config rows.
 *
 * The portable format is translated, not executed directly: stdio commands
 * resolve against the suite root (spec §7.2.1), `${PLUGIN_ROOT}` /
 * `${PLUGIN_DATA}` expand against the suite root and its data directory, and
 * the child environment carries both variables (§9.1) with the data directory
 * created before launch. Legacy HTTP+SSE servers are supported by the
 * market's own bridge (the host client had no such transport); unrecognized
 * shapes are still skipped with a per-server reason.
 *
 * Placeholder discipline follows the package's origin. A suite mounted from
 * the portable v1 format (`portable: true`) is package data: §9.2 forbids any
 * expansion beyond the two built-in variables, and per-server client policy
 * (OAuth, tool lists, timeouts) comes from the `com.deepseek.harness`
 * namespace instead of the `mcp.json` body. Dialect-native files and
 * user-owned config keep the credential seam: every `${NAME}` — including
 * ones inside a streamable-http `url` — expands through the optional DSH
 * credentials resolver at mount time, and missing references fail closed per
 * server instead of becoming empty strings.
 */
import { createHash } from 'node:crypto'
import type { Config, SseConfig } from './mcp-client/config.js'
import { DEFAULT_STARTUP_TIMEOUT_MS, DEFAULT_TOOL_CALL_TIMEOUT_MS } from './mcp-client/config.js'
import { resolveCwd } from '../catalog/validate.js'
import { qualifiedSuiteId, suiteDataDir } from '../catalog/paths.js'
import { applyOverride, type McpServerOverride, type McpSuiteOverrides } from './mcp-overrides.js'
import type { McpStatusCode } from '../contracts/mcp-status.js'
import type { HarnessMcpPolicy, McpServer, McpServerPolicy, McpServerSse, McpServerStdio, McpServerStreamableHttp, Suite } from '../model/types.js'
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
  /** The suite declaration and the user's override as they resolved. */
  policy: ResolvedMcpPolicy
}

/** One timeout as three layers: what the user set, what the suite declared, and the value in force. */
export interface McpTimeoutResolution {
  /** The user's stored value; null when the user inherits. */
  user: number | null
  /** The suite's declared value; null when the suite declares none. */
  suite: number | null
  /** The value in force. */
  effective: number
  /** Which layer supplied `effective`. */
  source: 'user' | 'suite' | 'default'
}

/** One server's client policy after the suite declaration and the user's override meet. */
export interface ResolvedMcpPolicy {
  /** Suite allow-list; the user cannot widen it. */
  enabledTools?: string[]
  /** The suite's own deny list. */
  suiteDisabledTools?: string[]
  /** Effective deny list: the suite's own entries unioned with the user's. */
  disabledTools?: string[]
  /** Per-tool-call timeout. */
  toolCallTimeout: McpTimeoutResolution
  /** Startup timeout. */
  startupTimeout: McpTimeoutResolution
}

export type McpMountFailureCode = Extract<
  McpStatusCode,
  'unsupported-transport' | 'missing-credential' | 'credential-error' | 'unmount-failed' | 'mount-failed' | 'foreign-mount' | 'duplicate-mount'
>

export interface McpMountFailure {
  serverKey: string
  reason: string
  code?: McpMountFailureCode
  /** The messages under the failure's `cause` chain, outermost first. */
  causes?: string[]
  credentialRefs?: string[]
}

/** Optional DSH credential resolver used while building an in-memory mount. */
export interface McpCredentialResolver {
  resolve(ref: string): Promise<{ value: string; source?: string } | undefined>
}

/**
 * Build one mount request per supported mcp.json server, expanding built-in
 * variables (and, for user-owned data, `${NAME}` credential references)
 * before a child process or HTTP request is created. Missing references fail
 * closed per server instead of becoming empty strings.
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

/**
 * Whether a suite's MCP declarations are package data under the portable
 * format. Installed v1 suites are; the user's own `~/.agents/mcp.json`,
 * project-native config, and every dialect-native file are user-owned data
 * where `${NAME}` credential references stay resolvable.
 */
export function isPortableMcp(suite: Suite): boolean {
  return suite.dimension !== 'user' && suite.manifest.layout === 'agent-plugin-v1'
}

/**
 * The `com.deepseek.harness` policy declared for one portable server.
 * Server keys in the namespace match the server's own name in `mcp.json`;
 * `serverKey` is that name at discovery time.
 */
export function namespaceMcpPolicy(suite: Suite, serverKey: string): HarnessMcpPolicy | undefined {
  return suite.manifest.harness?.mcpServers?.[serverKey]
}

/**
 * The effective view of one suite's `mcp.json` servers: the user's per-server
 * overrides applied, every row flagged with whether it is used at all, and each
 * row's credential references read off the effective shape. Mounting, status
 * and detail rendering read this one projection, so a server cannot be listed
 * as enabled while mounting something else.
 *
 * Portable v1 suites (`isPortableMcp`) carry package data: their credential
 * reference list is empty by definition (§9.2 leaves unrecognized
 * placeholder-like text literal), and client policy comes from the
 * `com.deepseek.harness` namespace instead. Overrides applied by the user are
 * user-owned data, so a reference a user typed into an override still
 * resolves.
 */
export function effectiveMcpServers(suite: Suite, overrides: McpSuiteOverrides = {}): EffectiveMcpServer[] {
  const rows: EffectiveMcpServer[] = []
  const portable = isPortableMcp(suite)
  for (const [serverKey, source] of Object.entries(suite.mcp?.servers ?? {})) {
    const override = overrides[serverKey]
    const declared = namespaceMcpPolicy(suite, serverKey)
    const policy = resolveMcpPolicy(declaredMcpPolicy(source, declared), override)
    const connection = applyNamespaceAuth(applyOverride(source, override), declared)
    const effective = applyMcpPolicy(connection, policy)
    const credentialRefs = portable ? credentialRefsInServer(overrideValues(override)) : credentialRefsInServer(effective)
    rows.push({ serverKey, server: effective, override, enabled: override?.enabled !== false, credentialRefs, policy })
  }
  return rows
}

/** Credential references a user typed into their own override values. */
function overrideValues(override: McpServerOverride | undefined): McpServer {
  if (override === undefined) return { type: 'stdio', command: '' }
  return {
    type: 'stdio',
    command: '',
    ...(override.args !== undefined ? { args: override.args } : {}),
    ...(override.env !== undefined ? { env: override.env } : {}),
    ...(override.headers !== undefined ? { headers: override.headers } : {}),
    ...(override.url !== undefined ? { url: override.url, type: 'streamable-http' } : {})
  } as McpServer
}

/**
 * The suite's declared per-server policy. The `com.deepseek.harness`
 * namespace seat carries the policy a portable `mcp.json` has no room for and
 * wins over an inline declaration; dialect-native files declare it inline.
 */
export function declaredMcpPolicy(server: McpServerPolicy, policy: HarnessMcpPolicy | undefined): McpServerPolicy {
  const enabledTools = policy?.enabledTools ?? server.enabledTools
  const disabledTools = policy?.disabledTools ?? server.disabledTools
  const startupTimeoutMs = policy?.startupTimeoutMs ?? server.startupTimeoutMs
  const toolCallTimeoutMs = policy?.toolCallTimeoutMs ?? server.toolCallTimeoutMs
  return {
    ...(enabledTools === undefined ? {} : { enabledTools }),
    ...(disabledTools === undefined ? {} : { disabledTools }),
    ...(startupTimeoutMs === undefined ? {} : { startupTimeoutMs }),
    ...(toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs })
  }
}

/**
 * Bring the suite's declaration and the user's override together.
 *
 * A timeout is a plain override: the user's value wins, a declaration fills in
 * when the user set none, and the built-in default stands behind both. Tool
 * filtering only tightens: the effective deny list is the suite's entries
 * unioned with the user's, and the suite's allow-list stands as declared, so a
 * user cannot open a tool the suite left out.
 */
export function resolveMcpPolicy(declared: McpServerPolicy, override: McpServerOverride | undefined): ResolvedMcpPolicy {
  const enabledTools = dedupe(declared.enabledTools)
  const suiteDisabledTools = dedupe(declared.disabledTools)
  const disabledTools = dedupe([...(declared.disabledTools ?? []), ...(override?.disabledTools ?? [])])
  return {
    ...(enabledTools === undefined ? {} : { enabledTools }),
    ...(suiteDisabledTools === undefined ? {} : { suiteDisabledTools }),
    ...(disabledTools === undefined ? {} : { disabledTools }),
    toolCallTimeout: timeoutResolution(override?.toolCallTimeoutMs, declared.toolCallTimeoutMs, DEFAULT_TOOL_CALL_TIMEOUT_MS),
    startupTimeout: timeoutResolution(override?.startupTimeoutMs, declared.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS)
  }
}

function timeoutResolution(user: number | undefined, suite: number | undefined, fallback: number): McpTimeoutResolution {
  const effective = user ?? suite ?? fallback
  return {
    user: user ?? null,
    suite: suite ?? null,
    effective,
    source: user !== undefined ? 'user' : suite !== undefined ? 'suite' : 'default'
  }
}

/** Apply one resolved policy onto a server, in the shape the bridge reads. */
function applyMcpPolicy<T extends McpServer>(server: T, policy: ResolvedMcpPolicy): T {
  return {
    ...server,
    toolCallTimeoutMs: policy.toolCallTimeout.effective,
    // An undeclared startup timeout stays absent: the built-in bridge applies
    // its own default at connect time, and host compatibility mode, which
    // cannot enforce one, keeps accepting the server.
    ...(policy.startupTimeout.source === 'default' ? {} : { startupTimeoutMs: policy.startupTimeout.effective }),
    ...(policy.enabledTools === undefined ? {} : { enabledTools: policy.enabledTools }),
    ...(policy.disabledTools === undefined ? {} : { disabledTools: policy.disabledTools })
  }
}

/**
 * Apply the namespace policy's OAuth seat onto one server. A remote server
 * keeps its OAuth opt-out from the namespace; a policy on a portable server
 * also supplies the credential seam the portable file may not declare.
 */
function applyNamespaceAuth<T extends McpServer>(server: T, policy: HarnessMcpPolicy | undefined): T {
  if (policy?.auth === undefined || server.type === 'stdio') return server
  return { ...server, auth: { enabled: policy.auth.enabled, ...(policy.auth.scope === undefined ? {} : { scope: policy.auth.scope }) } }
}

/** Deduplicate a tool-name list, preserving declaration order; an empty result is absent. */
function dedupe(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined
  const names = [...new Set(values.filter(name => name !== ''))]
  return names.length > 0 ? names : undefined
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
  const portable = isPortableMcp(suite)
  const dataDir = suiteDataDir(pluginDataRoot, suite.sourceId, suite.id)
  if (server.type === 'sse') {
    // The market bridge supports the legacy HTTP+SSE transport natively.
    const expand = expander(suite, dataDir, resolver, portable)
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
  const expand = expander(suite, dataDir, resolver, portable)
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
          // §9.1: configured env overlays the base, then the client sets
          // PLUGIN_ROOT and PLUGIN_DATA, replacing same-name entries.
          env: { ...env.values, PLUGIN_ROOT: suite.root, PLUGIN_DATA: dataDir },
          cwd: resolveCwd(cwd.value, suite.root, dataDir),
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
    // Only a DECLARED startup timeout is a policy: host compatibility mode
    // cannot enforce one, so an undeclared server stays enforceable there and
    // the built-in bridge applies its own default at connect time.
    ...(server.startupTimeoutMs === undefined ? {} : { startupTimeoutMs: server.startupTimeoutMs }),
    ...(server.enabledTools === undefined ? {} : { enabledTools: server.enabledTools }),
    ...(server.disabledTools === undefined ? {} : { disabledTools: server.disabledTools })
  }
}

/**
 * Per-mount expansion context.
 *
 * Portable package data (`portable: true`) honors §9.2: only the two built-in
 * variables expand, single pass, and unrecognized placeholder-like text stays
 * literal — the credential resolver is never consulted. User-owned data
 * keeps the `${NAME}` seam, with `${NAME:-default}` fallbacks and missing
 * references reported.
 */
function expander(suite: Suite, pluginData: string, resolver: McpCredentialResolver, portable: boolean) {
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
      else if (!portable) replacement = (await lookup(name))?.value
      if (replacement === undefined || replacement === '') {
        if (fallback !== undefined && fallback !== '') replacement = fallback
        else if (!portable) {
          missing.push(name)
          replacement = ''
        } else {
          // §9.2: unrecognized placeholder-like text stays literal.
          replacement = match[0]
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
