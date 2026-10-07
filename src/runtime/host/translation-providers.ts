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

/** Repair never sends more text than the failed inputs or more than one normal batch of leaves. */
const MAX_REPAIR_LEAVES = 60
const REPAIR_BATCH_SIZE = 20
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
 * Keep valid answers in their original positions. A damaged structural answer
 * gets one bounded same-provider repair from original leaf text. Markers are
 * reconstructed locally, never guessed from damaged output. A slot neither the
 * answer nor a repair can fill stays empty and enters the localizer's per-text
 * retry policy, so one damaged answer never discards its valid siblings. The
 * batch fails only when every slot is empty, which is the failure the chain
 * retires the provider on.
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
      const leaves: { source: string; mask: MaskedText }[] = []
      const repairs: { index: number; markers: string[]; parts: { text: string; result?: number }[] }[] = []
      for (let index = 0; index < request.texts.length; index++) {
        const source = request.texts[index]!
        const answer = translated[index]!
        const text = restoreAnswer(source, masked[index]!, answer)
        if (text !== undefined) {
          restored[index] = text
          continue
        }
        const markers = source.match(STRUCTURE_MARKER) ?? []
        // Empty/marker-only output is not a damaged translation to repair, and
        // an unstructured text has no leaves to repair it from: both leave the
        // slot empty for the localizer's own retry rather than failing the
        // batch, so a sibling's valid answer is still delivered.
        const prose = answer.replace(/⟦?[A-Z]\d+⟧|⟪d\d+⟫/g, '').trim()
        if (markers.length === 0) {
          firstFailure ??= base.id + ' translate: the answer lost or duplicated a placeholder'
          continue
        }
        if (prose === '') {
          firstFailure ??= base.id + ' translate: invalid translated text'
          continue
        }
        const pieces = source.split(STRUCTURE_MARKER)
        const count = pieces.filter(part => part.trim() !== '').length
        if (leaves.length + count > MAX_REPAIR_LEAVES) continue
        const parts = pieces.map(part => {
          if (part.trim() === '') return { text: part }
          const result = leaves.length
          leaves.push({ source: part, mask: maskText(part) })
          return { text: part, result }
        })
        repairs.push({ index, markers, parts })
      }
      if (leaves.length > 0) {
        request.signal.throwIfAborted()
        try {
          const answers: string[] = []
          for (let offset = 0; offset < leaves.length; offset += REPAIR_BATCH_SIZE) {
            request.signal.throwIfAborted()
            const batch = leaves.slice(offset, offset + REPAIR_BATCH_SIZE)
            const translatedLeaves = await base.translate({ ...request, texts: batch.map(leaf => leaf.mask.text) })
            request.signal.throwIfAborted()
            if (translatedLeaves.length !== batch.length) throw new Error(base.id + ' translate: repair result count mismatch')
            answers.push(...translatedLeaves)
          }
          for (const repair of repairs) {
            const parts = repair.parts.map(part => {
              if (part.result === undefined) return part.text
              const leaf = leaves[part.result]!
              const answer = answers[part.result]!
              // A leaf can disappear naturally, but must preserve its protected spans.
              const text = unmaskText(answer, leaf.mask.placeholders)
              return text !== undefined && (text.match(STRUCTURE_MARKER) ?? []).length === 0 ? text : undefined
            })
            if (parts.some(part => part === undefined)) continue
            const text = parts.map((part, i) => (i === 0 ? '' : repair.markers[i - 1]!) + part!).join('')
            if (text.replace(STRUCTURE_MARKER, '').trim() !== '') restored[repair.index] = text
          }
        } catch (error) {
          if (request.signal.aborted) throw error
          // Already validated answers remain usable; only repair candidates fail.
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
