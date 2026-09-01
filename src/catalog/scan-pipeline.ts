/**
 * Source scan pipeline: a servlet-filter-style strategy chain with
 * classloader-delegation semantics.
 *
 * The chain owns one question — "which suite roots does this checkout
 * declare?" — that several discovery shapes can answer: a marketplace
 * manifest listing entries, nested plugin directories, or a flat collection
 * of skill directories. Each filter either resolves the checkout (short-
 * circuiting the chain) or abstains with a reason, forwarding to the next
 * filter. The last filter is terminal: it always answers, so a checkout
 * never falls off the end silently.
 *
 * Resolution requires *productive* output: a filter that recognizes the
 * layout but yields zero suites is an abstention, not a hit. That is the
 * bug class this pipeline exists to prevent — a parseable marketplace whose
 * entries all fail to resolve used to short-circuit the scan into an empty
 * result with no fallback and no diagnostic.
 *
 * Filter order is parent-first delegation, most specific shape first. Every
 * attempt is recorded on the result, so callers can surface why a source
 * resolved the way it did.
 */
import type { Suite } from '../model/types.js'

/** One filter's work context: the checkout and its identity. */
export interface ScanContext {
  /** Absolute path of the source checkout. */
  checkout: string
  /** The configured source id suites will be attributed to. */
  sourceId: string
  /** The dimension being scanned. */
  dimension: 'user' | 'project'
  /** The source's own URL, when known; used by self-reference handling. */
  sourceUrl?: string
  /** Diagnostics accumulated across the chain (append-only). */
  notes: string[]
}

/** Why a filter did not resolve the checkout. */
export type ScanAbstentionReason = string

/** The outcome of one filter (or the whole chain) for one checkout. */
export type ScanResolution = { kind: 'resolved'; suites: Suite[] } | { kind: 'abstain'; reason: ScanAbstentionReason }

/** The rest of the chain beyond the filter that holds it. */
export interface ScanChain {
  /** Hand the checkout to the next filter; terminal when none remain. */
  next(context: ScanContext): Promise<ScanResolution>
}

/** One strategy in the source scan chain. */
export interface ScanFilter {
  /** Stable filter name, recorded on every attempt. */
  readonly name: string
  /** Either resolve the checkout or forward to `chain.next`. */
  doScan(context: ScanContext, chain: ScanChain): Promise<ScanResolution>
}

/** One recorded chain attempt. */
export interface ScanAttempt {
  filter: string
  outcome: 'resolved' | 'abstain'
  /** Suites produced when resolved; the abstention reason otherwise. */
  detail: string
  /** Suite ids produced, when resolved. */
  suiteIds: string[]
}

/** The full outcome of scanning one checkout. */
export interface ScanResult {
  suites: Suite[]
  attempts: ScanAttempt[]
  /** Human-readable diagnostics: dropped entries, broken manifests, fallbacks taken. */
  notes: string[]
}

/** Drive one checkout through the filter chain, recording every attempt. */
export async function runScanChain(filters: readonly ScanFilter[], context: ScanContext): Promise<ScanResult> {
  const attempts: ScanAttempt[] = []
  const notes = context.notes
  const run = async (index: number): Promise<ScanResolution> => {
    const filter = filters[index]
    if (filter === undefined) {
      // Terminal: the chain must always answer. A checkout that reaches the
      // end declares nothing this manager understands.
      return { kind: 'resolved', suites: [] }
    }
    const productive = (resolution: ScanResolution): resolution is { kind: 'resolved'; suites: Suite[] } => resolution.kind === 'resolved' && resolution.suites.length > 0
    // A filter that delegates has no answer of its own: recording its
    // delegation as an abstention keeps the attempt trace complete.
    let delegated = false
    const remaining: ScanChain = {
      next: _ctx => {
        delegated = true
        return run(index + 1)
      }
    }
    const resolution = await filter.doScan(context, remaining)
    // A delegated resolution was already recorded by the inner filter that
    // produced it: mark this filter's delegation and pass the answer through.
    if (delegated) {
      attempts.push({ filter: filter.name, outcome: 'abstain', detail: 'delegated', suiteIds: [] })
      return resolution
    }
    const hit = productive(resolution)
    attempts.push({
      filter: filter.name,
      outcome: hit ? 'resolved' : 'abstain',
      detail: hit ? `${resolution.suites.length} suite(s)` : resolution.kind === 'abstain' ? resolution.reason : '0 suite(s)',
      suiteIds: hit ? resolution.suites.map(suite => suite.id) : []
    })
    if (!hit) {
      if (resolution.kind === 'abstain') {
        notes.push(`filter "${filter.name}" abstained: ${resolution.reason}`)
      } else {
        notes.push(`filter "${filter.name}" recognized the checkout but produced no suites; falling through`)
      }
      // Recognized but unproductive: later strategies still get their chance.
      return run(index + 1)
    }
    return resolution
  }
  const resolution = await run(0)
  return { suites: resolution.kind === 'resolved' ? resolution.suites : [], attempts, notes }
}
