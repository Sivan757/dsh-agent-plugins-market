/**
 * The two keyless public machine-translation endpoints, as batch adapters.
 *
 * Both are called by the chain in `application/translation/chain.ts`; the
 * network effect lives here so the chain stays pure orchestration. Each
 * endpoint takes one array and answers with one array in the same order, which
 * is what lets a batch of twenty units travel as a single request.
 *
 * Neither requires registration, a token or a proxy, and that is the whole
 * point of the pair: the market ships translation on by default, with nothing
 * for the operator to configure.
 * @module runtime/host/machine-translator
 */
import type { TranslationProviderId } from '../../contracts/translation.js'

/** One batch translation over a keyless public endpoint. */
export interface MachineTranslationRequest {
  /** The texts to translate, in the order the answers must come back in. */
  texts: readonly string[]
  /** Target locale id, as the host names it (for example `zh`). */
  locale: string
  /** Caller cancellation, merged by the chain with this provider's deadline. */
  signal: AbortSignal
}

/** One batch translation result, tagged with the endpoint that produced it. */
export interface MachineTranslationResult {
  /** The translations, positionally aligned with the request. */
  texts: string[]
  /** The endpoint that answered. */
  provider: TranslationProviderId
}

/** Google's public web-translation endpoint, the one the Translate widget calls. */
const GOOGLE_ENDPOINT = 'https://translate-pa.googleapis.com/v1/translateHtml'
/**
 * The key the endpoint above expects. It is a public, browser-embedded key
 * rather than a credential issued to this plugin — the same value ships inside
 * every page that renders Google's translate widget, so it identifies the
 * calling application and grants nothing.
 */
const GOOGLE_API_KEY = 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520'
/** Microsoft's consumer endpoint, the one Edge's translate feature calls. */
const MICROSOFT_ENDPOINT = 'https://edge.microsoft.com/translate/translatetext'
/** Auto-detect each request item; user-authored text can be Chinese or English. */
const SOURCE_LANGUAGE = 'auto'
/** How much of an error body to quote before it stops being diagnostic. */
const ERROR_BODY_LIMIT = 200

/**
 * Google's target language id.
 *
 * Google reads a bare `zh` as Simplified Chinese already, so the host's own
 * value needs no qualification. A tag that names a script or region more
 * precisely than the host does — `zh-Hant`, `ja` — is forwarded as authored
 * rather than flattened to its primary subtag, which would silently answer in
 * the wrong script.
 */
function googleTargetLanguage(locale: string): string {
  return locale.toLowerCase() === 'zh' ? 'zh' : locale
}

/**
 * Microsoft's target language id.
 *
 * This endpoint picks the script from the tag itself, so the host's bare `zh`
 * — which names no script — has to be qualified to reach Simplified Chinese.
 * A tag that already names one is forwarded as authored, so `zh-Hant` still
 * answers in Traditional.
 */
function microsoftTargetLanguage(locale: string): string {
  return locale.toLowerCase() === 'zh' ? 'zh-Hans' : locale
}

/** One error's message, whatever was thrown. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * POST a JSON body and read the JSON answer, with the endpoint named in every
 * failure so a chain log says which hop broke.
 */
async function postJson(provider: string, url: string, init: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    throw new Error(`${provider} translate: ${reason(error)}`, { cause: error })
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`${provider} translate: HTTP ${String(response.status)}${detail === '' ? '' : `: ${detail.slice(0, ERROR_BODY_LIMIT)}`}`)
  }
  try {
    const payload: unknown = await response.json()
    return payload
  } catch (error) {
    throw new Error(`${provider} translate: unreadable response body: ${reason(error)}`, { cause: error })
  }
}

/** Read the first translation out of one Microsoft answer entry, or undefined. */
function microsoftEntryText(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  const translations = (entry as Record<string, unknown>)['translations']
  if (!Array.isArray(translations)) return undefined
  const first: unknown = translations[0]
  if (typeof first !== 'object' || first === null) return undefined
  const text = (first as Record<string, unknown>)['text']
  return typeof text === 'string' ? text : undefined
}

/**
 * Accept one answer batch only when it lines up with the request.
 *
 * A batch endpoint that answers short has dropped a unit somewhere, and a
 * positionally aligned result would silently pair translations with the wrong
 * entity. Rejecting the whole batch costs one fallback hop and keeps every
 * answer attached to its own text.
 */
function requireBatch(provider: string, value: unknown, expected: number): string[] {
  const expectedText = `${provider} translate: expected ${String(expected)} results`
  if (!Array.isArray(value)) throw new Error(`${expectedText}, got not an array`)
  if (value.length !== expected) throw new Error(`${expectedText}, got ${String(value.length)}`)
  // A well-sized batch whose entries carry no text is a different fault from a
  // short batch, and the two need different words to be diagnosable.
  const unreadable = value.filter(item => typeof item !== 'string').length
  if (unreadable > 0) throw new Error(`${expectedText}, but ${String(unreadable)} carried no text`)
  return value as string[]
}

/**
 * Translate one batch through Google's public endpoint.
 *
 * The body is the endpoint's own protobuf-JSON envelope: a single triple of
 * texts, source language and target language, tagged `wt_lib` so the answer
 * comes back as a plain array rather than as the widget's HTML payload.
 * @param request - the batch, its target locale and cancellation.
 * @returns the translations and the provider id.
 * @throws when the request fails, the endpoint refuses it, or the answer does not line up.
 */
export async function googleTranslate(request: MachineTranslationRequest): Promise<MachineTranslationResult> {
  if (request.texts.length === 0) return { texts: [], provider: 'google' }
  const payload = await postJson('google', GOOGLE_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': GOOGLE_API_KEY
    },
    body: JSON.stringify([[request.texts, SOURCE_LANGUAGE, googleTargetLanguage(request.locale)], 'wt_lib']),
    signal: request.signal
  })
  // The answer is one array of arrays; the outer one carries the batch.
  const batch: unknown = Array.isArray(payload) ? (payload as unknown[])[0] : undefined
  return { texts: requireBatch('google', batch, request.texts.length), provider: 'google' }
}

/**
 * Translate one batch through Microsoft's public endpoint.
 *
 * The body is the bare string array, and the languages ride the query string.
 * `isEnterpriseClient=false` selects the consumer backend, which is the one
 * that answers without authentication.
 * @param request - the batch, its target locale and cancellation.
 * @returns the translations and the provider id.
 * @throws when the request fails, the endpoint refuses it, or the answer does not line up.
 */
export async function microsoftTranslate(request: MachineTranslationRequest): Promise<MachineTranslationResult> {
  if (request.texts.length === 0) return { texts: [], provider: 'microsoft' }
  const query = new URLSearchParams({
    to: microsoftTargetLanguage(request.locale),
    isEnterpriseClient: 'false'
  })
  const payload = await postJson('microsoft', `${MICROSOFT_ENDPOINT}?${query.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request.texts),
    signal: request.signal
  })
  const texts = Array.isArray(payload) ? payload.map(microsoftEntryText) : payload
  return { texts: requireBatch('microsoft', texts, request.texts.length), provider: 'microsoft' }
}
