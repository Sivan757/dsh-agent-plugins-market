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
import { maskText, unmaskText } from './text-masking.js'

/** Everything the chain needs to assemble its hops. */
export interface TranslationProviderOptions {
  /** Host context; read structurally so tests can pass a stub. */
  host: { get?(name: string): unknown }
  /** The LLM-backed provider, already built by the caller (may be undefined). */
  llm?: TranslationProvider | undefined
}

/**
 * Wrap one provider so its batch is masked on the way out and restored on the
 * way back.
 *
 * A restored batch is all-or-nothing: one lost placeholder throws for the whole
 * batch, which the chain turns into a fallback hop. Keeping the good entries
 * would mean returning a batch whose positions no longer match the request.
 * @param base - the provider to wrap.
 * @returns the same provider id and availability, with masking applied.
 */
function withMasking(base: TranslationProvider): TranslationProvider {
  return {
    id: base.id,
    available: () => base.available(),
    async translate(request: { texts: readonly string[]; locale: string; signal: AbortSignal }): Promise<string[]> {
      const masked = request.texts.map(text => maskText(text))
      const translated = await base.translate({ texts: masked.map(entry => entry.text), locale: request.locale, signal: request.signal })
      if (translated.length !== masked.length) {
        throw new Error(`${base.id} translate: expected ${String(masked.length)} results, got ${String(translated.length)}`)
      }
      const restored: string[] = []
      for (let index = 0; index < masked.length; index += 1) {
        const entry = masked[index]
        const answer = translated[index]
        if (entry === undefined || answer === undefined) throw new Error(`${base.id} translate: missing result at position ${String(index)}`)
        const text = unmaskText(answer, entry.placeholders)
        if (text === undefined) throw new Error(`${base.id} translate: the answer lost or duplicated a placeholder`)
        restored.push(text)
      }
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
