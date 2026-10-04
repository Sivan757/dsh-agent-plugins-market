/**
 * The market settings card's binding onto the host's published settings-form
 * model (`@deepseek-ai/dsh-client-ui-primitives.SettingsFormModel`).
 *
 * The card's fields are four booleans and one enum — none of them text — so
 * they bind through custom `SettingsFieldSpec` values whose draft text is the
 * value's wire spelling (`true`/`false`, the region word) instead of the
 * published text and number factories. A draft that is not a value the field
 * accepts blocks the save; an empty draft stages the clear that hands the
 * field back to the composition layer, which is how "follow the interface
 * language" and the plugin defaults are expressed. The live host-client probe
 * is browser-local knowledge, so it rides the projection rather than the
 * settings document, and a late probe answer cannot overwrite a newer one.
 *
 * @module client/market-card-form
 */
import {
  SettingsFormModel,
  type SettingsFieldSpec,
  type SettingsFieldState,
  type SettingsFormActions,
  type SettingsFormScope,
  type SettingsFormShell
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DownloadRegionSetting, MarketSettings } from '../../../contracts/settings.js'
import type { McpBackendInfo } from '../../api.js'

/** The boolean switches this card renders, in display order. */
export const MARKET_SWITCH_FIELDS = ['mcpEnhanced', 'scanProjectLayouts', 'autoUpdateSources', 'feedbackEnabled', 'translationEnabled'] as const

/** One boolean switch the card renders. */
export type MarketSwitchField = (typeof MARKET_SWITCH_FIELDS)[number]

/** The region words a stored `downloadRegion` may carry. */
const REGION_WORDS: readonly DownloadRegionSetting[] = ['auto', 'global', 'china']

/**
 * The segment a region draft answers. An empty draft is the staged clear that
 * hands the field back to the interface language, which is the `auto` choice;
 * a draft the field does not accept also reads as `auto` on screen, while
 * `invalid` reports it and blocks the save.
 * @param draft - the field's staged text.
 * @returns the segment value the control highlights.
 */
export function regionChoice(draft: string): DownloadRegionSetting {
  return (REGION_WORDS as readonly string[]).includes(draft) ? (draft as DownloadRegionSetting) : 'auto'
}

/**
 * A boolean field: the draft text is the value's wire spelling.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function settingsBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: value => (typeof value === 'boolean' ? String(value) : ''),
    parse: text => {
      const trimmed = text.trim()
      if (trimmed === 'true') return { kind: 'set', value: true }
      if (trimmed === 'false') return { kind: 'set', value: false }
      // Anything else is not a value this field accepts, which blocks the save.
      return undefined
    }
  }
}

/**
 * The download-region enum field: the draft text is the stored word.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
export function settingsRegionField(field: string): SettingsFieldSpec {
  return {
    field,
    format: value => (REGION_WORDS.includes(value as DownloadRegionSetting) ? (value as DownloadRegionSetting) : ''),
    parse: text => {
      const trimmed = text.trim()
      return (REGION_WORDS as readonly string[]).includes(trimmed) ? { kind: 'set', value: trimmed } : undefined
    }
  }
}

/** What the market card renders. */
export interface MarketCardState extends SettingsFormShell {
  mcpEnhanced: SettingsFieldState
  scanProjectLayouts: SettingsFieldState
  autoUpdateSources: SettingsFieldState
  feedbackEnabled: SettingsFieldState
  translationEnabled: SettingsFieldState
  downloadRegion: SettingsFieldState
  /** Live host-client probe driving the compat-mode guard and the region hint. */
  probe: McpBackendInfo | undefined
  /** Whether the host client is known to be missing, which blocks compat mode. */
  hostClientMissing: boolean
}

/** The actions the card's slot registration injects. */
export interface MarketFormActions extends SettingsFormActions {
  /** Re-read the host-client probe. */
  refreshProbe: () => void
}

/** The registration-side face the card's slot entry injects. */
export interface MarketCardFace extends MarketFormActions {
  hooks: {
    /** Card snapshot bound by the renderer as useMarketCard. */
    marketCard: SnapshotStore<MarketCardState>
  }
}

/** The probe reader the card's projection carries. */
type ProbeSource = () => Promise<McpBackendInfo>

/**
 * Bind the market settings scope onto the published form model and build the
 * renderer face for the card.
 * @param scope - the host configuration form for the market namespace.
 * @param probeSource - reads the live host-client and region state from the market API.
 * @returns the model, the injected face, and the disposer releasing the form.
 */
export function bindMarketCardForm(scope: SettingsFormScope<MarketSettings>, probeSource: ProbeSource): {
  model: SettingsFormModel<MarketSettings>
  face: MarketCardFace
  dispose: () => void
} {
  const model = new SettingsFormModel<MarketSettings>(scope, [
    settingsBooleanField('mcpEnhanced'),
    settingsBooleanField('scanProjectLayouts'),
    settingsBooleanField('autoUpdateSources'),
    settingsBooleanField('feedbackEnabled'),
    settingsBooleanField('translationEnabled'),
    settingsRegionField('downloadRegion')
  ])
  // The staged actions refuse edits while a save is on the wire, so nothing
  // stages into the map the save's own settlement clears on success. The save
  // action needs no such wrapper: the model's own save refuses a second
  // concurrent entry.
  const actions = model.actions()
  const stagedActions = {
    edit: (field: string, text: string) => {
      if (model.shell().saving) return
      actions.edit(field, text)
    },
    resetField: (field: string) => {
      if (model.shell().saving) return
      actions.resetField(field)
    },
    save: actions.save,
    discard: () => {
      if (model.shell().saving) return
      actions.discard()
    }
  }
  let probe: McpBackendInfo | undefined
  let probeStatus: 'idle' | 'loading' = 'idle'
  /** Bumped by every probe read and by dispose so a late answer cannot win. */
  let probeGeneration = 0
  // The compat-mode guard: enhanced mode is the built-in bridge, so turning it
  // off (or staging it off) asks for the host client the deployment may not
  // have. A deployment without one would leave MCP servers with no mount path
  // at all, so the state a save must refuse — the model's own invalid plus this
  // guard — is what the projection reports, and it is what disables the save.
  const hostClientMissing = (): boolean => probe !== undefined && !probe.hostClient.available
  // A read still in flight leaves the deployment's host client unknown, and that
  // window is exactly when a save could pin compat mode onto a client-less
  // deployment — so it blocks too. A read that came back with nothing leaves the
  // guard permissive: it cannot learn anything more.
  const compatBlocked = (): boolean =>
    model.field('mcpEnhanced').text !== 'true' && (probeStatus === 'loading' || hostClientMissing())
  const project = (): MarketCardState => {
    const shell = model.shell()
    return {
      ...shell,
      invalid: shell.invalid || compatBlocked(),
      mcpEnhanced: model.field('mcpEnhanced'),
      scanProjectLayouts: model.field('scanProjectLayouts'),
      autoUpdateSources: model.field('autoUpdateSources'),
      feedbackEnabled: model.field('feedbackEnabled'),
      translationEnabled: model.field('translationEnabled'),
      downloadRegion: model.field('downloadRegion'),
      probe,
      hostClientMissing: hostClientMissing()
    }
  }
  const store = model.bind(project)

  /** Read the host-client probe once; a second call while one is in flight is a no-op. */
  const loadProbe = async (): Promise<void> => {
    if (probeStatus === 'loading') return
    probeStatus = 'loading'
    const generation = probeGeneration
    try {
      const info = await probeSource()
      if (generation !== probeGeneration) return
      probe = info
    } catch {
      // The version line and the region hint degrade silently; the controls still work.
    } finally {
      if (generation === probeGeneration) {
        probeStatus = 'idle'
        store.set(project())
      }
    }
  }

  return {
    model,
    face: {
      hooks: { marketCard: store },
      ...stagedActions,
      refreshProbe: () => {
        void loadProbe()
      }
    },
    dispose: () => {
      probeGeneration += 1
      model.dispose()
    }
  }
}
