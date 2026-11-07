/**
 * The AI-assist route: one draft per request.
 *
 * A draft is not a write. Nothing here touches a file, a preset or a suite: the answer goes
 * back to the editor a person is already looking at, and saving stays their action. That is
 * why this route needs no confirmation flow of its own.
 *
 * The route is deliberately narrow: one face, one intent, one answer, with the bounds the
 * contract states. It never accepts a prompt, a model or a system message from the client,
 * so a caller cannot use the deployment's model for something the product did not describe.
 *
 * @module routes-ai
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AI_DIAGNOSE_FACES,
  AI_DIAGNOSE_LIMITS,
  AI_DRAFT_ROUTES,
  AI_PRESET_LIMITS,
  type AiDiagnoseFailure,
  type AiDiagnoseRequest,
  type AiPresetCandidate,
  type AiPresetRequest
} from '../../market-contracts/src/contracts/ai-draft.js'
import type { AiDiagnoseService } from './application/ai-diagnose.js'
import type { AiPresetService } from './application/ai-preset.js'
import { isTrustedMutation, requestTrustOf, type RequestTrust } from './request-trust.js'
import { routeFailurePayload, type RouteLogger } from './route-errors.js'
import { readJsonBody, sendJson } from './route-http.js'

interface WebServerService {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void> }): () => void
}

/** What the AI routes need from the composition root. */
export interface AiDraftRouteDeps {
  /** The preset suggester; the manager's own rows are the world it chooses from. */
  presets: AiPresetService
  /** The failure explainer, which reads the facts the panel already shows. */
  diagnose: AiDiagnoseService
  /** A live agent lookup, so the assist session joins the workspace the reader is working in. */
  session?: { agent(id: string): { session: { header: { cwd?: string } } } | undefined }
  /**
   * The catalogue, read only when a request asks which suites to install.
   *
   * The alternative was a browser posting a thousand ids: that crosses the host's request body
   * limit, and it made the page the owner of a world the server already has.
   */
  catalogue: { overview(): Promise<{ suites: Array<{ sourceId: string; suiteId: string; name: string; enabled?: boolean }> }> }
  logger: RouteLogger
}

/**
 * Whether a failure is the provider refusing the call because of a limit.
 *
 * A quota answer arrives as a provider-specific message with a status in it, so the test is
 * on the words a provider uses rather than on a type: rate limit, usage limit, quota.
 * @param error - what the model call threw.
 * @returns true when the call can succeed later without anything being fixed.
 */
function looksLikeALimit(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const text = error.message.toLowerCase()
  return text.includes('429') || text.includes('rate limit') || text.includes('usage limit') || text.includes('quota')
}

/**
 * Mount the draft route.
 * @param ctx - the context whose web server carries the route.
 * @param deps - the service and logger.
 * @returns the disposer that unmounts the route.
 */
export function mountAiDraftRoutes(ctx: { get(name: string): unknown }, deps: AiDraftRouteDeps): () => void {
  const trust = (): RequestTrust => requestTrustOf(ctx)
  const server = ctx.get('webServer') as WebServerService | undefined
  if (server === undefined) return () => undefined
  const disposePreset = server.register({
    kind: 'exact',
    path: AI_DRAFT_ROUTES.suggestPreset,
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      if (!isTrustedMutation(request, trust())) {
        sendJson(response, 403, { error: 'untrusted request' })
        return
      }
      const body = (await readJsonBody(request)) as Partial<AiPresetRequest>
      if (typeof body.intent !== 'string' || body.intent.trim().length === 0) {
        sendJson(response, 400, { error: 'say what the preset should be for' })
        return
      }
      if (body.intent.length > AI_PRESET_LIMITS.intentChars) {
        sendJson(response, 400, { error: 'the request is too long to build a preset from' })
        return
      }
      // The world comes from whoever owns it: a preset suggestion is a browser's own rows, an
      // install recommendation is the catalogue the server just scanned.
      const candidates = body.purpose === 'install' ? await catalogueCandidates(deps.catalogue) : readCandidates(body.candidates)
      if (candidates.length === 0) {
        sendJson(response, 400, { error: 'there is nothing to build a preset from' })
        return
      }
      try {
        const suggestion = await deps.presets.suggest({
          intent: body.intent,
          candidates,
          ...(body.purpose === 'install' ? { purpose: 'install' as const } : {}),
          locale: body.locale === 'en' ? 'en' : 'zh'
        })
        sendJson(response, 200, { ok: true, ...suggestion })
      } catch (error) {
        const code = (error as { code?: string }).code
        // The same three families as a draft: a configuration, an unusable answer, and a
        // provider that refused the call. The limit keeps its own code so the client can say it
        // in the reader's language instead of echoing the provider's JSON.
        const payload = looksLikeALimit(error)
          ? { ok: false as const, code: 'ai-provider-limited', error: 'the model refused the call: ' + String((error as Error).message) }
          : routeFailurePayload(error, 'ai preset', deps.logger)
        sendJson(
          response,
          code === 'ai-model-unconfigured' || code === 'ai-unavailable' ? 409 : code === 'ai-invalid-suggestion' || code === 'ai-empty-selection' ? 422 : 502,
          payload
        )
      }
    }
  })
  const disposeDiagnose = server.register({
    kind: 'exact',
    path: AI_DRAFT_ROUTES.diagnose,
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      if (!isTrustedMutation(request, trust())) {
        sendJson(response, 403, { error: 'untrusted request' })
        return
      }
      const body = (await readJsonBody(request)) as Partial<AiDiagnoseRequest>
      if (typeof body.face !== 'string' || !(AI_DIAGNOSE_FACES as readonly string[]).includes(body.face)) {
        sendJson(response, 400, { error: 'unknown service family' })
        return
      }
      const failure = readFailure(body.failure)
      if (failure === undefined) {
        sendJson(response, 400, { error: 'there is no failure to explain' })
        return
      }
      try {
        const diagnosis = await deps.diagnose.diagnose({ face: body.face, failure, locale: body.locale === 'en' ? 'en' : 'zh' })
        sendJson(response, 200, { ok: true, ...diagnosis })
      } catch (error) {
        const code = (error as { code?: string }).code
        const payload = looksLikeALimit(error)
          ? { ok: false as const, code: 'ai-provider-limited', error: 'the model refused the call: ' + String((error as Error).message) }
          : routeFailurePayload(error, 'ai diagnose', deps.logger)
        sendJson(response, code === 'ai-model-unconfigured' || code === 'ai-unavailable' ? 409 : 502, payload)
      }
    }
  })
  return () => {
    disposePreset()
    disposeDiagnose()
  }
}

/**


/**
 * Read the facts one explanation may carry.
 *
 * The shape is rebuilt here rather than trusted: strings are trimmed and truncated to the
 * contract's bounds, and anything else is dropped. A caller therefore cannot make the model
 * read an arbitrarily long or arbitrarily shaped payload.
 * @param value - the request's failure field.
 * @returns the bounded facts, or undefined when nothing identified the failure.
 */
function readFailure(value: unknown): AiDiagnoseFailure | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw['state'] !== 'string' || raw['state'].trim() === '') return undefined
  const text = (key: string, limit: number): string | undefined => {
    const field = raw[key]
    if (typeof field !== 'string') return undefined
    const trimmed = field.trim()
    return trimmed === '' ? undefined : trimmed.slice(0, limit)
  }
  const causes = Array.isArray(raw['causes'])
    ? raw['causes']
        .filter((cause): cause is string => typeof cause === 'string' && cause.trim() !== '')
        .slice(0, AI_DIAGNOSE_LIMITS.causes)
        .map(cause => cause.trim().slice(0, AI_DIAGNOSE_LIMITS.causeChars))
    : []
  const mountMs = typeof raw['mountMs'] === 'number' && Number.isFinite(raw['mountMs']) ? raw['mountMs'] : undefined
  return {
    state: raw['state'].trim().slice(0, 60),
    ...(text('code', 80) === undefined ? {} : { code: text('code', 80) }),
    ...(text('reason', AI_DIAGNOSE_LIMITS.reasonChars) === undefined ? {} : { reason: text('reason', AI_DIAGNOSE_LIMITS.reasonChars) }),
    ...(text('transport', 40) === undefined ? {} : { transport: text('transport', 40) }),
    ...(causes.length === 0 ? {} : { causes }),
    ...(mountMs === undefined ? {} : { mountMs })
  }
}

/**
 * Build the rows an install recommendation chooses from, out of the server's own catalogue.
 *
 * Only suites that are not switched on are offered: already-enabled rows are not candidates for
 * "what should this workspace add". A read failure is a 500-class failure rather than an empty
 * world, because an empty world would blame the reader's sources for a scan that broke.
 * @param catalogue - the catalog service.
 * @returns the rows on offer, capped at the contract's catalogue bound.
 */
async function catalogueCandidates(catalogue: {
  overview(): Promise<{ suites: Array<{ sourceId: string; suiteId: string; name: string; enabled?: boolean }> }>
}): Promise<AiPresetCandidate[]> {
  const overview = await catalogue.overview()
  return overview.suites
    .filter(suite => suite.enabled !== true)
    .slice(0, AI_PRESET_LIMITS.catalogueCandidates)
    .map(suite => ({ id: suite.sourceId + '/' + suite.suiteId, label: suite.name }))
}

/**
 * Read the rows a suggestion may choose from.
 *
 * The client sends its own view of the inventory, so the list is bounded and shaped here: an
 * id and a label, at most the contract's cap, with duplicates dropped. The service then checks
 * every answer against exactly this list.
 * @param value - the request's candidates field.
 * @returns the rows on offer, in request order.
 */
function readCandidates(value: unknown): AiPresetCandidate[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const rows: AiPresetCandidate[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const id = (entry as { id?: unknown }).id
    const label = (entry as { label?: unknown }).label
    if (typeof id !== 'string' || id === '' || typeof label !== 'string') continue
    if (seen.has(id)) continue
    seen.add(id)
    rows.push({ id, label })
    if (rows.length >= AI_PRESET_LIMITS.candidates) break
  }
  return rows
}
