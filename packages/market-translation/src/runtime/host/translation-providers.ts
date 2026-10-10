/**
 * The host's translation chain: the two keyless endpoints, then the user's model.
 *
 * The order is the market's quality order — a public endpoint answers in under
 * a second and costs the operator nothing, while a model call spends the user's
 * own quota, so it is asked last. The chain itself decides what a failure means;
 * this module only supplies the hops.
 *
 * Masking is applied here rather than inside the endpoint adapters, so every
 * hop in the returned array carries the same guarantee: what goes out is
 * placeholders, and an answer that lost one is rejected instead of rendered.
 * @module runtime/host/translation-providers
 */
import type { TranslationProvider } from '../../application/translation/chain.js'
import { googleTranslate, microsoftTranslate } from './machine-translator.js'
import { maskText, unmaskText, type MaskedText } from './text-masking.js'

/** Everything the chain needs to assemble its hops. */
export interface TranslationProviderOptions {
  /** Host context; read structurally so tests can pass a stub. */
  host: { get?(name: string): unknown }
  /** The LLM-backed provider, already built by the caller (may be undefined). */
  llm?: TranslationProvider | undefined
}

/** Retry is one subset of the original batch, with complete input semantics. */
const MAX_REPAIR_INPUTS = 20
const STRUCTURE_MARKER = /⟪d\d+⟫/g

function restoreAnswer(source: string, masked: MaskedText, answer: string): string | undefined {
  const text = unmaskText(answer, masked.placeholders)
  if (text === undefined) return undefined
  const expected = source.match(STRUCTURE_MARKER) ?? []
  const actual = text.match(STRUCTURE_MARKER) ?? []
  if (expected.length !== actual.length || expected.some((marker, i) => marker !== actual[i])) return undefined
  return text.replace(STRUCTURE_MARKER, '').trim() === '' ? undefined : text
}

/**
 * Preserve valid siblings and retry damaged structural inputs once, in full.
 * A failed repair stays empty for the localizer retry policy. Formatting leaves
 * never become separate translation requests.
 */
function withMasking(base: TranslationProvider): TranslationProvider {
  return {
    id: base.id,
    available: () => base.available(),
    async translate(request): Promise<string[]> {
      const masked = request.texts.map(maskText)
      const translated = await base.translate({ ...request, texts: masked.map(entry => entry.text) })
      request.signal.throwIfAborted()
      if (translated.length !== masked.length) throw new Error(base.id + ' translate: result count mismatch')
      const restored = request.texts.map(() => '')
      /** First reason one slot could not be answered, reported only if no slot was. */
      let firstFailure: string | undefined
      const repairs: number[] = []
      for (let index = 0; index < request.texts.length; index++) {
        const source = request.texts[index]!
        const answer = translated[index]!
        const text = restoreAnswer(source, masked[index]!, answer)
        if (text !== undefined) {
          restored[index] = text
          continue
        }
        const markers = source.match(STRUCTURE_MARKER) ?? []
        // Empty results and unstructured descriptions keep the existing retry
        // policy. Only damaged structural prose gets the whole-input retry.
        const prose = answer.replace(/⟦?[A-Z]\d+⟧|⟪d\d+⟫/g, '').trim()
        if (markers.length === 0) {
          firstFailure ??= base.id + ' translate: the answer lost or duplicated a placeholder'
          continue
        }
        if (prose === '') {
          firstFailure ??= base.id + ' translate: invalid translated text'
          continue
        }
        if (repairs.length < MAX_REPAIR_INPUTS) repairs.push(index)
      }
      if (repairs.length > 0) {
        request.signal.throwIfAborted()
        try {
          const answers = await base.translate({ ...request, texts: repairs.map(index => masked[index]!.text) })
          request.signal.throwIfAborted()
          if (answers.length !== repairs.length) throw new Error(base.id + ' translate: repair result count mismatch')
          repairs.forEach((index, offset) => {
            restored[index] = restoreAnswer(request.texts[index]!, masked[index]!, answers[offset]!) ?? ''
          })
        } catch (error) {
          if (request.signal.aborted) throw error
          // Valid siblings remain available when the complete-input retry fails.
        }
      }
      request.signal.throwIfAborted()
      if (restored.every(text => text === '')) throw new Error(firstFailure ?? base.id + ' translate: no valid translations')
      return restored
    }
  }
}

/**
 * Build the ordered chain: google -> microsoft -> llm.
 *
 * The two public endpoints report themselves available unconditionally: they
 * need no key, no registration and no configuration, which is what makes
 * translation work out of the box on a fresh deployment. Whether one of them
 * actually answers is settled by calling it, and the chain's circuit breaker is
 * what stops a blocked network from costing a timeout per batch.
 *
 * The model hop is absent when the caller has none, so a deployment without a
 * configured route gets a two-hop chain rather than a hop that always fails.
 *
 * The host context is accepted but unread: neither keyless endpoint needs a
 * seam, and the field is part of the composition root's frozen call shape so a
 * keyed provider can join the chain without changing that call.
 * @param options - the host context and the already-built model provider.
 * @returns the chain, best hop first.
 */
export function createTranslationProviders(options: TranslationProviderOptions): TranslationProvider[] {
  const providers: TranslationProvider[] = [
    withMasking({
      id: 'google',
      available: () => true,
      translate: async request => (await googleTranslate(request)).texts
    }),
    withMasking({
      id: 'microsoft',
      available: () => true,
      translate: async request => (await microsoftTranslate(request)).texts
    })
  ]
  if (options.llm !== undefined) providers.push(withMasking(options.llm))
  return providers
}
