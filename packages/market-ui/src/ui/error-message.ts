/**
 * One user-facing failure line for every panel.
 *
 * A request that stopped waiting reads as a timeout, because the host may
 * still be working on it; everything else keeps the message the host or the
 * browser produced.
 *
 * @module client/ui/error-message
 */
import { RequestTimeoutError } from '../request-error.js'

/** The one label this helper renders, so every panel's translator fits. */
export type ErrorTranslate = (key: 'requestTimeout') => string

export function clientErrorMessage(t: ErrorTranslate, error: unknown): string {
  if (error instanceof RequestTimeoutError) return t('requestTimeout')
  return error instanceof Error ? error.message : String(error)
}
