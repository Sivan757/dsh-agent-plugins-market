/**
 * The Agent Plugins Market card on the host's 插件配置 (plugin configuration)
 * tab: the market feature's configuration entry, named after the market itself.
 *
 * The card is a renderer. It draws what the bound form projects and reports what
 * the user picks through the injected actions, following the contract every card
 * in this slot uses: controls stage edits, one save commits them, an untouched
 * field keeps following the plugin, and a card whose namespace is not served
 * leaves no trace.
 *
 * @module client/McpPluginCard
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { IconChevronDownOutlineMedium, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarketPluginCardActions, MarketPluginCardState, MarketSwitchField, MarketSwitchState } from './plugin-card-controller.js'
import css from './market.module.css'

/** Locale subset the card needs (structural — the host binds the real one). */
type CardTranslate = (key: string, params?: Record<string, unknown>) => string

/** Copy of the boolean switches, in display order. */
const SWITCH_FIELDS = ['mcpEnhanced', 'scanProjectLayouts', 'autoUpdateSources', 'feedbackEnabled'] as const

/** Copy keys of each switch. */
const SWITCH_COPY: Record<MarketSwitchField, { label: string; description: string }> = {
  mcpEnhanced: { label: 'mcpCardTitle', description: 'mcpCardDesc' },
  scanProjectLayouts: { label: 'projectLayoutsLabel', description: 'projectLayoutsDesc' },
  autoUpdateSources: { label: 'autoUpdateLabel', description: 'autoUpdateDesc' },
  feedbackEnabled: { label: 'feedbackToggleLabel', description: 'feedbackToggleDesc' }
}

/** Props the slot renderer binds: the form's snapshot, its actions, and locale copy. */
export interface McpPluginCardProps extends MarketPluginCardActions {
  t: CardTranslate
  useMarketCard: <S>(select: (state: MarketPluginCardState) => S) => S
}

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
  const [open, setOpen] = useState(false)
  const state = useMarketCard(current => current)

  useEffect(() => { refreshProbe() }, [refreshProbe])

  // A deployment that does not compose the market's settings namespace should
  // show no trace of the card rather than controls it cannot act on.
  if (!state.available) return null

  const blocked = !state.writable || state.saving
  const region = state.downloadRegion
  // The highlighted segment is the route clones actually take: the explicit
  // choice, or the language-resolved one while the setting follows the locale.
  const effectiveRegion = state.probe?.downloadRegion.effective ?? (region.value === 'china' ? 'china' : 'global')

  return h(
    'li',
    { className: open ? `${css.pluginCard} ${css.pluginCardOpen}` : css.pluginCard },
    h(
      'button',
      {
        type: 'button',
        className: css.pluginCardHeader,
        'aria-expanded': open,
        onClick: () => { setOpen(current => !current) }
      },
      h(
        'div',
        { className: css.pluginCardText },
        h('div', { className: css.pluginCardTitle }, t('nav')),
        h('div', { className: css.pluginCardDesc }, t('marketCardDesc'))
      ),
      state.dirty ? h(Tag, { tone: 'neutral' }, t('settingUnsaved')) : null,
      h(
        'span',
        { className: open ? `${css.pluginChevron} ${css.pluginChevronOpen}` : css.pluginChevron },
        h(IconChevronDownOutlineMedium)
      )
    ),
    open
      ? h(
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
      : null
  )
}
