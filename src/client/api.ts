/** Typed fetch helpers over the host's `/api/agent-plugins/*` routes. */
import { MARKET_API_PREFIX, MARKET_ROUTES, skillRoute, suiteRoute } from '../contracts/market.js'
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
  SuiteSurfaceCounts
} from '../contracts/market.js'
export type { McpStatusEntry, McpStatusPayload, McpStatusTool } from '../contracts/mcp-status.js'
export type { LspStatusEntry, LspStatusPayload, LspStatusState } from '../contracts/lsp-status.js'
export type { LspServerSpec } from '../model/types.js'

/** Client-facing alias retained during migration from the original transport types. */
export type OverviewData = OverviewPayload
/** Client-facing alias retained during migration from the original transport types. */
export type SuiteCardData = SuiteOverviewCard

export async function fetchOverview(): Promise<OverviewData> {
  const response = await fetch(MARKET_ROUTES.overview, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`overview failed: ${response.status}`)
  return response.json() as Promise<OverviewData>
}

export async function fetchSourceProgress(): Promise<SourceProgress> {
  const response = await fetch(MARKET_ROUTES.progress, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`progress failed: ${response.status}`)
  return response.json() as Promise<SourceProgress>
}

export async function fetchSuiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail> {
  const response = await fetch(suiteRoute(sourceId, suiteId), { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`suite detail failed: ${response.status}`)
  return response.json() as Promise<SuiteDetail>
}

export async function fetchMcpStatus(): Promise<McpStatusPayload> {
  const response = await fetch(MARKET_ROUTES.mcpStatus, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`MCP status failed: ${response.status}`)
  return response.json() as Promise<McpStatusPayload>
}

export async function fetchLspStatus(): Promise<LspStatusPayload> {
  const response = await fetch(MARKET_ROUTES.lspStatus, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`LSP status failed: ${response.status}`)
  return response.json() as Promise<LspStatusPayload>
}

/** The user's direct LSP server table (normalized specs). */
export async function fetchLspServers(): Promise<Record<string, LspServerSpec>> {
  const response = await fetch(MARKET_ROUTES.lspServers, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`LSP servers failed: ${response.status}`)
  const body = (await response.json()) as { lspServers?: Record<string, LspServerSpec> }
  return body.lspServers ?? {}
}

/** Validate and persist the user's direct LSP server table. */
export async function saveLspServers(lspServers: unknown): Promise<Record<string, LspServerSpec>> {
  const response = await fetch(MARKET_ROUTES.lspServers, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lspServers })
  })
  const body = (await response.json()) as { ok?: boolean; error?: string; lspServers?: Record<string, LspServerSpec> }
  if (!response.ok || body.ok === false) throw new Error(body.error ?? `LSP servers save failed: ${response.status}`)
  return body.lspServers ?? {}
}

export async function fetchSkillContent(sourceId: string, suiteId: string, skill: string): Promise<SkillContent> {
  const response = await fetch(skillRoute(sourceId, suiteId, skill), { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`skill content failed: ${response.status}`)
  return response.json() as Promise<SkillContent>
}

/** Re-run the host MCP reconcile: retries failed mounts, clears residual tools. */
export async function retryMcpMounts(): Promise<void> {
  await postAction('mcp-retry', {})
}

export async function postAction(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
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
}
