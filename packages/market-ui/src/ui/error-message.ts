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
  key: 'requestTimeout' | 'credentialLookupFailed' | 'credentialSaveFailed' | 'credentialRemovalFailed' | 'requestFailed' | 'sourceDuplicate',
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

/**
 * One failed model call as a sentence.
 *
 * A code the wire carries reads in the reader's language: the provider's limit
 * is a wait, and a call that outlived its budget is a retry, never the
 * browser's own "This operation was aborted".
 */
export function aiFailureText(t: (key: Parameters<ErrorTranslate>[0] | 'aiTimeout' | 'aiDraftLimited', params?: { status: string }) => string, error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  if (code === 'ai-timeout') return t('aiTimeout')
  if (code === 'ai-provider-limited') return t('aiDraftLimited')
  return clientErrorMessage(t, error)
}

export function clientErrorMessage(t: ErrorTranslate, error: unknown): string {
  if (error instanceof RequestTimeoutError) return t('requestTimeout')
  // The host's status code is the one fact in a failed read a reader can relay;
  // the rest of the sentence says what happened in their language.
  if (error instanceof RequestFailedError) {
    // A host that named the reason is the only one who knows it; the panel's
    // sentence is what stands in when nothing was explained.
    return error.hostReason === undefined ? t('requestFailed', { status: String(error.status) }) : error.hostReason
  }
  // The host's own reason wins when it has one; only our fallback sentence is
  // something a reader should see in their language.
  if (error instanceof CredentialError && CREDENTIAL_FALLBACK.has(error.message)) return t(CREDENTIAL_MESSAGE[error.code])
  // A rejected mutation carries a stable code, and the one a reader meets most
  // often says a fact about this list rather than about the request: the source
  // they pasted is already there.
  if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'source-duplicate') return t('sourceDuplicate')
  return error instanceof Error ? error.message : String(error)
}
