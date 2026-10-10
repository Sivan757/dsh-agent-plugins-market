/**
 * Configuration on the installed bundle's detail page. The host SettingsForm
 * owns staged changes, save feedback, and discard-on-unmount behavior; the
 * market binding supplies its switches, download region, and backend probe.
 * Leaving the page drops every staged edit, so the card offers no discard
 * control of its own.
 * @module client/McpPluginCard
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { Button, SegmentedControl, SettingsForm, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
// Import the published slot types only; runtime collaboration uses the host slots service.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { clearTranslations } from '../../api.js'
import { MARKET_SWITCH_FIELDS, regionChoice, type MarketCardState, type MarketFormActions, type MarketSwitchField } from './market-card-form.js'
import css from '../market/market.module.css'

/** Copy of the boolean switches, in display order. */
const SWITCH_FIELDS = MARKET_SWITCH_FIELDS

/** Copy keys of each switch. */
const SWITCH_COPY: Record<MarketSwitchField, { label: MarketCopyKey; description: MarketCopyKey }> = {
  mcpEnhanced: { label: 'mcpCardTitle', description: 'mcpCardDesc' },
  scanProjectLayouts: { label: 'projectLayoutsLabel', description: 'projectLayoutsDesc' },
  autoUpdateSources: { label: 'autoUpdateLabel', description: 'autoUpdateDesc' },
  feedbackEnabled: { label: 'feedbackToggleLabel', description: 'feedbackToggleDesc' },
  translationEnabled: { label: 'translationToggleLabel', description: 'translationToggleDesc' },
  agentPresetsEnabled: { label: 'agentPresetsToggleLabel', description: 'agentPresetsToggleDesc' }
}

/** The plugin's locale keys this entry renders. */
type MarketCopyKey =
  | 'mcpCardTitle'
  | 'mcpCardDesc'
  | 'projectLayoutsLabel'
  | 'projectLayoutsDesc'
  | 'autoUpdateLabel'
  | 'autoUpdateDesc'
  | 'feedbackToggleLabel'
  | 'feedbackToggleDesc'
  | 'translationToggleLabel'
  | 'translationToggleDesc'
  | 'translationToggleExperimental'
  | 'agentPresetsToggleLabel'
  | 'agentPresetsToggleDesc'
  | 'agentPresetsToggleExperimental'
  | 'translationReset'
  | 'translationResetDone'
  | 'mcpCardReadonly'
  | 'mcpBackendHostMissing'
  | 'regionLabel'
  | 'regionHint'
  | 'regionAuto'
  | 'regionGlobal'
  | 'regionChina'
  | 'regionResolved'
  | 'settingSaveFailed'
  | 'settingSave'
  | 'settingSaving'
  | 'settingOverridden'
  | 'settingReset'
  | 'settingUnavailable'

/** Props the renderer binds: the asked view, the injected actions, and the locale seats. */
export interface McpPluginCardProps extends MarketFormActions, PropsRuntime<'plugins.bundle.config'> {
  /** The bound locale translate; the host puts it here through the `locale` registration. */
  t: (key: MarketCopyKey, params?: Record<string, unknown>) => string
  useMarketCard: <S>(select: (state: MarketCardState) => S) => S
}

/** The card's translate face (structural — the host binds the real one). */
type CardTranslate = McpPluginCardProps['t']

/** The overridden badge and the reset that hands the field back to the plugin. */
function OverrideBadge(props: { t: CardTranslate; disabled: boolean; onReset: () => void }): ReactNode {
  return h(
    'span',
    { className: css.pluginFieldBadges },
    h(Tag, { tone: 'neutral' }, props.t('settingOverridden')),
    h('button', { type: 'button', className: css.pluginFieldReset, disabled: props.disabled, onClick: props.onReset }, props.t('settingReset'))
  )
}

/** The head of one field row: its label, a standing marker, and the override state. */
function FieldHead(props: { label: string; overridden: boolean; badge: ReactNode; tag?: ReactNode }): ReactNode {
  return h(
    'div',
    { className: css.pluginFieldHead },
    h('div', { className: css.pluginCardRowLabel }, props.label),
    // A standing marker is part of the label, not of the override state, so it
    // shows whether or not the field has been touched.
    props.tag === undefined ? null : h('span', { className: css.pluginFieldBadges }, props.tag),
    props.overridden ? props.badge : null
  )
}

/**
 * The reset control: the host's text button, named for what it clears. It
 * clears the whole translation cache rather than staging a setting, so it acts
 * immediately — outside the form's save cycle — and reports through its own
 * label, settling on the cleared state before returning to its name.
 */
function ResetButton(props: { t: CardTranslate; disabled: boolean; onClear: () => Promise<void> }): ReactNode {
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle')
  // The settled label is a moment of feedback, not a state the row keeps.
  useEffect(() => {
    if (phase !== 'done') return
    const timer = setTimeout(() => {
      setPhase('idle')
    }, 1600)
    return () => {
      clearTimeout(timer)
    }
  }, [phase])
  return h(
    Button,
    {
      variant: 'ghost',
      size: 'sm',
      disabled: props.disabled || phase === 'busy',
      onClick: () => {
        if (phase === 'busy') return
        setPhase('busy')
        // The clear is fire-and-forget: the next panel read repopulates, and a
        // failure costs nothing worse than text that translates again.
        void props.onClear().then(
          () => {
            setPhase('done')
          },
          () => {
            setPhase('idle')
          }
        )
      }
    },
    props.t(phase === 'done' ? 'translationResetDone' : 'translationReset')
  )
}

/** One boolean switch row: its copy, the control, and the reset when it is overridden. */
function SwitchRow(props: {
  t: CardTranslate
  field: MarketSwitchField
  state: MarketCardState[MarketSwitchField]
  disabled: boolean
  onEdit: (field: MarketSwitchField, text: string) => void
  onReset: (field: MarketSwitchField) => void
  /** Extra control on the row's leading edge, before the switch. */
  accessory?: ReactNode
}): ReactNode {
  const copy = SWITCH_COPY[props.field]
  const label = props.t(copy.label)
  return h(
    'div',
    { className: css.pluginCardRow },
    h(
      'div',
      { className: css.pluginCardText },
      h(FieldHead, {
        label,
        overridden: props.state.overridden,
        // The translation chain reaches third-party providers, and the preset
        // manager is experimental: both rows say so before a user turns them on.
        ...(props.field === 'translationEnabled'
          ? { tag: h(Tag, { tone: 'neutral' }, props.t('translationToggleExperimental')) }
          : props.field === 'agentPresetsEnabled'
            ? { tag: h(Tag, { tone: 'neutral' }, props.t('agentPresetsToggleExperimental')) }
            : {}),
        badge: h(OverrideBadge, {
          t: props.t,
          disabled: props.disabled,
          onReset: () => {
            props.onReset(props.field)
          }
        })
      }),
      h('div', { className: css.pluginCardDesc }, props.t(copy.description))
    ),
    props.accessory ?? null,
    h(Switch, {
      // The draft text is the value's wire spelling; the Switch only renders it.
      checked: props.state.text === 'true',
      label,
      disabled: props.disabled,
      onChange: () => {
        props.onEdit(props.field, props.state.text === 'true' ? 'false' : 'true')
      }
    })
  )
}

/** The download-region segment options, with the label of each. */
const REGION_OPTIONS = [
  { value: 'auto', label: 'regionAuto' },
  { value: 'global', label: 'regionGlobal' },
  { value: 'china', label: 'regionChina' }
] as const

export function McpPluginCard(props: McpPluginCardProps): ReactNode {
  const { t, useMarketCard, edit, resetField, save, discard, refreshProbe } = props
  const state = useMarketCard(current => current)

  useEffect(() => {
    refreshProbe()
  }, [refreshProbe])

  // Controls lock while a save is on the wire, so an edit staged mid-save
  // cannot be wiped by the save's own settlement clearing the staged map.
  const disabled = !state.writable || state.saving
  const region = state.downloadRegion
  // The route clones actually take: the explicit choice, or the
  // language-resolved one while the setting follows the locale.
  const effectiveRegion = state.probe?.downloadRegion.effective ?? (region.text === 'china' ? 'china' : 'global')

  // The host frame owns the read-only notice, the save control, and the
  // failure echo; the body carries only the market's own controls.
  return h(SettingsForm, {
    labels: {
      unavailable: t('settingUnavailable'),
      readOnly: t('mcpCardReadonly'),
      saveFailed: t('settingSaveFailed'),
      save: t('settingSave'),
      saving: t('settingSaving')
    },
    state,
    onSave: save,
    onDiscard: discard,
    children: h(
      'div',
      { className: css.pluginCardBody },
      SWITCH_FIELDS.map(field =>
        h(SwitchRow, {
          key: field,
          t,
          field,
          state: state[field],
          disabled,
          onEdit: edit,
          onReset: resetField,
          // Only the translation row carries a reset: it clears a cache, not
          // a staged setting, so it sits outside the form's own save cycle.
          ...(field === 'translationEnabled' ? { accessory: h(ResetButton, { t, disabled, onClear: clearTranslations }) } : {})
        })
      ),
      state.hostClientMissing && state.mcpEnhanced.text !== 'true' ? h('p', { className: css.pluginCardError }, t('mcpBackendHostMissing')) : null,
      h(
        'div',
        { className: css.pluginCardRow },
        h(
          'div',
          { className: css.pluginCardText },
          h(FieldHead, {
            label: t('regionLabel'),
            overridden: region.overridden,
            badge: h(OverrideBadge, {
              t,
              disabled,
              onReset: () => {
                resetField('downloadRegion')
              }
            })
          }),
          h('div', { className: css.pluginCardDesc }, t('regionHint'))
        ),
        h(SegmentedControl<string>, {
          id: 'plugin-config-market-region',
          label: t('regionLabel'),
          disabled,
          // An empty draft is the staged clear that follows the interface
          // language — the auto segment's own gesture.
          value: regionChoice(region.text),
          options: REGION_OPTIONS.map(option => ({ value: option.value, label: t(option.label) })),
          onChange: value => {
            // Following the interface language is the plugin's own behavior,
            // so the choice clears the stored entry rather than pinning
            // whichever route the language resolves to.
            if (value === 'auto') resetField('downloadRegion')
            else edit('downloadRegion', value)
          }
        })
      ),
      // While the setting follows the interface language, show which route
      // that currently resolves to rather than leaving it implicit.
      region.overridden ? null : h('p', { className: css.pluginCardDesc }, t('regionResolved', { region: t(effectiveRegion === 'china' ? 'regionChina' : 'regionGlobal') }))
    )
  })
}
