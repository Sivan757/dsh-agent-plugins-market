/** Typed fetch helpers over the host's `/api/agent-plugins/*` routes. */
import { withBusyOperation } from './ui/busy-operation.js'
import { RequestTimeoutError } from './request-error.js'
import {
  MARKET_ROUTES,
  userPanelMutationRoute,
  userPanelRoute,
  userPanelTranslationRoute,
  type UserPanelEntryWire,
  type UserPanelKind
} from '../../market-contracts/src/contracts/market.js'
import { EXTENSION_ROUTES, type ExtensionHookRunInput, type ExtensionHookRunResult, type ExtensionHooksOverview } from '../../market-contracts/src/contracts/extension-presets.js'
import { documentRoute, MARKET_API_PREFIX, suiteRoute } from '../../market-contracts/src/contracts/market.js'
import type {
  McpBackendInfo,
  MarketFieldError,
  MenuRowFaceWire,
  OverviewPayload,
  ServerConfigPayload,
  ServerPolicyRequest,
  SourceProgress,
  SuiteDetail,
  SuiteDocumentText,
  SuiteOverviewCard
} from '../../market-contracts/src/contracts/market.js'
import type { McpStatusPayload } from '../../market-contracts/src/contracts/mcp-status.js'
import type { LspStatusPayload } from '../../market-contracts/src/contracts/lsp-status.js'
import type { SurfaceToggleKey, SurfaceToggles } from '../../market-contracts/src/contracts/surface-toggles.js'
import type { DocumentTranslation } from '../../market-contracts/src/contracts/translation.js'

export type {
  HookPreview,
  LspPreview,
  MarketFieldError,
  McpServerDetail,
  OverviewPayload,
  ServerConfigPayload,
  ServerPolicyPayload,
  ServerPolicyRequest,
  ServerTimeoutPolicy,
  SourceOverview,
  SourceProgress,
  SuiteDetail,
  SuiteDocumentMeta,
  SuiteDocumentText,
  SuiteOverviewCard,
  SuiteSkillMeta,
  SuiteSurfaceCounts,
  UserPanelEntryWire,
  UserPanelKind
} from '../../market-contracts/src/contracts/market.js'
export type { McpStatusEntry, McpStatusPayload, McpStatusTool } from '../../market-contracts/src/contracts/mcp-status.js'
export type { LspStatusEntry, LspStatusPayload, LspStatusState, LspLegacySeam, LspLegacySeamMigration } from '../../market-contracts/src/contracts/lsp-status.js'
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
async function boundedRequest<T>(url: string, init: RequestInit, timeoutMs: number, consume: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const external = init.signal ?? undefined
  external?.throwIfAborted()
  let rejectStopped: (error: unknown) => void = () => {}
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStopped = reject
  })
  const forward = (): void => {
    controller.abort(external?.reason)
    rejectStopped(controller.signal.reason)
  }
  if (external?.aborted === true) forward()
  else external?.addEventListener('abort', forward, { once: true })
  const timer = setTimeout(() => {
    const error = new RequestTimeoutError(timeoutMs)
    rejectStopped(error)
    controller.abort(error)
  }, timeoutMs)
  try {
    const work = (async () => {
      const response = await fetch(url, { ...init, signal: controller.signal })
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {})
        controller.signal.throwIfAborted()
      }
      return consume(response)
    })()
    return await Promise.race([work, stopped])
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', forward)
  }
}

async function boundedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return boundedRequest(url, init, timeoutMs, async response => response)
}

/**
 * One same-origin GET decoded as JSON.
 *
 * `label` names the resource in the thrown message, so a failed load reads the
 * same in every panel that shares this helper.
 */
async function getJson<T>(url: string, label: string, init?: RequestInit): Promise<T> {
  return boundedRequest(url, { credentials: 'same-origin', ...init }, READ_TIMEOUT_MS, async response => {
    if (!response.ok) throw new Error(`${label}: ${response.status}`)
    return response.json() as Promise<T>
  })
}

/** One POST carrying the market API's `{ ok, error }` result envelope. */
async function postOkJson<T>(url: string, body: Record<string, unknown>, label: string, timeoutMs = MUTATION_TIMEOUT_MS): Promise<T & { ok?: boolean; error?: string }> {
  return boundedRequest(
    url,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    },
    timeoutMs,
    async response => {
      const payload = (await response.json()) as T & { ok?: boolean; error?: string; fields?: MarketFieldError[] }
      if (!response.ok || payload.ok !== true) {
        throw Object.assign(new Error(payload.error ?? `${label}: ${response.status}`), { fields: payload.fields })
      }
      return payload
    }
  )
}

export async function fetchServerConfig(kind: 'mcp' | 'lsp', id: string): Promise<ServerConfigPayload> {
  return withBusyOperation(
    async () => {
      const url = `${MARKET_ROUTES.serverConfig}?${new URLSearchParams({ kind, id })}`
      const response = await boundedFetch(url, { credentials: 'same-origin' }, READ_TIMEOUT_MS)
      const body = (await response.json()) as ServerConfigPayload & { error?: string }
      if (!response.ok) throw new Error(body.error ?? `Server configuration failed: ${response.status}`)
      return body
    },
    { blocking: false }
  )
}

/** Load the backend and effective policy defaults before creating a service. */
export async function fetchServerConfigDefaults(kind: 'mcp' | 'lsp'): Promise<ServerConfigPayload> {
  const query = new URLSearchParams({ kind, create: 'true' })
  return getJson<ServerConfigPayload>(`${MARKET_ROUTES.serverConfig}?${query}`, 'Server defaults failed')
}

export async function saveServerConfig(kind: 'mcp' | 'lsp', id: string, config: Record<string, unknown>, policy?: ServerPolicyRequest): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('server-config/save', { kind, id, config, ...(policy === undefined ? {} : { policy }) })
  })
}

/** Load providers, models, or exact-model reasoning options from DSH's live LLM service. */
export async function fetchModelCatalog(
  provider?: string,
  signal?: AbortSignal,
  model?: string
): Promise<import('../../market-contracts/src/contracts/market.js').ModelCatalogPayload> {
  const params = new URLSearchParams()
  if (provider !== undefined) params.set('provider', provider)
  if (model !== undefined) params.set('model', model)
  const query = params.size === 0 ? '' : `?${params}`
  return getJson(`${MARKET_ROUTES.modelCatalog}${query}`, 'DSH model directory failed', { signal })
}

export async function fetchOverview(): Promise<OverviewData> {
  return withBusyOperation(() => getJson<OverviewData>(MARKET_ROUTES.overview, 'overview failed'), { blocking: false })
}

export async function fetchSourceProgress(): Promise<SourceProgress> {
  return getJson<SourceProgress>(MARKET_ROUTES.progress, 'progress failed')
}

/**
 * The localized face of every `/` menu row this plugin owns.
 *
 * Read on menu mount and on a locale change only. Translation stays lazy on the
 * host: this route reports what the panels already translated and queues
 * nothing, so an uncached row simply arrives without a face.
 */
export async function fetchMenuRowFaces(): Promise<MenuRowFaceWire[]> {
  return getJson<MenuRowFaceWire[]>(MARKET_ROUTES.menuRowFaces, 'menu row faces failed')
}

function sessionRoute(route: string, sessionId?: string): string {
  return sessionId ? route + (route.includes('?') ? '&' : '?') + new URLSearchParams({ sessionId }).toString() : route
}

export async function fetchSuiteDetail(sourceId: string, suiteId: string, sessionId?: string): Promise<SuiteDetail> {
  return withBusyOperation(() => getJson<SuiteDetail>(sessionRoute(suiteRoute(sourceId, suiteId), sessionId), 'suite detail failed'), { blocking: false })
}

export async function fetchMcpStatus(sessionId?: string): Promise<McpStatusPayload> {
  return withBusyOperation(() => getJson<McpStatusPayload>(sessionRoute(MARKET_ROUTES.mcpStatus, sessionId), 'MCP status failed'), { blocking: false })
}

/** The settings Hooks tab: the configured hook declarations, sessionless. */
export async function fetchHooksOverview(): Promise<ExtensionHooksOverview> {
  return withBusyOperation(() => getJson<ExtensionHooksOverview>(EXTENSION_ROUTES.hooksOverview, 'hooks overview failed'), { blocking: false })
}

/**
 * Dry-run one declared hook. The server resolves the command from the catalog
 * and runs it in the home directory, so the body carries identity only. A run
 * that fails reports its reason in the result instead of rejecting.
 */
export async function runExtensionHook(input: ExtensionHookRunInput): Promise<ExtensionHookRunResult> {
  return boundedRequest(
    EXTENSION_ROUTES.hookRun,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    },
    MUTATION_TIMEOUT_MS,
    async response => {
      const text = await response.text()
      if (!response.ok) {
        let message = 'hook run failed: ' + response.status
        try {
          const payload = JSON.parse(text) as { error?: unknown }
          if (typeof payload.error === 'string' && payload.error !== '') message = payload.error
        } catch {
          /* A non-JSON error body keeps the status as the message. */
        }
        throw new Error(message)
      }
      return JSON.parse(text) as ExtensionHookRunResult
    }
  )
}

export async function fetchLspStatus(background = false, sessionId?: string): Promise<LspStatusPayload> {
  const load = (): Promise<LspStatusPayload> => getJson<LspStatusPayload>(sessionRoute(MARKET_ROUTES.lspStatus, sessionId), 'LSP status failed')
  return background ? load() : withBusyOperation(load, { blocking: false })
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
export async function migrateLspSeam(profile: string): Promise<import('../../market-contracts/src/contracts/lsp-status.js').LspLegacySeamMigration> {
  return withBusyOperation(async () => {
    const payload = await postAction('lsp-servers/migrate-seam', { profile })
    return payload.migration as import('../../market-contracts/src/contracts/lsp-status.js').LspLegacySeamMigration
  })
}

/**
 * One suite document's authored text, whole.
 *
 * This is the market detail page's only document read: a skill, a command, and
 * an agent row all call it when a reader opens the row, so no row renders a
 * body the detail payload shipped (and none can be cut to fit one).
 * @param sourceId - the source the suite belongs to.
 * @param suiteId - the suite's id inside that source.
 * @param kind - which document surface the name belongs to.
 * @param name - the document's name inside that surface.
 * @returns the document's text exactly as authored.
 */
export async function fetchSuiteDocument(sourceId: string, suiteId: string, kind: UserPanelKind, name: string, sessionId?: string): Promise<SuiteDocumentText> {
  return withBusyOperation(() => getJson<SuiteDocumentText>(sessionRoute(documentRoute(sourceId, suiteId, kind, name), sessionId), 'document content failed'), { blocking: false })
}

/**
 * Translate one suite document, chunk by chunk.
 *
 * The call names the suite and the document and nothing else. The server
 * re-reads that file from the suite's own checkout, so a page cannot spend the
 * operator's translation quota on text of its own — and a document that changed
 * since the detail payload was built is translated as it stands on disk, not as
 * the payload remembers it.
 * @param sourceId - the source the suite belongs to.
 * @param suiteId - the suite's id inside that source.
 * @param kind - which document surface the name belongs to.
 * @param name - the document's name inside that surface.
 * @returns the body in the target language, and how many chunks are still in flight.
 */
export async function fetchSuiteDocumentTranslation(
  sourceId: string,
  suiteId: string,
  kind: UserPanelKind,
  name: string,
  sessionId?: string,
  retry = false
): Promise<DocumentTranslation> {
  return withBusyOperation(
    async () => {
      // The session rides the query on every read, POST included: the route validates it
      // with the same reader the GET routes use, never from the body.
      const body = await postOkJson<{ text?: string; bilingualText?: string; pending?: number; failed?: number }>(
        sessionRoute(MARKET_ROUTES.suiteDocumentTranslation, sessionId),
        { sourceId, suiteId, kind, name, ...(retry ? { retry: true } : {}) },
        'document translation failed',
        READ_TIMEOUT_MS
      )
      return {
        text: body.text ?? '',
        pending: body.pending ?? 0,
        ...(typeof body.failed === 'number' ? { failed: body.failed } : {}),
        ...(typeof body.bilingualText === 'string' ? { bilingualText: body.bilingualText } : {})
      }
    },
    { blocking: false }
  )
}

/** Re-run the host MCP reconcile: retries failed mounts, clears residual tools. */
export async function retryMcpMounts(): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('mcp-retry', {})
  })
}

/** Persist and mount a user-owned MCP server. */
export async function addMcpServer(name: string, config: Record<string, unknown>, policy?: ServerPolicyRequest): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('mcp-servers/add', { name, config, ...(policy === undefined ? {} : { policy }) })
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
  return (await readUserPanel(kind)).entries
}

/**
 * One panel read with its translation count.
 *
 * The count is what lets a panel re-read until the translated text lands; the
 * entries-only view above is for callers that just need the rows.
 * @param kind - which panel to read.
 * @param force - ask for a genuine re-read instead of the host's row cache.
 * The Refresh button sets it; the translation poll does not, because the poll
 * runs every 1.5 s and the cache is what keeps that poll cheap.
 * @returns the entries and how many description fields are still in flight.
 */
export async function readUserPanel(kind: UserPanelKind, force = false): Promise<{ entries: UserPanelEntry[]; translationPending: number }> {
  return withBusyOperation(
    async () => {
      const route = force ? `${userPanelRoute(kind)}?refresh=1` : userPanelRoute(kind)
      const body = await getJson<{ entries?: UserPanelEntry[]; translationPending?: number }>(route, 'user panel failed')
      return { entries: body.entries ?? [], translationPending: body.translationPending ?? 0 }
    },
    { blocking: false }
  )
}

/** One entry with the document the list read omits. */
export interface UserPanelEntryDetail extends UserPanelEntry {
  rawText: string
}

/**
 * Read one panel entry, document included.
 *
 * The list route drops every entry's document, so a surface that shows or
 * rewrites one — the detail dialog, the editor seed, the enable switch's
 * frontmatter rewrite — fetches exactly the entry it opened.
 * @param kind - which panel the entry belongs to.
 * @param name - the entry's id (suite-owned entries) or its name (user entries).
 * @returns the entry; rejects when it no longer exists.
 */
export async function fetchUserPanelEntry(kind: UserPanelKind, name: string, sessionId?: string): Promise<UserPanelEntryDetail> {
  return withBusyOperation(
    async () => {
      const body = await getJson<{ entry?: UserPanelEntry }>(sessionRoute(`${userPanelRoute(kind)}/entry?${new URLSearchParams({ name })}`, sessionId), 'user panel entry failed')
      const entry = body.entry
      if (entry?.rawText === undefined) throw new Error('user panel entry carried no document')
      return { ...entry, rawText: entry.rawText }
    },
    { blocking: false }
  )
}

/**
 * Translate one panel entry's document, chunk by chunk.
 *
 * The call names the entry and nothing else. The server re-reads that entry's
 * file, so a page cannot spend the operator's translation quota on text of its
 * own — and a document that changed since it was rendered is translated as it
 * stands, not as the page remembers it.
 * @param kind - which panel the entry belongs to.
 * @param name - the entry's id (suite-owned entries) or its name (user entries).
 * @returns the body in the target language, and how many chunks are still in flight.
 */
export async function fetchDocumentTranslation(kind: UserPanelKind, name: string, sessionId?: string, retry = false): Promise<DocumentTranslation> {
  return withBusyOperation(
    async () => {
      const body = await postOkJson<{ text?: string; bilingualText?: string; pending?: number; failed?: number }>(
        sessionRoute(userPanelTranslationRoute(kind), sessionId),
        { name, ...(retry ? { retry: true } : {}) },
        'document translation failed',
        READ_TIMEOUT_MS
      )
      return {
        text: body.text ?? '',
        pending: body.pending ?? 0,
        ...(typeof body.failed === 'number' ? { failed: body.failed } : {}),
        ...(typeof body.bilingualText === 'string' ? { bilingualText: body.bilingualText } : {})
      }
    },
    { blocking: false }
  )
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

/** Read this workspace's six surface switches. */
/**
 * Drop every cached translation.
 *
 * Translation is lazy, so nothing is queued here: the next overview read is
 * what repopulates the cache.
 */
export async function clearTranslations(): Promise<void> {
  await postAction(MARKET_ROUTES.clearTranslations, {})
}

export async function loadSurfaceToggles(): Promise<SurfaceToggles> {
  const response = await boundedFetch(MARKET_ROUTES.surfaceToggles, { credentials: 'same-origin' }, READ_TIMEOUT_MS)
  return (await response.json()) as SurfaceToggles
}

/** Flip one surface switch and return the full toggle state. */
export async function setSurfaceToggle(key: SurfaceToggleKey, enabled: boolean): Promise<SurfaceToggles> {
  const payload = await postAction('surface-toggles/set', { key, enabled })
  return payload.toggles as SurfaceToggles
}
