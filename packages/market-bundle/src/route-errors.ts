/**
 * The one error boundary for every route this plugin serves.
 *
 * A route's failure is two facts with two different readers. The browser learns
 * that the request failed and what kind of failure it was; the operator learns
 * what actually broke, including the directory the failure names. Forwarding
 * `error.message` verbatim conflates them: a filesystem or git failure carries
 * an absolute path, and a page that is allowed to read the response is not the
 * reader who can act on that path.
 *
 * So a message that names a path is replaced by a fixed one, and the detail
 * goes to the log. A message that names no path passes through, because the
 * route modules author those for the user ("missing source url", "sha256 must be
 * a 64-character hex digest") and a generic replacement would erase the one
 * thing the editor shows beside the input it belongs to.
 * @module route-errors
 */
import { containsFilePath, redactErrorMessage } from '../../market-contracts/src/redaction.js'

/** What the browser is told when the detail names a filesystem location. */
export const ROUTE_FAILURE_MESSAGE = 'the request failed; the server log has the detail'

/** The code used when a failure carries none of its own. */
export const ROUTE_FAILURE_CODE = 'request-failed'

/** The minimum a logger must offer to receive a route failure's detail. */
export interface RouteLogger {
  warn(message: string): void
}

/** The parts of one failure that cross the boundary, plus the part that stays. */
export interface RouteFailure {
  /** Stable machine-readable discriminant; the browser branches on this, not on the text. */
  code: string
  /** What the browser may read: never a filesystem path. */
  message: string
  /** Per-field reasons an editor places beside its inputs, when the failure carried them. */
  fields?: unknown
  /** The unredacted text, for the log only. */
  detail: string
}

/**
 * Split one thrown value into what the browser may see and what the log keeps.
 *
 * @param error - whatever a route handler threw.
 * @returns the code, the browser-safe message, any fields, and the full detail.
 */
export function describeRouteError(error: unknown): RouteFailure {
  const detail = error instanceof Error ? error.message : String(error)
  const carried = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined
  const code = typeof carried === 'string' && carried !== '' ? carried : ROUTE_FAILURE_CODE
  const fields = typeof error === 'object' && error !== null && 'fields' in error ? (error as { fields?: unknown }).fields : undefined
  // The message names a location, so nothing of it crosses. Otherwise it is kept
  // with URL credentials redacted, which a diagnostic can also carry.
  const message = containsFilePath(detail) ? ROUTE_FAILURE_MESSAGE : redactErrorMessage(detail)
  return {
    code,
    message,
    detail,
    ...(Array.isArray(fields) ? { fields } : {})
  }
}

/** The JSON body one failed route answers with. */
export interface RouteFailurePayload {
  ok: false
  code: string
  error: string
  fields?: unknown
}

/**
 * Build the response body for one failure and log the detail behind it.
 *
 * One call does both, so a route cannot log without answering or answer
 * without logging.
 *
 * @param error - whatever the route handler threw.
 * @param scope - the route the failure came from, for the log line.
 * @param logger - the host logger, when the profile wired one.
 * @returns the body to send.
 */
export function routeFailurePayload(error: unknown, scope: string, logger: RouteLogger | undefined): RouteFailurePayload {
  const failure = describeRouteError(error)
  logRouteFailure(logger, scope, failure.detail)
  return {
    ok: false,
    code: failure.code,
    error: failure.message,
    ...(failure.fields === undefined ? {} : { fields: failure.fields })
  }
}

/**
 * Send one failure to the log, where the operator can read the whole thing.
 *
 * The detail keeps its paths on purpose: that is the operator's fact. URLs are
 * redacted because a log line is not a place for a credential-bearing query.
 *
 * @param logger - the host logger, when the profile wired one.
 * @param scope - the route or surface the failure came from.
 * @param detail - the unredacted failure text.
 */
export function logRouteFailure(logger: RouteLogger | undefined, scope: string, detail: string): void {
  if (logger === undefined) return
  logger.warn('[dsh-agent-plugins-market] ' + scope + ': ' + redactErrorMessage(detail))
}
