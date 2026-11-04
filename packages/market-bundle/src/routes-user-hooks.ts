/**
 * The user-hooks routes: draft one entry, append one entry.
 *
 * The document is the reader's file, so the save route is an append with a merge rule and the
 * draft route is a model call with a shape check. Neither reads anything but the layout root
 * they were given, and neither can rewrite an entry the reader wrote by hand.
 *
 * @module routes-user-hooks
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { USER_HOOK_EVENTS, USER_HOOK_LIMITS, USER_HOOKS_ROUTES, type UserHookEvent, type UserHookSaveRequest } from '../../market-contracts/src/contracts/user-hooks.js'
import { appendUserHook } from './application/user-hooks-writer.js'
import { createAiHookService } from './application/ai-hook.js'
import type { AiPort } from './application/ai-port.js'
import { isTrustedMutation } from './request-trust.js'
import { routeFailurePayload, type RouteLogger } from './route-errors.js'
import { readJsonBody, sendJson } from './route-http.js'

/** What the routes need from the composition root. */
export interface UserHooksRouteDeps {
  /** The Agent layout root the hook document lives under. */
  agentsRoot: string
  /** The model call, or undefined when this deployment has none. */
  port: AiPort | undefined
  logger: RouteLogger
}

/** The one failure a document can earn that is the reader's to fix. */
const MALFORMED = 'user-hooks-malformed'

/** Mount the user-hooks routes. */
export function mountUserHooksRoutes(ctx: { get(name: string): unknown }, deps: UserHooksRouteDeps): () => void {
  const server = ctx.get('webServer') as
    | {
        register(route: { kind: 'exact' | 'prefix'; path: string; handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void> }): () => void
      }
    | undefined
  if (server === undefined) return () => undefined
  const readEntry = (body: Partial<UserHookSaveRequest>): (UserHookSaveRequest & { event: UserHookEvent }) | undefined => {
    if (typeof body.event !== 'string' || !(USER_HOOK_EVENTS as readonly string[]).includes(body.event)) return undefined
    if (typeof body.command !== 'string' || body.command.trim() === '' || body.command.length > USER_HOOK_LIMITS.commandChars) return undefined
    if (Array.from(body.command).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return undefined
    if (body.matcher !== undefined && (typeof body.matcher !== 'string' || body.matcher.length > USER_HOOK_LIMITS.matcherChars)) return undefined
    return {
      event: body.event,
      command: body.command.trim(),
      ...(typeof body.matcher === 'string' && body.matcher.trim() !== '' ? { matcher: body.matcher.trim() } : {})
    }
  }
  const disposeSave = server.register({
    kind: 'exact',
    path: USER_HOOKS_ROUTES.save,
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      if (!isTrustedMutation(request)) {
        sendJson(response, 403, { error: 'untrusted request' })
        return
      }
      const body = (await readJsonBody(request)) as Partial<UserHookSaveRequest>
      const entry = readEntry(body)
      if (entry === undefined) {
        sendJson(response, 400, { error: 'the event or the command is not usable' })
        return
      }
      try {
        const file = await appendUserHook(deps.agentsRoot, entry)
        sendJson(response, 200, { ok: true, file })
      } catch (error) {
        const code = (error as { code?: string }).code
        const payload = routeFailurePayload(error, 'user hooks save', deps.logger)
        sendJson(response, code === MALFORMED ? 409 : code === 'user-hooks-duplicate' ? 409 : 500, payload)
      }
    }
  })
  const hookService = createAiHookService(deps.port)
  const disposeDraft = server.register({
    kind: 'exact',
    path: USER_HOOKS_ROUTES.draft,
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      if (!isTrustedMutation(request)) {
        sendJson(response, 403, { error: 'untrusted request' })
        return
      }
      const body = (await readJsonBody(request)) as { intent?: unknown; locale?: unknown }
      if (typeof body.intent !== 'string' || body.intent.trim() === '' || body.intent.length > USER_HOOK_LIMITS.intentChars) {
        sendJson(response, 400, { error: 'say what the hook should do' })
        return
      }
      try {
        const draft = await hookService.draft({ intent: body.intent, locale: body.locale === 'en' ? 'en' : 'zh' })
        sendJson(response, 200, { ok: true, ...draft })
      } catch (error) {
        const code = (error as { code?: string }).code
        const payload = looksLikeALimit(error)
          ? { ok: false as const, code: 'ai-provider-limited', error: 'the model refused the call: ' + String((error as Error).message) }
          : routeFailurePayload(error, 'user hooks draft', deps.logger)
        sendJson(response, code === 'ai-model-unconfigured' || code === 'ai-unavailable' ? 409 : code === 'ai-invalid-draft' ? 422 : 502, payload)
      }
    }
  })
  return () => {
    disposeSave()
    disposeDraft()
  }
}

/** Whether a failure is the provider refusing the call for a limit. */
function looksLikeALimit(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const text = error.message.toLowerCase()
  return text.includes('429') || text.includes('rate limit') || text.includes('usage limit') || text.includes('quota')
}
