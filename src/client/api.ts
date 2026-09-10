import { withBusyOperation } from './ui/busy-operation.js'
/** Typed fetch helpers over the host's `/api/agent-plugins/*` routes. */
import { MARKET_ROUTES, userPanelMutationRoute, userPanelRoute, type UserPanelEntryWire, type UserPanelKind } from '../contracts/market.js'
import { MARKET_API_PREFIX, skillRoute, suiteRoute } from '../contracts/market.js'
import type { OverviewPayload, SkillContent, SourceProgress, SuiteDetail, SuiteOverviewCard } from '../contracts/market.js'
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { LspStatusPayload } from '../contracts/lsp-status.js'
import type { LspServerSpec } from '../model/types.js'

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
export type { LspServerSpec } from '../model/types.js'

/** Client-facing alias retained during migration from the original transport types. */
export type OverviewData = OverviewPayload
/** Client-facing alias retained during migration from the original transport types. */
export type SuiteCardData = SuiteOverviewCard

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
  const response = await fetch(`${MARKET_ROUTES.modelCatalog}${query}`, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`DSH model directory failed: ${response.status}`)
  return response.json() as Promise<import('../contracts/market.js').ModelCatalogPayload>
}

export async function fetchOverview(): Promise<OverviewData> {
  return withBusyOperation(async () => {
    const response = await fetch(MARKET_ROUTES.overview, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`overview failed: ${response.status}`)
    return response.json() as Promise<OverviewData>
  })
}

export async function fetchSourceProgress(): Promise<SourceProgress> {
  const response = await fetch(MARKET_ROUTES.progress, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`progress failed: ${response.status}`)
  return response.json() as Promise<SourceProgress>
}

export async function fetchSuiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail> {
  return withBusyOperation(async () => {
    const response = await fetch(suiteRoute(sourceId, suiteId), { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`suite detail failed: ${response.status}`)
    return response.json() as Promise<SuiteDetail>
  })
}

export async function fetchMcpStatus(): Promise<McpStatusPayload> {
  return withBusyOperation(async () => {
    const response = await fetch(MARKET_ROUTES.mcpStatus, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`MCP status failed: ${response.status}`)
    return response.json() as Promise<McpStatusPayload>
  })
}

export async function fetchLspStatus(background = false): Promise<LspStatusPayload> {
  const load = async (): Promise<LspStatusPayload> => {
    const response = await fetch(MARKET_ROUTES.lspStatus, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`LSP status failed: ${response.status}`)
    return response.json() as Promise<LspStatusPayload>
  }
  return background ? load() : withBusyOperation(load)
}

/** The user's direct LSP server table (normalized specs). */
export async function fetchLspServers(): Promise<Record<string, LspServerSpec>> {
  return withBusyOperation(async () => {
    const response = await fetch(MARKET_ROUTES.lspServers, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`LSP servers failed: ${response.status}`)
    const body = (await response.json()) as { lspServers?: Record<string, LspServerSpec> }
    return body.lspServers ?? {}
  })
}

/** Validate and persist the user's direct LSP server table. */
export async function saveLspServers(lspServers: unknown): Promise<Record<string, LspServerSpec>> {
  return withBusyOperation(async () => {
    const response = await fetch(`${MARKET_ROUTES.lspServers}/save`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lspServers })
    })
    const body = (await response.json()) as { ok?: boolean; error?: string; lspServers?: Record<string, LspServerSpec> }
    if (!response.ok || body.ok === false) throw new Error(body.error ?? `LSP servers save failed: ${response.status}`)
    return body.lspServers ?? {}
  })
}
export async function setLspServerEnabled(id: string, enabled: boolean): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('lsp-servers/enabled', { id, enabled })
  })
}

export async function addLspServer(name: string, config: Record<string, unknown>): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('lsp-servers/add', { name, config })
  })
}

export async function fetchSkillContent(sourceId: string, suiteId: string, skill: string): Promise<SkillContent> {
  return withBusyOperation(async () => {
    const response = await fetch(skillRoute(sourceId, suiteId, skill), { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`skill content failed: ${response.status}`)
    return response.json() as Promise<SkillContent>
  })
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

/** The MCP backend card state: active client, host availability, download region. */
export interface McpBackendInfo {
  backend: 'builtin' | 'host'
  hostClient: { available: boolean; version?: string }
  downloadRegion: { setting: 'auto' | 'global' | 'china'; effective: 'global' | 'china' }
}

export async function fetchMcpBackend(): Promise<McpBackendInfo> {
  const response = await fetch(MARKET_ROUTES.mcpBackend, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`mcp backend failed: ${response.status}`)
  return response.json() as Promise<McpBackendInfo>
}

export async function postAction(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return withBusyOperation(async () => {
    const response = await fetch(`${MARKET_API_PREFIX}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    const payload = (await response.json()) as { ok: boolean; error?: string }
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error ?? `request failed: ${response.status}`)
    }
    return payload
  })
}

/* ---- User panel CRUD (skills / commands / agent personas) -------------- */

/** One user panel entry, client-facing alias of the wire shape. */
export type UserPanelEntry = UserPanelEntryWire

/** List one panel's entries. */
export async function fetchUserPanel(kind: UserPanelKind): Promise<UserPanelEntry[]> {
  return withBusyOperation(async () => {
    const response = await fetch(userPanelRoute(kind), { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`user panel failed: ${response.status}`)
    const body = (await response.json()) as { entries?: UserPanelEntry[] }
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
    const response = await fetch(userPanelMutationRoute(kind, 'update', name), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text })
    })
    const payload = (await response.json()) as { ok?: boolean; error?: string }
    if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? `save failed: ${response.status}`)
  })
}

/** Delete one panel entry. */
export async function deleteUserPanelEntry(kind: UserPanelKind, name: string): Promise<void> {
  return withBusyOperation(async () => {
    const response = await fetch(userPanelMutationRoute(kind, 'delete'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name })
    })
    const payload = (await response.json()) as { ok?: boolean; error?: string }
    if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? `delete failed: ${response.status}`)
  })
}
