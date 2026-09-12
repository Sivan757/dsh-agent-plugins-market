/**
 * The host settings namespace this plugin registers.
 *
 * The registration is also what makes the host's plugin-config tab serve this
 * plugin's card, and it carries the MCP mount backend, the download region,
 * the project-layout switch, the experience-feedback tool switch, and the
 * background source-update switch. `settings.register`
 * throws on a duplicate namespace, so there is exactly one inject block and one
 * registration.
 *
 * The whole callback is failure-contained on purpose: a throw inside it is
 * INVISIBLE in the UI (the inject resolves asynchronously and cordis only logs
 * it) and silently removes the namespace from `settings.describe`, which is
 * what hides the plugin-config card. Every failure mode lands in the logger
 * with a loud prefix instead.
 *
 * @module runtime/settings-namespace
 */
import type { Context } from '@deepseek-ai/cordis'
import { FEEDBACK_TOOL_NAME, mountFeedbackTool } from './feedback-tool.js'
import type { HostLocaleKey, HostTranslate } from './host-locale.js'
import { MCP_SETTINGS_NAMESPACE, MarketSettingsSchema, readMcpBackend, type McpBackend } from './mcp-backend.js'
import { narrowDownloadRegion, type DownloadRegionSetting } from './regions.js'

/** Settings values this plugin reads; anything else reads as its default. */
export interface MarketSettings {
  mcpEnhanced?: boolean
  scanProjectLayouts?: boolean
  downloadRegion?: unknown
  feedbackEnabled?: boolean
  autoUpdateSources?: boolean
}

/** The scope the host hands back for a registered namespace. */
interface SettingsScope {
  get(): MarketSettings
  watch(callback: () => void): () => void
  update(patch: Partial<MarketSettings>): Promise<void>
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
  private scope: SettingsScope | undefined
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
    private readonly dataRoot: string,
    private readonly locale: { t: HostTranslate },
    private readonly host: SettingsNamespaceHost
  ) {}

  /** Register the namespace; the host resolves it whenever the settings service mounts. */
  mount(): void {
    this.ctx.inject(['settings'], settingsCtx => this.register(settingsCtx))
  }

  /** The persisted MCP backend choice; the built-in client until registration lands. */
  async backend(): Promise<McpBackend> {
    return this.scope !== undefined && this.scope.get().mcpEnhanced === false ? 'host' : 'builtin'
  }

  /**
   * Persist a backend choice.
   * @throws when the settings service is not mounted.
   */
  async setBackend(backend: McpBackend): Promise<void> {
    if (this.scope === undefined) throw new Error('the settings service is not mounted')
    await this.scope.update({ mcpEnhanced: backend !== 'host' })
  }

  /** The persisted download-region setting. */
  async downloadRegion(): Promise<DownloadRegionSetting> {
    return narrowDownloadRegion(this.scope?.get().downloadRegion)
  }

  /** Release every watcher and unmount the feedback tool. */
  dispose(): void {
    for (const release of this.watchers.splice(0)) release()
    this.feedbackDisposer?.()
    this.feedbackDisposer = undefined
  }

  private register(settingsCtx: unknown): void {
    try {
      this.ctx.logger?.info?.('[dsh-agent-plugins-market] settings inject resolved — registering namespace')
      const settings = (
        settingsCtx as {
          settings: {
            register(ns: string, schema: unknown, options?: { base?: MarketSettings }): SettingsScope
          }
        }
      ).settings
      const scope = settings.register(MCP_SETTINGS_NAMESPACE, MarketSettingsSchema, {
        base: { mcpEnhanced: true, downloadRegion: 'auto', feedbackEnabled: true, scanProjectLayouts: true }
      })
      this.scope = scope
      this.ctx.logger?.info?.('[dsh-agent-plugins-market] settings namespace registered — plugin-config card will serve')
      this.syncProjectLayouts()
      this.watchers.push(scope.watch(() => this.syncProjectLayouts()))
      this.syncAutoUpdateSources()
      this.watchers.push(scope.watch(() => this.syncAutoUpdateSources()))
      // One-time migration from the earlier data-root settings.json choice.
      void readMcpBackend(this.dataRoot).then(backend => {
        if (backend === 'host') void scope.update({ mcpEnhanced: false }).catch(() => {})
      })
      let previousBackend = scope.get().mcpEnhanced !== false
      this.watchers.push(
        scope.watch(() => {
          const backend = scope.get().mcpEnhanced !== false
          if (backend === previousBackend) return
          previousBackend = backend
          this.host.refreshMcpMounts()
        })
      )
      // The experience-feedback model tool: gated by the namespace's
      // `feedbackEnabled` field (default on); the switch unregisters it. The
      // tool mount is doubly contained — its failure must never take the
      // settings namespace (and with it the config card) down with it. The
      // mount outcome is logged on every transition so an absent
      // `report_market_issue` in a session is traceable to its cause.
      this.syncFeedbackTool()
      this.watchers.push(scope.watch(() => this.syncFeedbackTool()))
    } catch (error) {
      this.ctx.logger?.error?.(
        `[dsh-agent-plugins-market] settings namespace registration failed — the plugin-config card will be hidden this boot: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
      )
    }
  }

  /** Apply the background source-update switch; OFF is the default. */
  private syncAutoUpdateSources(): void {
    try {
      this.host.setAutoUpdateSources(this.scope?.get().autoUpdateSources === true)
    } catch (error) {
      this.ctx.logger?.error?.(`[dsh-agent-plugins-market] background source update switch failed: ${String(error)}`)
    }
  }

  private syncProjectLayouts(): void {
    void this.host.setScanProjectLayouts(this.scope?.get().scanProjectLayouts !== false).catch(error => {
      this.ctx.logger?.error?.(`[dsh-agent-plugins-market] project layout reconciliation failed: ${String(error)}`)
    })
  }

  private syncFeedbackTool(): void {
    try {
      const wanted = this.scope?.get().feedbackEnabled !== false
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
