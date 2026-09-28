/**
 * The Agent Plugins Market page on the host's Plugins panel: the market
 * feature's configuration entry, named after the market itself.
 *
 * The page's Plugins panel renders every `plugins.item` entry twice: a
 * `summary` one-liner on the official card, and the `page` form on the
 * entry's detail page. This component answers both views. The page view is
 * the host's `SettingsForm` frame around controls bound to the published
 * `SettingsFormModel` through the market's binding (`market-card-form.ts`):
 * booleans ride the host Switch atom, the download region rides the host
 * SegmentedControl atom, and every control stages through the form's actions
 * so one save commits all of them. Leaving the page discards the staged
 * edits — the host form's own contract, which this entry adopts.
 *
 * @module client/McpPluginCard
 */
import { createElement as h, useEffect, type ReactNode } from 'react'
import { SegmentedControl, SettingsForm, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry and its
// summary/page view props). Cross-plugin collaboration goes through slots,
// never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { MARKET_SWITCH_FIELDS, type MarketCardState, type MarketFormActions, type MarketSwitchField } from './market-card-form.js'
import css from '../market/market.module.css'

/** Copy of the boolean switches, in display order. */
const SWITCH_FIELDS = MARKET_SWITCH_FIELDS

/** Copy keys of each switch. */
const SWITCH_COPY: Record<MarketSwitchField, { label: MarketCopyKey; description: MarketCopyKey }> = {
  mcpEnhanced: { label: 'mcpCardTitle', description: 'mcpCardDesc' },
  scanProjectLayouts: { label: 'projectLayoutsLabel', description: 'projectLayoutsDesc' },
  autoUpdateSources: { label: 'autoUpdateLabel', description: 'autoUpdateDesc' },
  feedbackEnabled: { label: 'feedbackToggleLabel', description: 'feedbackToggleDesc' }
}

/** Copy key of the summary one-liner the official card renders. */
const SUMMARY_KEY = 'marketCardDesc' satisfies MarketCopyKey

/** The plugin's locale keys this entry renders. */
type MarketCopyKey =
  | 'marketCardDesc' | 'mcpCardTitle' | 'mcpCardDesc' | 'projectLayoutsLabel' | 'projectLayoutsDesc'
  | 'autoUpdateLabel' | 'autoUpdateDesc' | 'feedbackToggleLabel' | 'feedbackToggleDesc'
  | 'mcpCardReadonly' | 'mcpBackendHostMissing' | 'regionLabel' | 'regionHint'
  | 'regionAuto' | 'regionGlobal' | 'regionChina'
  | 'settingSaveFailed' | 'settingSave' | 'settingSaving' | 'settingDiscard'
  | 'settingOverridden' | 'settingReset' | 'settingUnavailable'

/** Props the renderer binds: the asked view, the injected actions, and the locale seats. */
export interface McpPluginCardProps extends MarketFormActions, PropsRuntime<'plugins.item'> {
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
    h(
      'button',
      { type: 'button', className: css.pluginFieldReset, disabled: props.disabled, onClick: props.onReset },
      props.t('settingReset')
    )
  )
}

/** The head of one field row: its label and the override state above the control. */
function FieldHead(props: { label: string; overridden: boolean; badge: ReactNode }): ReactNode {
  return h(
    'div',
    { className: css.pluginFieldHead },
    h('div', { className: css.pluginCardRowLabel }, props.label),
    props.overridden ? props.badge : null
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
        badge: h(OverrideBadge, { t: props.t, disabled: props.disabled, onReset: () => { props.onReset(props.field) } })
      }),
      h('div', { className: css.pluginCardDesc }, props.t(copy.description))
    ),
    h(Switch, {
      // The draft text is the value's wire spelling; the Switch only renders it.
      checked: props.state.text === 'true',
      label,
      disabled: props.disabled,
      onChange: () => { props.onEdit(props.field, props.state.text === 'true' ? 'false' : 'true') }
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

  useEffect(() => { refreshProbe() }, [refreshProbe])

  // The official card asks for the one-liner; an entry whose namespace is not
  // served leaves no trace, not even the one-liner.
  if (props.view === 'summary') return state.available ? t(SUMMARY_KEY) : null

  // Controls lock while a save is on the wire, so an edit staged mid-save
  // cannot be wiped by the save's own settlement clearing the staged map.
  const disabled = !state.writable || state.saving
  const region = state.downloadRegion
  // The route clones actually take: the explicit choice, or the
  // language-resolved one while the setting follows the locale.
  const effectiveRegion = state.probe?.downloadRegion.effective ?? (region.text === 'china' ? 'china' : 'global')

  // The host frame owns the read-only notice, the save control, and the
  // failure echo; the body carries the market's own controls plus the discard
  // the frame does not offer.
  return h(
    SettingsForm,
    {
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
            onReset: resetField
          })
        ),
        state.hostClientMissing && state.mcpEnhanced.text !== 'true'
          ? h('p', { className: css.pluginCardError }, t('mcpBackendHostMissing'))
          : null,
        h(
          'div',
          { className: css.pluginCardRow },
          h(
            'div',
            { className: css.pluginCardText },
            h(FieldHead, {
              label: t('regionLabel'),
              overridden: region.overridden,
              badge: h(OverrideBadge, { t, disabled, onReset: () => { resetField('downloadRegion') } })
            }),
            h('div', { className: css.pluginCardDesc }, t('regionHint'))
          ),
          h(SegmentedControl<string>, {
            id: 'plugin-config-market-region',
            label: t('regionLabel'),
            disabled,
            value: region.text === 'auto' || region.text === 'global' || region.text === 'china' ? region.text : 'auto',
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
        region.overridden
          ? null
          : h('p', { className: css.pluginCardDesc }, '→ ', t(effectiveRegion === 'china' ? 'regionChina' : 'regionGlobal')),
        state.dirty
          ? h(
              'div',
              { className: css.pluginCardFooter },
              h(
                'button',
                { type: 'button', className: css.pluginCardDiscard, disabled: state.saving, onClick: discard },
                t('settingDiscard')
              )
            )
          : null
      )
    }
  )
}
