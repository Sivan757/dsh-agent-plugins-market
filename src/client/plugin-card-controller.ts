/**
 * Staged form behind the Agent Plugins Market card on the host's plugin
 * configuration tab.
 *
 * The card's controls edit the market's host settings namespace, so every write
 * is a durable, revision-fenced document mutation the node half reacts to —
 * flipping the MCP switch tears down and remounts suite servers. The form
 * therefore stages what the user picks and writes it on save, which is the
 * contract every card in this slot follows: what is on screen is exactly what a
 * save would store, one save is one committed change, and a field the user
 * never touched stays untouched.
 *
 * Every default the card renders comes from the contract module, which is the
 * single place a default is written; the card never restates one. A field still
 * carrying no user-layer entry is marked overridable rather than overridden, and
 * resetting it clears the entry instead of writing today's default in, so the
 * field goes back to following the plugin rather than pinning the value it
 * happened to have.
 *
 * @module client/plugin-card-controller
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { MARKET_SETTINGS_DEFAULTS, type DownloadRegionSetting, type MarketSettingKey, type MarketSettings } from '../contracts/settings.js'
import type { McpBackendInfo } from './api.js'

/** The boolean switches this card renders, in display order. */
export const MARKET_SWITCH_FIELDS = ['mcpEnhanced', 'scanProjectLayouts', 'autoUpdateSources', 'feedbackEnabled'] as const

/** One boolean switch the card renders. */
export type MarketSwitchField = (typeof MARKET_SWITCH_FIELDS)[number]

/** Browser-local state of one switch: what it shows, and what a save would do. */
export interface MarketSwitchState {
  /** The staged value when one stands, otherwise the document's resolved value. */
  value: boolean
  /** Whether saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** Whether this field holds an uncommitted edit. */
  staged: boolean
}

/** Browser-local state of the download-region choice. */
export interface MarketRegionState {
  value: DownloadRegionSetting
  overridden: boolean
  staged: boolean
}

/** Form state of the market card, shared with every other card in the slot. */
export interface MarketCardShell {
  /** False while the host serves no section for this namespace; the card renders nothing. */
  available: boolean
  /** Whether the host settings document accepts writes. */
  writable: boolean
  /** Whether the form holds edits a save would write. */
  dirty: boolean
  /** Whether any staged draft is one no field accepts, which blocks the save. */
  invalid: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
}

/** What the market card renders. */
export interface MarketPluginCardState extends MarketCardShell {
  mcpEnhanced: MarketSwitchState
  scanProjectLayouts: MarketSwitchState
  autoUpdateSources: MarketSwitchState
  feedbackEnabled: MarketSwitchState
  downloadRegion: MarketRegionState
  /** Live host-client probe driving the compat-mode guard and the region hint. */
  probe: McpBackendInfo | undefined
  /** Whether the host client is known to be missing, which blocks compat mode. */
  hostClientMissing: boolean
}

/** The actions the card's slot registration injects. */
export interface MarketPluginCardActions {
  /** Stage the opposite of one switch's current value. */
  toggle: (field: MarketSwitchField) => void
  /** Stage an explicit download region. */
  setRegion: (next: 'global' | 'china') => void
  /** Stage a clear so the field follows the plugin's declared default again. */
  resetField: (field: MarketSettingKey) => void
  /** Write every staged edit. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
  /** Re-read the host-client probe. */
  refreshProbe: () => void
}

/** The registration-side face the card's slot entry injects. */
export interface MarketPluginCardFace extends MarketPluginCardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useMarketCard. */
    marketCard: SnapshotStore<MarketPluginCardState>
  }
}

/** One staged edit: the value to write, or a clear back to the declared default. */
type StagedEdit = { kind: 'set'; value: boolean | DownloadRegionSetting } | { kind: 'clear' }

/** One staged edit resolved into the write a save performs. */
interface PlannedWrite {
  field: MarketSettingKey
  /** Perform the write and report whether the host holds the staged state afterwards. */
  run: () => Promise<boolean>
}

/** Bridges the market settings scope onto the card's staged form. */
export class MarketPluginCardController {
  private readonly store: SnapshotStore<MarketPluginCardState>
  private readonly unsubscribe: () => void
  private readonly staged = new Map<MarketSettingKey, StagedEdit>()
  private probe: McpBackendInfo | undefined
  private probeStatus: 'idle' | 'loading' = 'idle'
  /** Bumped by every probe read so a late answer cannot overwrite a newer one. */
  private probeGeneration = 0
  /** Bumped by every save and every dispose so a late write cannot publish over a newer state. */
  private saveGeneration = 0
  private saving = false
  private failed = false
  private disposed = false

  /**
   * @param scope - the bound settings scope for the market namespace.
   * @param probe - reads the live host-client and region state from the market API.
   */
  constructor(
    private readonly scope: SettingsScope<MarketSettings>,
    private readonly probeSource: () => Promise<McpBackendInfo>
  ) {
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = scope.subscribe(() => { this.publish() })
  }

  /** Stop observing settings and suppress late probe/write settlements. */
  dispose(): void {
    this.disposed = true
    this.saveGeneration += 1
    this.probeGeneration += 1
    this.unsubscribe()
  }

  /**
   * Build the renderer face for this card.
   * @returns the card snapshot and its staged form actions.
   */
  inject(): MarketPluginCardFace {
    return {
      hooks: { marketCard: this.store },
      toggle: field => { this.toggle(field) },
      setRegion: next => { this.stageSet('downloadRegion', next) },
      resetField: field => { this.stageClear(field) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
      refreshProbe: () => { void this.loadProbe() }
    }
  }

  /** Read the host-client probe once; a second call while one is in flight is a no-op. */
  async loadProbe(): Promise<void> {
    if (this.disposed || this.probeStatus === 'loading') return
    this.probeStatus = 'loading'
    const generation = this.probeGeneration
    try {
      const info = await this.probeSource()
      if (generation !== this.probeGeneration || this.disposed) return
      this.probe = info
    } catch {
      // The version line and the region hint degrade silently; the controls still work.
    } finally {
      if (generation === this.probeGeneration) this.probeStatus = 'idle'
      this.publish()
    }
  }

  /** Stage the opposite of one switch's shown value. */
  private toggle(field: MarketSwitchField): void {
    if (!this.editable()) return
    this.stageSet(field, !this.fieldValue(field))
  }

  private stageSet(field: MarketSettingKey, value: boolean | DownloadRegionSetting): void {
    if (!this.editable()) return
    this.staged.set(field, { kind: 'set', value })
    this.failed = false
    this.publish()
  }

  private stageClear(field: MarketSettingKey): void {
    if (!this.editable()) return
    this.staged.set(field, { kind: 'clear' })
    this.failed = false
    this.publish()
  }

  private discard(): void {
    if (this.saving || (this.staged.size === 0 && !this.failed)) return
    this.staged.clear()
    this.failed = false
    this.publish()
  }

  /**
   * Write every staged edit, then re-read what the host accepted.
   *
   * The host is the only authority on whether a write landed — it owns the
   * document, its validation, and any concurrent writer — so the outcome is read
   * back rather than predicted. A save that did not land keeps its edits so the
   * user can correct them instead of retyping.
   */
  private async save(): Promise<void> {
    const plan = this.plan()
    if (plan.length === 0 || this.saving || this.invalid()) return
    const generation = this.saveGeneration
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of plan) {
      // A write the host refuses (read-only document, a rejected revision, a
      // transport fault) is a save that did not land, not a crash.
      try {
        landed = (await write.run()) && landed
      } catch {
        landed = false
      }
    }
    if (generation !== this.saveGeneration) return
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  /**
   * Every staged edit a save would write. An edit that would leave the document
   * exactly as it already is carries no write, which is what keeps `dirty` from
   * reporting a save that would do nothing.
   */
  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    for (const [field, edit] of this.staged) {
      if (edit.kind === 'clear') {
        if (this.overridden(field)) plan.push({ field, run: () => this.clear(field) })
        continue
      }
      // Compared against the document, not against what the card shows: a
      // staged value equal to what is already stored is not a write.
      if (edit.value === this.storedValue(field)) continue
      plan.push({ field, run: () => this.storeValue(field, edit.value) })
    }
    return plan
  }

  private async clear(field: MarketSettingKey): Promise<boolean> {
    await this.scope.unset(field)
    return !this.overridden(field)
  }

  private async storeValue(field: MarketSettingKey, value: boolean | DownloadRegionSetting): Promise<boolean> {
    await this.scope.set(field, value)
    return this.overridden(field) && this.fieldValue(field) === value
  }

  /** Whether the form accepts edits at all: served, writable, and not mid-save. */
  private editable(): boolean {
    const snapshot = this.scope.getSnapshot()
    return !this.disposed && snapshot.status === 'ready' && snapshot.writable && !this.saving
  }

  /** The document's resolved value for one field. */
  private storedValue(field: MarketSettingKey): MarketSettings[MarketSettingKey] {
    return this.scope.getSnapshot().value?.[field] ?? MARKET_SETTINGS_DEFAULTS[field]
  }

  /** The value the card shows: the staged edit when one stands, else the document's. */
  private fieldValue(field: MarketSettingKey): MarketSettings[MarketSettingKey] {
    const edit = this.staged.get(field)
    if (edit !== undefined && edit.kind === 'set') return edit.value
    return this.storedValue(field)
  }

  /** Whether a user-layer entry stands for this field, which is what marks it overridden. */
  private overridden(field: MarketSettingKey): boolean {
    const user = this.scope.getSnapshot().user
    return typeof user === 'object' && user !== null && Object.hasOwn(user, field)
  }

  private switchState(field: MarketSwitchField): MarketSwitchState {
    const edit = this.staged.get(field)
    return {
      value: this.fieldValue(field) as boolean,
      // A staged edit answers for itself, so the badge previews the save rather
      // than reporting a state the pending edit already contradicts.
      overridden: edit === undefined ? this.overridden(field) : edit.kind === 'set',
      staged: edit !== undefined
    }
  }

  /** Whether the host client is known to be missing, which blocks compat mode. */
  private hostClientMissing(): boolean {
    return this.probe !== undefined && !this.probe.hostClient.available
  }

  /**
   * Whether the form is in a state a save must refuse: compat mode asks for the
   * host's MCP client, and a deployment that does not resolve it would leave MCP
   * servers with no mount path at all.
   */
  private invalid(): boolean {
    return !(this.fieldValue('mcpEnhanced') as boolean) && this.hostClientMissing()
  }

  private projection(): MarketPluginCardState {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    const regionEdit = this.staged.get('downloadRegion')
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: this.invalid(),
      saving: this.saving,
      failed: this.failed,
      mcpEnhanced: this.switchState('mcpEnhanced'),
      scanProjectLayouts: this.switchState('scanProjectLayouts'),
      autoUpdateSources: this.switchState('autoUpdateSources'),
      feedbackEnabled: this.switchState('feedbackEnabled'),
      downloadRegion: {
        value: this.fieldValue('downloadRegion') as DownloadRegionSetting,
        overridden: regionEdit === undefined ? this.overridden('downloadRegion') : regionEdit.kind === 'set',
        staged: regionEdit !== undefined
      },
      probe: this.probe,
      hostClientMissing: this.hostClientMissing()
    }
  }

  private publish(): void {
    if (this.disposed) return
    this.store.set(this.projection())
  }
}
