/**
 * The HTTP response and request plumbing every market route module shares.
 *
 * A sibling of `request-trust.ts`: that module owns the trust fence, and this
 * one owns the bytes around it — the body cap, the parse-failure answer, the
 * query reader and the JSON writer. Both exist because a route module that
 * repeated them would own a second copy of a security-relevant limit.
 *
 * `routes-extension-presets.ts` deliberately does not use these. Its contract
 * differs in three ways a caller notices: it sends `cache-control: no-store`
 * because its payloads are session-addressed, it refuses an oversized or
 * non-object body by throwing so the route can answer with a structured
 * `code`, and it fences the method as well. Sharing the helpers would have to
 * carry all three switches, which is a worse module than two honest ones.
 * @module route-http
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Largest request body any market route accepts.
 *
 * A fixed protocol limit, not a tunable: it backs the same-origin fence by
 * bounding what one mutating request can hand the parser.
 */
export const MAX_BODY_BYTES = 64 * 1024

/**
 * Parse one request body as JSON.
 *
 * Every failure reads the same to the caller: an oversized body destroys the
 * socket, an unparsable body resolves `undefined`, and a read error does too.
 * A route answers `undefined` with its own 400, so the parser never decides a
 * status.
 * @param request - the incoming request whose body to read.
 * @returns the parsed value, or `undefined` for an oversized, unparsable, or failed read.
 */
export function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise(resolve => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve(undefined)
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (size > MAX_BODY_BYTES) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(undefined)
      }
    })
    request.on('error', () => resolve(undefined))
  })
}

/**
 * Parse the query string of one request into a URLSearchParams.
 *
 * The base is fixed rather than the request's own host: only the path and the
 * query are read, so a missing or hostile `url` cannot change the parse.
 * @param request - the incoming request.
 * @returns the request's query parameters.
 */
export function queryOf(request: IncomingMessage): URLSearchParams {
  return new URL(request.url ?? '/', 'http://dsh.local').searchParams
}

/**
 * Write one JSON response.
 *
 * `content-length` is the byte length of the encoded body, not its character
 * length, so a payload carrying a non-ASCII path or message is framed correctly.
 * @param response - the response to write.
 * @param status - the HTTP status code.
 * @param payload - the value to serialize.
 */
export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}
