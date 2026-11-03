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
  AI_DRAFT_FACES,
  AI_DRAFT_LIMITS,
  AI_DRAFT_ROUTES,
  AI_PRESET_LIMITS,
  type AiDraftFace,
  type AiDraftRequest,
  type AiPresetCandidate,
  type AiPresetRequest
} from '../../market-contracts/src/contracts/ai-draft.js'
import type { AiDraftService } from './application/ai-draft.js'
import type { AiPresetService } from './application/ai-preset.js'
import { isTrustedMutation } from './request-trust.js'
import { routeFailurePayload, type RouteLogger } from './route-errors.js'
import { readJsonBody, sendJson } from './route-http.js'

interface WebServerService {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void> }): () => void
}

/** What the AI routes need from the composition root. */
export interface AiDraftRouteDeps {
  service: AiDraftService
  /** The preset suggester; the manager's own rows are the world it chooses from. */
  presets: AiPresetService
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

const isFace = (value: unknown): value is AiDraftFace => typeof value === 'string' && (AI_DRAFT_FACES as readonly string[]).includes(value)

/**
 * Mount the draft route.
 * @param ctx - the context whose web server carries the route.
 * @param deps - the service and logger.
 * @returns the disposer that unmounts the route.
 */
export function mountAiDraftRoutes(ctx: { get(name: string): unknown }, deps: AiDraftRouteDeps): () => void {
  const server = ctx.get('webServer') as WebServerService | undefined
  if (server === undefined) return () => undefined
  const disposeDraft = server.register({
    kind: 'exact',
    path: AI_DRAFT_ROUTES.draft,
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      if (!isTrustedMutation(request)) {
        sendJson(response, 403, { error: 'untrusted request' })
        return
      }
      const body = await readJsonBody(request)
      const draft = body as Partial<AiDraftRequest>
      if (!isFace(draft.face)) {
        sendJson(response, 400, { error: 'unknown face' })
        return
      }
      if (typeof draft.intent !== 'string' || draft.intent.trim().length === 0) {
        sendJson(response, 400, { error: 'write what you want drafted' })
        return
      }
      if (draft.intent.length > AI_DRAFT_LIMITS.intentChars) {
        sendJson(response, 400, { error: 'the request is too long to draft from' })
        return
      }
      try {
        const result = await deps.service.draft({
          face: draft.face,
          intent: draft.intent,
          locale: draft.locale === 'en' ? 'en' : 'zh'
        })
        sendJson(response, 200, result)
      } catch (error) {
        // A provider that refused the call for a limit is not a broken deployment: the reader
        // is out of quota or is being rate-limited, and that is a different sentence.
        const limited = looksLikeALimit(error)
        const payload = limited
          ? { ok: false as const, code: 'ai-provider-limited', error: 'the model refused the call: ' + String((error as Error).message) }
          : routeFailurePayload(error, 'ai draft', deps.logger)
        // A missing model is a configuration the reader can fix, not a provider failure:
        // both "this deployment has no drafting port" and "no default model yet" answer 409.
        const code = (error as { code?: string }).code
        sendJson(response, code === 'ai-model-unconfigured' || code === 'ai-unavailable' ? 409 : 502, payload)
      }
    }
  })
  const disposePreset = server.register({
    kind: 'exact',
    path: AI_DRAFT_ROUTES.suggestPreset,
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      if (!isTrustedMutation(request)) {
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
      const candidates = readCandidates(body.candidates)
      if (candidates.length === 0) {
        sendJson(response, 400, { error: 'there is nothing to build a preset from' })
        return
      }
      try {
        const suggestion = await deps.presets.suggest({ intent: body.intent, candidates, locale: body.locale === 'en' ? 'en' : 'zh' })
        sendJson(response, 200, suggestion)
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
  return () => {
    disposeDraft()
    disposePreset()
  }
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
