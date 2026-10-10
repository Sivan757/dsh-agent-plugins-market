/**
 * The one hook row both hook surfaces render: provenance as the title, the
 * authored command as a one-line preview, matcher and support verdict in the
 * footer. Settings renders it read-only (the card opens the detail); the preset
 * manager passes a toggle and keeps the same View action beside it.
 * @module client/ui/HookResourceCard
 */
import { createElement as h, type ReactNode } from 'react'
import { Button, IconInfoOutlineMedium, Switch, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ExtensionResource } from '../../../market-contracts/src/contracts/extension-presets.js'
import type { ExtensionTranslate } from '../i18n.js'
import { ResourceCard, interactiveCardProps, type ResourceState } from './ResourceCard.js'
import { hoverHint } from './hover-hint.js'
import rc from './resource-card.module.css'

/** The preset manager's selection control for one hook row. */
export interface HookCardToggle {
  selected: boolean
  /** The draft cannot change right now; the card neither toggles nor focuses. */
  disabled: boolean
  onChange: (enabled: boolean) => void
}

export interface HookResourceCardProps {
  /** One Hooks-face row; its detail names the hook the card describes. */
  row: ExtensionResource
  t: ExtensionTranslate
  /** State chrome the owning surface decided for this row. */
  state: ResourceState
  /** Absent on the settings page, where the card only opens the detail. */
  toggle?: HookCardToggle
  /** Open this hook's detail. */
  onView: (row: ExtensionResource) => void
}

/** Render one hook row from its own server-derived detail. */
export function HookResourceCard({ row, t, state, toggle, onView }: HookResourceCardProps): ReactNode {
  const hook = row.detail.kind === 'hook' ? row.detail : undefined
  // The title is the provenance, never the command: a shell line as a heading
  // is unreadable and hides which configuration owns the hook.
  const title = hook?.provenance ?? row.source
  const command = hook?.command ?? row.name
  const limited = !row.available || row.control === 'global-only'
  const reason = t(
    row.unavailableReason === 'hook-event-partial' ? 'epHookEventPartial' : row.unavailableReason === 'hook-event-unsupported' ? 'epHookEventUnsupported' : 'epUnavailable'
  )
  const stop = (event: { stopPropagation: () => void }): void => event.stopPropagation()
  // Settings always opens the detail; a preset row only selects while the draft
  // accepts changes, so a disabled card is inert instead of half-interactive.
  const interactive = toggle === undefined || !toggle.disabled
  const onActivate = (): void => {
    if (toggle === undefined) onView(row)
    else if (!toggle.disabled) toggle.onChange(!toggle.selected)
  }
  return (
    <ResourceCard
      data-resource-id={row.id}
      surface="hooks"
      state={state}
      {...(interactive ? interactiveCardProps(onActivate) : {})}
      {...(toggle === undefined || !interactive ? {} : { 'aria-pressed': toggle.selected })}
      aria-label={title}
    >
      <div className={rc.rowId}>{hoverHint(title, h('span', { className: rc.name }, title))}</div>
      <p className={rc.rowBody + ' ' + rc.desc}>{hoverHint(command, h('span', { className: rc.nameMono }, command))}</p>
      <div className={rc.rowFoot}>
        {/* An installed suite's hook has no switch of its own: the suite row owns
            the selection, and the card says so instead of pretending to toggle. */}
        {row.followsSuite === true ? <Tag tone="quiet">{t('epHookFollowsSuite')}</Tag> : null}
        {/* The stage travels on the card: the surfaces no longer switch events by tab. */}
        {hook?.event === undefined ? null : <Tag tone="quiet">{hook.event}</Tag>}
        {hook?.matcher === undefined ? null : <span className={rc.provenance}>{hoverHint(hook.matcher, h('span', { className: rc.nameMono }, hook.matcher))}</span>}
        {limited ? (
          <Tooltip label={reason} portal side="top">
            <span tabIndex={0} onClick={stop}>
              <Tag tone={row.control === 'global-only' ? 'quiet' : 'warning'}>{reason}</Tag>
            </span>
          </Tooltip>
        ) : null}
      </div>
      {/* The action cluster stops its own events so the View button never also
          activates the card it sits on. */}
      <div className={rc.rowActions} onClick={stop} onKeyDown={stop} onKeyUp={stop}>
        <Button size="sm" variant="ghost" className={rc.iconBtn} aria-label={t('epView') + ' · ' + title} onClick={() => onView(row)}>
          <IconInfoOutlineMedium size={16} />
        </Button>
        {toggle === undefined ? null : row.control === 'global-only' ? (
          <Tag tone="quiet">{t(toggle.selected ? 'epOn' : 'epOff')}</Tag>
        ) : (
          <span className={rc.switchWrap}>
            <Switch checked={toggle.selected} disabled={toggle.disabled} label={title} onChange={on => toggle.onChange(on)} />
          </span>
        )}
      </div>
    </ResourceCard>
  )
}
