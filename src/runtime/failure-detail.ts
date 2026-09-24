/**
 * The messages under one error's `cause` chain.
 *
 * The layers under the mount registries put the useful part of a failure in
 * `cause`: a client wraps a startup failure in one fixed sentence and hands
 * the spawn, transport, or handshake error beneath it. A status row keeps that
 * chain so the panel can offer the detail behind a disclosure instead of
 * showing the wrapper sentence alone.
 *
 * @module runtime/failure-detail
 */
import { redactErrorMessage } from './mcp-redaction.js'

/** How many cause messages one failure keeps; a mount failure's chain is short. */
const MAX_CAUSES = 4

/** The message text of an error, a thrown string, or an object carrying one. */
function messageOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return undefined
}

/** The next link of a chain: `cause` on an error, or on an object carrying one. */
function causeOf(value: unknown): unknown {
  if (value instanceof Error) return value.cause
  if (typeof value === 'object' && value !== null && 'cause' in value) return (value as { cause?: unknown }).cause
  return undefined
}

/**
 * The chain of messages below one error, outermost first, redacted and
 * de-duplicated. A repeated link ends the walk, so a chain that points back at
 * itself cannot loop.
 */
export function causeMessages(error: unknown): string[] {
  const messages: string[] = []
  const seen = new Set<unknown>()
  let current = causeOf(error)
  while (current !== undefined && current !== null && messages.length < MAX_CAUSES) {
    if (seen.has(current)) break
    seen.add(current)
    const message = messageOf(current)
    if (message !== undefined) {
      const redacted = redactErrorMessage(message)
      if (redacted !== '' && !messages.includes(redacted)) messages.push(redacted)
    }
    current = causeOf(current)
  }
  return messages
}
