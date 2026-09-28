/**
 * Optional background refresh of every configured market source.
 *
 * The `autoUpdateSources` setting (default off) turns this on from the
 * plugin-config card. While enabled the updater runs one refresh pass every
 * {@link AUTO_UPDATE_INTERVAL_MS} and then waits again; the first pass runs a
 * full interval after the switch flips, so enabling the feature never starts
 * network traffic as a surprise. A pass that is still running when the next
 * tick arrives is skipped rather than queued. The repetition rides the fiber's
 * timer seat, so it dies with this plugin.
 * @module runtime/source-auto-update
 */

import type { Context } from '@deepseek-ai/cordis'
import { repeat } from './timer-seat.js'

/** How often the background updater refreshes every source. */
export const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Refresh callback shape: one pass over every configured source. */
export type SourceRefresh = () => Promise<void>

export class SourceAutoUpdater {
  private stop: (() => void) | undefined
  private inFlight = false

  constructor(
    private readonly ctx: Context,
    private readonly refresh: SourceRefresh,
    private readonly intervalMs: number = AUTO_UPDATE_INTERVAL_MS
  ) {}

  /** Whether a refresh timer is currently armed. */
  get enabled(): boolean {
    return this.stop !== undefined
  }

  /** Arm or disarm the interval; repeated calls with the same state do nothing. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    if (!enabled) {
      this.stop?.()
      this.stop = undefined
      this.ctx.logger?.info?.('[dsh-agent-plugins-market] background source updates off')
      return
    }
    this.stop = repeat(this.ctx, () => void this.run(), this.intervalMs)
    this.ctx.logger?.info?.(`[dsh-agent-plugins-market] background source updates on: every ${Math.round(this.intervalMs / 60_000)} minutes`)
  }

  /** Disarm the interval; an in-flight pass finishes on its own. */
  dispose(): void {
    this.stop?.()
    this.stop = undefined
  }

  private async run(): Promise<void> {
    if (this.inFlight) {
      this.ctx.logger?.warn?.('[dsh-agent-plugins-market] background source update skipped: the previous pass is still running')
      return
    }
    this.inFlight = true
    try {
      await this.refresh()
      this.ctx.logger?.info?.('[dsh-agent-plugins-market] background source update finished')
    } catch (error) {
      this.ctx.logger?.warn?.(`[dsh-agent-plugins-market] background source update failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.inFlight = false
    }
  }
}
