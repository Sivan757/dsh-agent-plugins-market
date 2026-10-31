/**
 * One user-facing failure line for every panel.
 *
 * A request that stopped waiting reads as a timeout, because the host may
 * still be working on it; everything else keeps the message the host or the
 * browser produced.
 *
 * @module client/ui/error-message
 */
import { RequestFailedError, RequestTimeoutError } from '../request-error.js'
import { CredentialError } from '../credentials.js'

/** The labels this helper renders, so every panel's translator fits. */
export type ErrorTranslate = (
  key: 'requestTimeout' | 'credentialLookupFailed' | 'credentialSaveFailed' | 'credentialRemovalFailed' | 'requestFailed',
  params?: { status: string }
) => string

/**
 * The three sentences {@link CredentialError} carries when the host explained
 * nothing. A host explanation is any other message and reads verbatim.
 */
const CREDENTIAL_FALLBACK: ReadonlySet<string> = new Set(['credential lookup failed', 'credential save failed', 'credential removal failed'])

/** The panel sentence for a failure the host did not explain itself. */
const CREDENTIAL_MESSAGE = {
  lookup: 'credentialLookupFailed',
  save: 'credentialSaveFailed',
  removal: 'credentialRemovalFailed'
} as const

export function clientErrorMessage(t: ErrorTranslate, error: unknown): string {
  if (error instanceof RequestTimeoutError) return t('requestTimeout')
  // The host's status code is the one fact in a failed read a reader can relay;
  // the rest of the sentence says what happened in their language.
  if (error instanceof RequestFailedError) return t('requestFailed', { status: String(error.status) })
  // The host's own reason wins when it has one; only our fallback sentence is
  // something a reader should see in their language.
  if (error instanceof CredentialError && CREDENTIAL_FALLBACK.has(error.message)) return t(CREDENTIAL_MESSAGE[error.code])
  return error instanceof Error ? error.message : String(error)
}
