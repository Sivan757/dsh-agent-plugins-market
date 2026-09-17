/** Typed fetch helpers over the host's `/api/agent-plugins/*` routes. */
import { withBusyOperation } from './ui/busy-operation.js'
import { RequestTimeoutError } from './request-error.js'
import { MARKET_ROUTES, userPanelMutationRoute, userPanelRoute, type UserPanelEntryWire, type UserPanelKind } from '../contracts/market.js'
import { MARKET_API_PREFIX, skillRoute, suiteRoute } from '../contracts/market.js'
import type { McpBackendInfo, OverviewPayload, ServerConfigPayload, ServerPolicyRequest, SkillContent, SourceProgress, SuiteDetail, SuiteOverviewCard } from '../contracts/market.js'
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { LspStatusPayload } from '../contracts/lsp-status.js'

export type {
  AgentPreview,
  HookPreview,
  LspPreview,
  MarkdownPreview,
  McpServerDetail,
  OverviewPayload,
  ServerConfigPayload,
  ServerPolicyPayload,
  ServerPolicyRequest,
  ServerTimeoutPolicy,
  SkillContent,
  SourceOverview,
  SourceProgress,
  SuiteDetail,
  SuiteOverviewCard,
  SuiteSkillMeta,
  SuiteSurfaceCounts,
  UserPanelEntryWire,
  UserPanelKind
} from '../contracts/market.js'
export type { McpStatusEntry, McpStatusPayload, McpStatusTool } from '../contracts/mcp-status.js'
export type { LspStatusEntry, LspStatusPayload, LspStatusState, LspLegacySeam, LspLegacySeamMigration } from '../contracts/lsp-status.js'
export type { McpBackendInfo }

/** The market overview wire, under the name the client surfaces use. */
export type OverviewData = OverviewPayload
/** One suite card wire, under the name the client surfaces use. */
export type SuiteCardData = SuiteOverviewCard

/** Reads are local and settle in milliseconds; a stalled host must not hold the page. */
export const READ_TIMEOUT_MS = 15_000
/** Mutations may legitimately clone or archive for minutes; this only caps a stalled one. */
export const MUTATION_TIMEOUT_MS = 600_000

/**
 * One same-origin request that gives up waiting after `timeoutMs`.
 *
 * Aborting releases whoever is waiting — the panel, and the blocking overlay
 * with it — while the host keeps working. The next read then reports where the
 * operation actually stands, which is more useful than a spinner that never
 * ends.
 */
async function boundedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const external = init.signal ?? undefined
  const forward = (): void => controller.abort()
  // An already-aborted caller signal never fires another event, so it has to be
  // honoured here or the request would outlive the read it belongs to.
  if (external?.aborted === true) controller.abort()
  else external?.addEventListener('abort', forward, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    // A caller-driven abort keeps its own error: the editor that cancelled the
    // read owns that outcome.
    if (timedOut) throw new RequestTimeoutError(timeoutMs)
    throw error
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', forward)
  }
}

/**
 * One same-origin GET decoded as JSON.
 *
 * `label` names the resource in the thrown message, so a failed load reads the
 * same in every panel that shares this helper.
 */
async function getJson<T>(url: string, label: string, init?: RequestInit): Promise<T> {
  const response = await boundedFetch(url, { credentials: 'same-origin', ...init }, READ_TIMEOUT_MS)
  if (!response.ok) throw new Error(`${label}: ${response.status}`)
  return response.json() as Promise<T>
}

/** One POST carrying the market API's `{ ok, error }` result envelope. */
async function postOkJson<T>(url: string, body: Record<string, unknown>, label: string): Promise<T & { ok?: boolean; error?: string }> {
  const response = await boundedFetch(
    url,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    },
    MUTATION_TIMEOUT_MS
  )
  const payload = (await response.json()) as T & { ok?: boolean; error?: string }
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error ?? `${label}: ${response.status}`)
  }
  return payload
}

export async function fetchServerConfig(kind: 'mcp' | 'lsp', id: string): Promise<ServerConfigPayload> {
  return withBusyOperation(async () => {
    const url = `${MARKET_ROUTES.serverConfig}?${new URLSearchParams({ kind, id })}`
    const response = await boundedFetch(url, { credentials: 'same-origin' }, READ_TIMEOUT_MS)
    const body = (await response.json()) as ServerConfigPayload & { error?: string }
    if (!response.ok) throw new Error(body.error ?? `Server configuration failed: ${response.status}`)
    return body
  })
}

export async function saveServerConfig(kind: 'mcp' | 'lsp', id: string, config: Record<string, unknown>, policy?: ServerPolicyRequest): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('server-config/save', { kind, id, config, ...(policy === undefined ? {} : { policy }) })
  })
}

/** Load providers, models, or exact-model reasoning options from DSH's live LLM service. */
export async function fetchModelCatalog(provider?: string, signal?: AbortSignal, model?: string): Promise<import('../contracts/market.js').ModelCatalogPayload> {
  const params = new URLSearchParams()
  if (provider !== undefined) params.set('provider', provider)
  if (model !== undefined) params.set('model', model)
  const query = params.size === 0 ? '' : `?${params}`
  return getJson(`${MARKET_ROUTES.modelCatalog}${query}`, 'DSH model directory failed', { signal })
}

export async function fetchOverview(): Promise<OverviewData> {
  return withBusyOperation(() => getJson<OverviewData>(MARKET_ROUTES.overview, 'overview failed'))
}

export async function fetchSourceProgress(): Promise<SourceProgress> {
  return getJson<SourceProgress>(MARKET_ROUTES.progress, 'progress failed')
}

export async function fetchSuiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail> {
  return withBusyOperation(() => getJson<SuiteDetail>(suiteRoute(sourceId, suiteId), 'suite detail failed'))
}

export async function fetchMcpStatus(): Promise<McpStatusPayload> {
  return withBusyOperation(() => getJson<McpStatusPayload>(MARKET_ROUTES.mcpStatus, 'MCP status failed'))
}

export async function fetchLspStatus(background = false): Promise<LspStatusPayload> {
  const load = (): Promise<LspStatusPayload> => getJson<LspStatusPayload>(MARKET_ROUTES.lspStatus, 'LSP status failed')
  return background ? load() : withBusyOperation(load)
}

/** Add one direct LSP server to the user's table. */
export async function addLspServer(name: string, config: Record<string, unknown>): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('lsp-servers/add', { name, config })
  })
}

/**
 * Remove a profile's hand-written LSP layer — the `cordis.patch.yml` rows an
 * older release told users to add, which now claim the seam this plugin owns.
 */
export async function migrateLspSeam(profile: string): Promise<import('../contracts/lsp-status.js').LspLegacySeamMigration> {
  return withBusyOperation(async () => {
    const payload = await postAction('lsp-servers/migrate-seam', { profile })
    return payload.migration as import('../contracts/lsp-status.js').LspLegacySeamMigration
  })
}

export async function fetchSkillContent(sourceId: string, suiteId: string, skill: string): Promise<SkillContent> {
  return withBusyOperation(() => getJson<SkillContent>(skillRoute(sourceId, suiteId, skill), 'skill content failed'))
}

/** Re-run the host MCP reconcile: retries failed mounts, clears residual tools. */
export async function retryMcpMounts(): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('mcp-retry', {})
  })
}

/** Persist and mount a user-owned MCP server. */
export async function addMcpServer(name: string, config: Record<string, unknown>): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('mcp-servers/add', { name, config })
  })
}

/** Drop one server's OAuth grant so its next mount re-runs browser authorization. */
export async function reauthorizeMcpServer(serverName: string): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('mcp-reauthorize', { serverName })
  })
}

/**
 * Enable or disable one declared MCP server.
 *
 * @param suiteId - the source-qualified suite id the status row carries.
 * @param serverKey - the server key inside that suite's declaration.
 * @param enabled - the state the user asked for.
 */
export async function setMcpServerEnabled(suiteId: string, serverKey: string, enabled: boolean): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('set-mcp-server-enabled', { suiteId, serverKey, enabled })
  })
}

/**
 * Allow or deny one tool of a declared MCP server.
 *
 * @param suiteId - the source-qualified suite id the status row carries.
 * @param serverKey - the server key inside that suite's declaration.
 * @param tool - the tool's raw name inside the server's namespace.
 * @param enabled - whether the tool is allowed.
 */
export async function setMcpServerTool(suiteId: string, serverKey: string, tool: string, enabled: boolean): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('set-mcp-server-tool', { suiteId, serverKey, tool, enabled })
  })
}

/** Enable or disable one declared language server by its status-row id. */
export async function setLspServerEnabled(id: string, enabled: boolean): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('lsp-servers/enabled', { id, enabled })
  })
}

export async function fetchMcpBackend(): Promise<McpBackendInfo> {
  return getJson<McpBackendInfo>(MARKET_ROUTES.mcpBackend, 'mcp backend failed')
}

export async function postAction(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return withBusyOperation(() => postOkJson<Record<string, unknown>>(`${MARKET_API_PREFIX}${path}`, body, 'request failed'))
}

/* ---- User panel CRUD (skills / commands / agent personas) -------------- */

/** One user panel entry, client-facing alias of the wire shape. */
export type UserPanelEntry = UserPanelEntryWire

/** List one panel's entries. */
export async function fetchUserPanel(kind: UserPanelKind): Promise<UserPanelEntry[]> {
  return withBusyOperation(async () => {
    const body = await getJson<{ entries?: UserPanelEntry[] }>(userPanelRoute(kind), 'user panel failed')
    return body.entries ?? []
  })
}

/** Create one panel entry. */
export async function createUserPanelEntry(kind: UserPanelKind, name: string, text: string): Promise<UserPanelEntry> {
  return withBusyOperation(async () => {
    const response = await boundedFetch(
      userPanelMutationRoute(kind, 'create'),
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, text })
      },
      MUTATION_TIMEOUT_MS
    )
    const payload = (await response.json()) as { ok?: boolean; error?: string; entry?: UserPanelEntry }
    if (!response.ok || payload.ok !== true || payload.entry === undefined) throw new Error(payload.error ?? `create failed: ${response.status}`)
    return payload.entry
  })
}

/** Replace one panel entry's file content. */
export async function updateUserPanelEntry(kind: UserPanelKind, name: string, text: string): Promise<void> {
  return withBusyOperation(async () => {
    await postOkJson(userPanelMutationRoute(kind, 'update', name), { text }, 'save failed')
  })
}

/** Delete one panel entry. */
export async function deleteUserPanelEntry(kind: UserPanelKind, name: string): Promise<void> {
  return withBusyOperation(async () => {
    await postOkJson(userPanelMutationRoute(kind, 'delete'), { name }, 'delete failed')
  })
}
