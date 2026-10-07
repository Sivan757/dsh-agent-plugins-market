/** Market overview cache, invalidation, and source-progress resource helpers. */
import { fetchOverview, fetchSourceProgress, type OverviewData, type SourceProgress } from '../../api.js'

/** UI state emitted while a source mutation is in flight. */
export interface SourceProgressState {
  step: string | undefined
  error: string | undefined
}

const EMPTY_OVERVIEW: OverviewData = { sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '', data: '' }, unmanaged: [] }

let cachedOverview: OverviewData | undefined
let inflightOverview: Promise<OverviewData> | undefined
let overviewGeneration = 0

/** Load the last overview immediately and revalidate one shared request. */
export function loadOverview(): { initial: OverviewData; revalidating: boolean; promise: Promise<OverviewData> } {
  const initial = cachedOverview ?? EMPTY_OVERVIEW
  if (inflightOverview === undefined) {
    const generation = overviewGeneration
    inflightOverview = fetchOverview()
      .then(data => {
        if (overviewGeneration === generation) cachedOverview = data
        return data
      })
      .finally(() => {
        if (overviewGeneration === generation) inflightOverview = undefined
      })
  }
  return { initial, revalidating: cachedOverview === undefined, promise: inflightOverview }
}

/** Invalidate the shared overview after a mutating action. */
export function invalidateOverview(): void {
  overviewGeneration += 1
  inflightOverview = undefined
  cachedOverview = undefined
}

/**
 * Re-read the overview while text is still being translated.
 *
 * Translation happens off the read path, so the first response carries the
 * upstream text plus a count of fields still in flight. This polls until
 * that count reaches zero, which swaps the translated text in without the user
 * refreshing. Polling stops on the first error, on a response with nothing
 * pending, and when the caller unmounts — a panel that never resolves its
 * translations must not poll forever.
 * @param report - receives each re-read overview.
 * @param isStopped - read before every tick, so an unmounted panel stops.
 * @returns a handle that cancels the next tick.
 */
export function startDescriptionRefresh(report: (data: OverviewData) => void, isStopped: () => boolean = () => false): { stop: () => void } {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async (): Promise<void> => {
    if (stopped || isStopped()) return
    try {
      invalidateOverview()
      const data = await loadOverview().promise
      if (stopped || isStopped()) return
      report(data)
      if ((data.translationPending ?? 0) === 0) return
    } catch {
      // A failed re-read keeps the current text; the panel stays usable.
      return
    }
    if (!stopped) {
      timer = setTimeout(() => {
        void tick()
      }, 1_500)
    }
  }
  timer = setTimeout(() => {
    void tick()
  }, 1_500)
  return {
    stop: () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

/**
 * Poll source mutation progress until stopped. Poll failures remain silent
 * because the add-source request is authoritative for mutation success.
 */
export function startSourceProgressPolling(
  report: (state: SourceProgressState) => void,
  resolveStep: (step: SourceProgress['step']) => string = step => step
): { stop: () => void } {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async (): Promise<void> => {
    if (stopped) return
    try {
      const progress = await fetchSourceProgress()
      if (!stopped && progress.active) report({ step: resolveStep(progress.step), error: undefined })
    } catch {
      // Transient poll failures are ignored; the add request reports real errors.
    }
    if (!stopped)
      timer = setTimeout(() => {
        void tick()
      }, 800)
  }
  timer = setTimeout(() => {
    void tick()
  }, 400)
  return {
    stop: () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
