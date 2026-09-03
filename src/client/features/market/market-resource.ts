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

/** Load the last overview immediately and revalidate one shared request. */
export function loadOverview(): { initial: OverviewData; revalidating: boolean; promise: Promise<OverviewData> } {
  const initial = cachedOverview ?? EMPTY_OVERVIEW
  if (inflightOverview === undefined) {
    inflightOverview = fetchOverview()
      .then(data => {
        cachedOverview = data
        return data
      })
      .finally(() => {
        inflightOverview = undefined
      })
  }
  return { initial, revalidating: cachedOverview === undefined, promise: inflightOverview }
}

/** Invalidate the shared overview after a mutating action. */
export function invalidateOverview(): void {
  cachedOverview = undefined
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
