/**
 * The market settings the host carries in this plugin's own config: the loader
 * projects the entry's `Config` schema into the `dsh-agent-plugins-market`
 * settings namespace, so the Plugins panel's configuration page reads and
 * writes these five switches, and the host updates the volatile references in
 * place on every change (emitting `loader/volatile-update`).
 *
 * Every consumer reads through {@link MarketSettingsNamespace.settings} so
 * "the field is absent" has exactly one answer —
 * {@link resolveMarketSettings} — instead of each caller inventing its own
 * fallback for the window before the host applies its first value.
 *
 * @module runtime/settings-namespace
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveMarketSettings, type DownloadRegionSetting, type MarketSettings } from '../contracts/settings.js'
import { FEEDBACK_TOOL_NAME, mountFeedbackTool } from './feedback-tool.js'
import type { HostLocaleKey, HostTranslate } from './host-locale.js'
import type { McpBackend } from '../contracts/mcp.js'

/** The five volatile references the entry's config carries for this namespace. */
export interface MarketSettingRefs {
  mcpEnhanced: { get(): boolean | undefined }
  scanProjectLayouts: { get(): boolean | undefined }
  downloadRegion: { get(): DownloadRegionSetting | undefined }
  feedbackEnabled: { get(): boolean | undefined }
  autoUpdateSources: { get(): boolean | undefined }
}

/** Runtime reactions the namespace drives. */
export interface SettingsNamespaceHost {
  /** Apply the project-layout discovery switch; rejection is logged and contained. */
  setScanProjectLayouts(enabled: boolean): Promise<void>
  /** Remount every MCP server after the backend switch flips. */
  refreshMcpMounts(): void
  /** Arm or disarm the background source updater. */
  setAutoUpdateSources(enabled: boolean): void
}

export class MarketSettingsNamespace {
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
    private readonly refs: MarketSettingRefs,
    private readonly dataRoot: string,
    private readonly locale: { t: HostTranslate },
    private readonly host: SettingsNamespaceHost
  ) {}

  /** Subscribe the runtime reactions to live settings updates. */
  mount(): void {
    this.syncProjectLayouts()
    this.syncAutoUpdateSources()
    this.syncFeedbackTool()
    let previousBackend = this.settings().mcpEnhanced
    const watcher = this.ctx.on('loader/volatile-update' as Parameters<Context['on']>[0], () => {
      const backend = this.settings().mcpEnhanced
      if (backend !== previousBackend) {
        previousBackend = backend
        this.host.refreshMcpMounts()
      }
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
   * The resolved settings, from the volatile references the host updates in place.
   */
  private settings(): MarketSettings {
    return resolveMarketSettings({
      mcpEnhanced: this.refs.mcpEnhanced.get(),
      scanProjectLayouts: this.refs.scanProjectLayouts.get(),
      downloadRegion: this.refs.downloadRegion.get(),
      feedbackEnabled: this.refs.feedbackEnabled.get(),
      autoUpdateSources: this.refs.autoUpdateSources.get()
    })
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
