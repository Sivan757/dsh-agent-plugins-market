/** Typed fetch helpers over the host's `/api/agent-plugins/*` routes. */
import { withBusyOperation } from './ui/busy-operation.js'
import { MARKET_ROUTES, userPanelMutationRoute, userPanelRoute, type UserPanelEntryWire, type UserPanelKind } from '../contracts/market.js'
import { MARKET_API_PREFIX, skillRoute, suiteRoute } from '../contracts/market.js'
import type { McpBackendInfo, OverviewPayload, SkillContent, SourceProgress, SuiteDetail, SuiteOverviewCard } from '../contracts/market.js'
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { LspStatusPayload } from '../contracts/lsp-status.js'

export type {
  AgentPreview,
  HookPreview,
  LspPreview,
  MarkdownPreview,
  McpServerDetail,
  OverviewPayload,
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
export type { LspStatusEntry, LspStatusPayload, LspStatusState } from '../contracts/lsp-status.js'
export type { McpBackendInfo }

/** The market overview wire, under the name the client surfaces use. */
export type OverviewData = OverviewPayload
/** One suite card wire, under the name the client surfaces use. */
export type SuiteCardData = SuiteOverviewCard

/**
 * One same-origin GET decoded as JSON.
 *
 * `label` names the resource in the thrown message, so a failed load reads the
 * same in every panel that shares this helper.
 */
async function getJson<T>(url: string, label: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init })
  if (!response.ok) throw new Error(`${label}: ${response.status}`)
  return response.json() as Promise<T>
}

/** One POST carrying the market API's `{ ok, error }` result envelope. */
async function postOkJson<T>(url: string, body: Record<string, unknown>, label: string): Promise<T & { ok?: boolean; error?: string }> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const payload = (await response.json()) as T & { ok?: boolean; error?: string }
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error ?? `${label}: ${response.status}`)
  }
  return payload
}

export async function fetchServerConfig(kind: 'mcp' | 'lsp', id: string): Promise<import('../contracts/market.js').ServerConfigPayload> {
  return withBusyOperation(async () => {
    const response = await fetch(`${MARKET_ROUTES.serverConfig}?${new URLSearchParams({ kind, id })}`, { credentials: 'same-origin' })
    const body = (await response.json()) as import('../contracts/market.js').ServerConfigPayload & { error?: string }
    if (!response.ok) throw new Error(body.error ?? `Server configuration failed: ${response.status}`)
    return body
  })
}

export async function saveServerConfig(kind: 'mcp' | 'lsp', id: string, config: Record<string, unknown>): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('server-config/save', { kind, id, config })
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
    const response = await fetch(userPanelMutationRoute(kind, 'create'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, text })
    })
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
