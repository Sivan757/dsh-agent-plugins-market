/**
 * The market settings the host carries in this plugin's own config: the loader
 * projects the entry's `Config` schema into the `dsh-agent-plugins-market`
 * settings namespace, so the Plugins panel's configuration page reads and
 * writes these six fields, and the host updates the volatile references in
 * place on every change (emitting `loader/volatile-update`).
 *
 * Every consumer reads through {@link MarketSettingsNamespace.settings} so
 * "the field is absent" has exactly one answer —
 * {@link resolveMarketSettings} — instead of each caller inventing its own
 * fallback for the window before the host applies its first value. That reader
 * also takes the interface language, because one field's default follows it
 * rather than a constant.
 *
 * @module runtime/settings-namespace
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveMarketSettings, type DownloadRegionSetting, type MarketSettings } from '../../contracts/settings.js'
import { FEEDBACK_TOOL_NAME, mountFeedbackTool } from './feedback-tool.js'
import type { HostLocaleKey, HostTranslate } from './host-locale.js'
import type { McpBackend } from '../../contracts/mcp.js'

/** The six volatile references the entry's config carries for this namespace. */
export interface MarketSettingRefs {
  mcpEnhanced: { get(): boolean | undefined }
  scanProjectLayouts: { get(): boolean | undefined }
  downloadRegion: { get(): DownloadRegionSetting | undefined }
  feedbackEnabled: { get(): boolean | undefined }
  autoUpdateSources: { get(): boolean | undefined }
  translationEnabled: { get(): boolean | undefined }
}

/** Runtime reactions the namespace drives. */
export interface SettingsNamespaceHost {
  /** Apply the project-layout discovery switch; rejection is logged and contained. */
  setScanProjectLayouts(enabled: boolean): Promise<void>
  /** Remount every MCP server after the backend switch flips. */
  refreshMcpMounts(): void
  /** Arm or disarm the background source updater. */
  setAutoUpdateSources(enabled: boolean): void
  /**
   * Forget that a translation provider failed, because translation was just
   * switched on.
   *
   * The provider chain retires a failure for the process's lifetime, and the
   * switch is the user's own "try again": without this, one cut-off generation
   * or one endpoint that was briefly down leaves the chain short a provider
   * until the process restarts, with the switch reading "on" and nothing
   * pending to show for it.
   */
  resetTranslationProviders(): void
}

export class MarketSettingsNamespace {
  private readonly refs: MarketSettingRefs
  private readonly watchers: Array<() => void> = []
  private feedbackDisposer: (() => void) | undefined
  /**
   * The feedback tool's last reported mount state. A settings change that does
   * not move it (region, backend, project layouts) must not re-log the same
   * line, and every other state is exactly one line: mounted, skipped by the
   * switch, or skipped because the host has no tools registry to register on.
   */
  private feedbackMountState: 'mounted' | 'unavailable' | 'off' | undefined

  constructor(
    private readonly ctx: Context,
    refs: MarketSettingRefs,
    private readonly dataRoot: string,
    private readonly locale: { t: HostTranslate },
    private readonly host: SettingsNamespaceHost,
    /**
     * The host interface language, read per call. It is a reader rather than a
     * captured string because a language switch must move the translation
     * default without rebuilding this namespace.
     */
    private readonly localePreference: () => string
  ) {
    // A caller may hand in a partial ref set (a test, or a config written
    // before this field existed); an absent switch reads as its default.
    this.refs = { ...refs, translationEnabled: refs.translationEnabled ?? { get: () => undefined } }
  }

  /** Subscribe the runtime reactions to live settings updates. */
  mount(): void {
    this.syncProjectLayouts()
    this.syncAutoUpdateSources()
    this.syncFeedbackTool()
    let previousBackend = this.settings().mcpEnhanced
    let previousTranslation = this.settings().translationEnabled
    const watcher = this.ctx.on('loader/volatile-update' as Parameters<Context['on']>[0], () => {
      const backend = this.settings().mcpEnhanced
      if (backend !== previousBackend) {
        previousBackend = backend
        this.host.refreshMcpMounts()
      }
      previousTranslation = this.syncTranslationProviders(previousTranslation)
      this.syncProjectLayouts()
      this.syncAutoUpdateSources()
      this.syncFeedbackTool()
    })
    this.watchers.push(watcher)
  }

  /** Release every watcher and unmount the feedback tool. */
  dispose(): void {
    for (const release of this.watchers.splice(0)) release()
    this.feedbackDisposer?.()
    this.feedbackDisposer = undefined
  }

  /**
   * The resolved settings, from the volatile references the host updates in
   * place and the interface language they resolve over.
   */
  private settings(): MarketSettings {
    return resolveMarketSettings(
      {
        mcpEnhanced: this.refs.mcpEnhanced.get(),
        scanProjectLayouts: this.refs.scanProjectLayouts.get(),
        downloadRegion: this.refs.downloadRegion.get(),
        feedbackEnabled: this.refs.feedbackEnabled.get(),
        autoUpdateSources: this.refs.autoUpdateSources.get(),
        translationEnabled: this.refs.translationEnabled.get()
      },
      this.localePreference()
    )
  }

  /** The persisted MCP backend choice; the built-in client until the host applies a value. */
  async backend(): Promise<McpBackend> {
    return this.settings().mcpEnhanced ? 'builtin' : 'host'
  }

  /**
   * Legacy write path for the backend choice: the value now lives in the host
   * settings document, edited from the Plugins panel's configuration page, so
   * this accepts the request and lets the volatile reference decide.
   */
  async setBackend(backend: McpBackend): Promise<void> {
    this.ctx.logger?.info?.(`[dsh-agent-plugins-market] legacy MCP backend write (${backend}) ignored — the value lives in the host settings document`)
  }

  /** The persisted download-region setting. */
  async downloadRegion(): Promise<DownloadRegionSetting> {
    return this.settings().downloadRegion
  }

  /**
   * Read the live translation switch: the user's stored value while they have
   * one, the interface language's default otherwise.
   */
  translationEnabled(): boolean {
    return this.settings().translationEnabled
  }

  /**
   * Give the provider chain a clean slate when translation is switched back on.
   *
   * Only the off-to-on edge: every other settings write leaves a retired
   * provider retired, which is what keeps an unreachable endpoint from costing
   * a timeout per settings change.
   * @param previous - whether translation was on at the last look.
   * @returns whether it is on now, for the next comparison.
   */
  private syncTranslationProviders(previous: boolean): boolean {
    const enabled = this.settings().translationEnabled
    if (enabled && !previous) {
      try {
        this.host.resetTranslationProviders()
      } catch (error) {
        this.ctx.logger?.error?.(`[dsh-agent-plugins-market] translation provider reset failed: ${String(error)}`)
      }
    }
    return enabled
  }

  /** Apply the background source-update switch. */
  private syncAutoUpdateSources(): void {
    try {
      this.host.setAutoUpdateSources(this.settings().autoUpdateSources)
    } catch (error) {
      this.ctx.logger?.error?.(`[dsh-agent-plugins-market] background source update switch failed: ${String(error)}`)
    }
  }

  private syncProjectLayouts(): void {
    void this.host.setScanProjectLayouts(this.settings().scanProjectLayouts).catch(error => {
      this.ctx.logger?.error?.(`[dsh-agent-plugins-market] project layout reconciliation failed: ${String(error)}`)
    })
  }

  private syncFeedbackTool(): void {
    try {
      const wanted = this.settings().feedbackEnabled
      if (!wanted) {
        if (this.feedbackDisposer !== undefined) {
          this.feedbackDisposer()
          this.feedbackDisposer = undefined
        }
      } else if (this.feedbackDisposer === undefined) {
        this.feedbackDisposer = mountFeedbackTool(this.ctx, this.dataRoot, (key, params) => this.locale.t(key as HostLocaleKey, params)) ?? undefined
      }
      const state: NonNullable<typeof this.feedbackMountState> = !wanted ? 'off' : this.feedbackDisposer === undefined ? 'unavailable' : 'mounted'
      if (state === this.feedbackMountState) return
      this.feedbackMountState = state
      if (state === 'mounted') {
        this.ctx.logger?.info?.(`[dsh-agent-plugins-market] ${FEEDBACK_TOOL_NAME} mounted on the host tools registry`)
      } else if (state === 'off') {
        this.ctx.logger?.info?.(`[dsh-agent-plugins-market] ${FEEDBACK_TOOL_NAME} not mounted: feedbackEnabled is off`)
      } else {
        this.ctx.logger?.warn?.(`[dsh-agent-plugins-market] ${FEEDBACK_TOOL_NAME} not mounted: the host exposes no tools registry`)
      }
    } catch (error) {
      this.ctx.logger?.error?.(`[dsh-agent-plugins-market] feedback tool mount failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    }
  }
}
