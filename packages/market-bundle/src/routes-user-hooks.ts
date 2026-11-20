/**
 * The user-hooks route: append one entry.
 *
 * The document is the reader's file, so the save is an append with a merge rule. It reads
 * nothing but the layout root it was given, and it cannot rewrite an entry the reader wrote by
 * hand.
 *
 * @module routes-user-hooks
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { USER_HOOK_EVENTS, USER_HOOK_LIMITS, USER_HOOKS_ROUTES, type UserHookEvent, type UserHookSaveRequest } from '../../market-contracts/src/contracts/user-hooks.js'
import { appendUserHook } from './application/user-hooks-writer.js'
import { isTrustedMutation, requestTrustAuthoritiesOf } from './request-trust.js'
import { routeFailurePayload, type RouteLogger } from './route-errors.js'
import { readJsonBody, sendJson } from './route-http.js'

/** What the route needs from the composition root. */
export interface UserHooksRouteDeps {
  /** The Agent layout root the hook document lives under. */
  agentsRoot: string
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
      if (!isTrustedMutation(request, requestTrustAuthoritiesOf(ctx))) {
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
  return () => {
    disposeSave()
  }
}
