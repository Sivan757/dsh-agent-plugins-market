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
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AI_DIAGNOSE_FACES,
  AI_DIAGNOSE_LIMITS,
  AI_DRAFT_FACES,
  AI_DRAFT_LIMITS,
  AI_DRAFT_ROUTES,
  AI_PRESET_LIMITS,
  type AiDiagnoseFailure,
  type AiDiagnoseRequest,
  type AiDraftFace,
  type AiDraftRequest,
  type AiPresetCandidate,
  type AiPresetRequest,
  type AiSessionRequest
} from '../../market-contracts/src/contracts/ai-draft.js'
import { buildSessionTask, FACE_SUBDIR } from './application/ai-draft.js'
import type { AiDiagnoseService } from './application/ai-diagnose.js'
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
  /** The failure explainer, which reads the facts the panel already shows. */
  diagnose: AiDiagnoseService
  /**
   * The host session store.
   *
   * A message event is surface-eligible, so the host requires the placement marker the GUI's
   * own append uses: `surfaceOp: 'append'` means "this is a new message in the transcript".
   */
  sessions: {
    create(
      id?: string,
      options?: { meta?: { cwd?: string } }
    ): {
      append(type: string, data: unknown, intent?: { surfaceOp: 'append' }): unknown
      header: { id: string }
    }
  }
  /** A live agent lookup, so the assist session joins the workspace the reader is working in. */
  session?: { agent(id: string): { session: { header: { cwd?: string } } } | undefined }
  /** The Agent layout root, where every authored face's user files live. */
  agentsRoot: string
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
        // The repo's write envelope: every successful mutation answers ok:true, and the
        // client's shared request helper refuses a body without it.
        sendJson(response, 200, { ok: true, ...result })
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
      if (!isTrustedMutation(request)) {
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
  const disposeSession = server.register({
    kind: 'exact',
    path: AI_DRAFT_ROUTES.session,
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      if (!isTrustedMutation(request)) {
        sendJson(response, 403, { error: 'untrusted request' })
        return
      }
      const body = (await readJsonBody(request)) as Partial<AiSessionRequest>
      if (!isFace(body.face)) {
        sendJson(response, 400, { error: 'unknown face' })
        return
      }
      if (typeof body.intent !== 'string' || body.intent.trim().length === 0 || body.intent.length > AI_DRAFT_LIMITS.intentChars) {
        sendJson(response, 400, { error: 'write what you want drafted' })
        return
      }
      const face = body.face
      const target = sessionTarget(face, body, deps.agentsRoot)
      if (target === undefined) {
        sendJson(response, 400, { error: 'this face needs a file path to adjust' })
        return
      }
      try {
        // The session is the reader's own: the task is its first message, and the reader edits
        // the requirement, switches the model, and sends when it reads right.
        // The new session joins the reader's own workspace when the caller named one: that is
        // where it shows up in the sidebar, beside the work it belongs to.
        const workspace = typeof body.sessionId === 'string' ? deps.session?.agent(body.sessionId)?.session.header.cwd : undefined
        // A unique id per creation: the store mints `session-<n>` from a counter that restarts
        // with the process, so two drafts from two boots would land on the same session and the
        // second transcript would overwrite the first.
        const id = `session-${randomUUID()}`
        const session = deps.sessions.create(id, workspace === undefined ? undefined : { meta: { cwd: workspace } })
        session.append(
          'user/message',
          createUserMessage({
            content: [
              {
                type: 'text',
                text: buildSessionTask({
                  face,
                  intent: body.intent.trim(),
                  target,
                  ...(typeof body.name === 'string' && body.name.trim() !== '' ? { name: body.name.trim().slice(0, 80) } : {}),
                  locale: body.locale === 'en' ? 'en' : 'zh'
                })
              }
            ],
            source: { kind: 'user' }
          }),
          // A transcript message has to say where it goes; the GUI's own append uses this.
          { surfaceOp: 'append' }
        )
        // The client's note names the workspace, because the session is listed under it and a
        // reader who does not know that will not find the session the plugin just opened.
        sendJson(response, 200, { ok: true, sessionId: session.header.id, ...(workspace === undefined ? {} : { workspace }) })
      } catch (error) {
        const payload = routeFailurePayload(error, 'ai session', deps.logger)
        sendJson(response, 502, payload)
      }
    }
  })
  return () => {
    disposeDraft()
    disposePreset()
    disposeDiagnose()
    disposeSession()
  }
}

/**
 * Resolve where one assist session's artifact lives.
 *
 * A face with a known directory is answered from the Agent layout root; a face whose editor
 * knows a file passes that file through. Both are checked, because a task that names a
 * relative or invented path would send the session's agent writing somewhere nobody asked for.
 * @param face - the face asking.
 * @param body - the request, carrying an optional path or name.
 * @param agentsRoot - the Agent layout root.
 * @returns the target, or undefined when the request cannot name a safe one.
 */
function sessionTarget(face: AiDraftFace, body: Partial<AiSessionRequest>, agentsRoot: string): { kind: 'dir'; dir: string } | { kind: 'file'; path: string } | undefined {
  if (typeof body.path === 'string' && body.path !== '' && isSafeAbsolutePath(body.path)) return { kind: 'file', path: body.path }
  const subdir = FACE_SUBDIR[face]
  if (subdir === '') return undefined
  const dir = joinNormal(agentsRoot, subdir)
  return isSafeAbsolutePath(dir) ? { kind: 'dir', dir } : undefined
}

/** An absolute path with no traversal and no empty segments beyond the root. */
function isSafeAbsolutePath(value: string): boolean {
  if (!value.startsWith('/')) return false
  const segments = value.split('/').slice(1)
  return segments.length > 0 && segments.every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

/** Join without depending on the host's path module: the segments are already checked. */
function joinNormal(root: string, sub: string): string {
  return root.endsWith('/') ? root + sub : root + '/' + sub
}

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
