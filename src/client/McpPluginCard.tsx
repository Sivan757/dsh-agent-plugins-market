/**
 * The Agent Plugins Market page on the host's Plugins panel: the market
 * feature's configuration entry, named after the market itself.
 *
 * The page's Plugins panel renders every `plugins.item` entry twice: a
 * `summary` one-liner on the official card, and the `page` form on the
 * entry's detail page. This component answers both views. It draws what the
 * bound form projects and reports what the user picks through the injected
 * actions, following the contract every entry in this slot uses: controls
 * stage edits, one save commits them, an untouched field keeps following the
 * plugin, and an entry whose namespace is not served leaves no trace.
 *
 * @module client/McpPluginCard
 */
import { createElement as h, useEffect, type ReactNode } from 'react'
import { Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry and its
// summary/page view props). Cross-plugin collaboration goes through slots,
// never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketPluginCardActions, MarketPluginCardState, MarketSwitchField, MarketSwitchState } from './plugin-card-controller.js'
import css from './market.module.css'

/** Copy of the boolean switches, in display order. */
const SWITCH_FIELDS = ['mcpEnhanced', 'scanProjectLayouts', 'autoUpdateSources', 'feedbackEnabled'] as const

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
  | 'settingUnsaved' | 'settingSaveFailed' | 'settingDiscard' | 'settingSaving' | 'settingSave'
  | 'settingOverridden' | 'settingReset'

/** Props the renderer binds: the asked view, the injected actions, and the locale seats. */
export interface McpPluginCardProps extends MarketPluginCardActions, PropsRuntime<'plugins.item'> {
  /** The bound locale translate; the host puts it here through the `locale` registration. */
  t: (key: MarketCopyKey, params?: Record<string, unknown>) => string
  useMarketCard: <S>(select: (state: MarketPluginCardState) => S) => S
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

/** One boolean switch row: its copy, the control, and the reset when it is overridden. */
function SwitchRow(props: {
  t: CardTranslate
  field: MarketSwitchField
  state: MarketSwitchState
  disabled: boolean
  onToggle: (field: MarketSwitchField) => void
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
      h(
        'div',
        { className: css.pluginFieldHead },
        h('div', { className: css.pluginCardRowLabel }, label),
        props.state.overridden
          ? h(OverrideBadge, { t: props.t, disabled: props.disabled, onReset: () => { props.onReset(props.field) } })
          : null
      ),
      h('div', { className: css.pluginCardDesc }, props.t(copy.description))
    ),
    h(Switch, {
      checked: props.state.value,
      label,
      disabled: props.disabled,
      onChange: () => { props.onToggle(props.field) }
    })
  )
}

export function McpPluginCard(props: McpPluginCardProps): ReactNode {
  const { t, useMarketCard, toggle, setRegion, resetField, save, discard, refreshProbe } = props
  const state = useMarketCard(current => current)

  useEffect(() => { refreshProbe() }, [refreshProbe])

  // A deployment that does not compose the market's settings namespace should
  // show no trace of the page rather than controls it cannot act on.
  if (!state.available) return null

  // The official card asks for the one-liner; the detail page hosts the form.
  if (props.view === 'summary') return t(SUMMARY_KEY)

  const blocked = !state.writable || state.saving
  const region = state.downloadRegion
  // The highlighted segment is the route clones actually take: the explicit
  // choice, or the language-resolved one while the setting follows the locale.
  const effectiveRegion = state.probe?.downloadRegion.effective ?? (region.value === 'china' ? 'china' : 'global')

  return h(
    'div',
    { className: css.pluginCardBody },
    state.writable ? null : h('p', { className: css.pluginCardReadonly, role: 'status' }, t('mcpCardReadonly')),
    SWITCH_FIELDS.map(field =>
      h(SwitchRow, {
        key: field,
        t,
        field,
        state: state[field],
        disabled: blocked,
        onToggle: toggle,
        onReset: resetField
      })
    ),
    state.hostClientMissing && !state.mcpEnhanced.value
      ? h('p', { className: css.pluginCardError }, t('mcpBackendHostMissing'))
      : null,
    h(
      'div',
      { className: css.pluginCardRow },
      h(
        'div',
        { className: css.pluginCardText },
        h(
          'div',
          { className: css.pluginFieldHead },
          h('div', { className: css.pluginCardRowLabel }, t('regionLabel')),
          region.overridden
            ? h(OverrideBadge, { t, disabled: blocked, onReset: () => { resetField('downloadRegion') } })
            : null
        ),
        h('div', { className: css.pluginCardDesc }, t('regionHint'))
      ),
      h(
        'div',
        { className: css.regionSeg },
        (['auto', 'global', 'china'] as const).map(option => {
          const selected = option === 'auto' ? !region.overridden : region.overridden && region.value === option
          // While the setting follows the interface language, show which
          // route that currently resolves to rather than leaving it implicit.
          const resolved = !region.overridden && option === effectiveRegion
          return h(
            'button',
            {
              key: option,
              type: 'button',
              disabled: blocked,
              className: selected ? css.regionSegOn : resolved ? css.regionSegEffective : css.regionSegBtn,
              // Following the interface language is the plugin's own
              // behavior, so the choice clears the stored entry rather
              // than pinning whichever route the language resolves to.
              onClick: () => {
                if (option === 'auto') {
                  if (region.overridden) resetField('downloadRegion')
                  return
                }
                if (region.value === option && region.overridden) return
                setRegion(option)
              }
            },
            option === 'auto' ? t('regionAuto') : option === 'global' ? t('regionGlobal') : t('regionChina')
          )
        })
      )
    ),
    h(
      'div',
      { className: css.pluginCardFooter },
      state.failed ? h('p', { className: css.pluginCardError, role: 'status' }, t('settingSaveFailed')) : null,
      h(
        'button',
        { type: 'button', className: css.pluginCardDiscard, disabled: !state.dirty || state.saving, onClick: discard },
        t('settingDiscard')
      ),
      h(
        'button',
        { type: 'button', className: css.pluginCardSave, disabled: !state.dirty || state.invalid || state.saving, onClick: save },
        t(state.saving ? 'settingSaving' : 'settingSave')
      )
    )
  )
}
