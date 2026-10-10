import { createElement as h, type HTMLAttributes, type ReactNode } from 'react'
import { Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { hintProps, hoverHint } from './hover-hint.js'
import css from './resource-card.module.css'

export type ResourceState = 'active' | 'disabled' | 'warning' | 'error'

/** The surface a card belongs to; a few narrow-container rules key off it. */
export type ResourceSurface = 'market' | 'skills' | 'commands' | 'personas' | 'mcp' | 'lsp' | 'hooks'

/** State chrome shared by every resource, independent of the source and the content layout. */
export function ResourceCard({
  state,
  surface,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { state: ResourceState; surface?: ResourceSurface; children?: ReactNode }): ReactNode {
  return h('article', { ...props, className: `${className ?? ''} ${css.card}`, 'data-resource-state': state, 'data-resource-surface': surface }, children)
}

/** A shared, shrinkable scroll area: grid and list never stretch individual cards vertically. */
export function ResourceCollection({
  view,
  className,
  children,
  ...rest
}: { view: 'grid' | 'list'; className?: string; children?: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children'>): ReactNode {
  return h('div', { className: `${className ?? ''} ${css.collection}`, 'data-resource-view': view, ...rest }, children)
}

/** Spread onto a card so it opens like a button: keyboard users included. */
export function interactiveCardProps(onClick: () => void): Pick<HTMLAttributes<HTMLElement>, 'role' | 'tabIndex' | 'onClick' | 'onKeyDown'> {
  return {
    role: 'button',
    tabIndex: 0,
    onClick,
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      // Enter and Space activate a role="button" the same way a native one does.
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onClick()
    }
  }
}

/** Shared name and owner row for settings and preset cards. */
export function CardIdentity({ text, hint, mono, version, tag, chip }: { text: string; hint?: string; mono?: boolean; version?: string; tag?: string; chip?: boolean }): ReactNode {
  return h(
    'div',
    { className: css.rowId },
    hoverHint(hint ?? text, h('span', hintProps({ className: mono === true ? `${css.name} ${css.nameMono}` : css.name }), text)),
    version === undefined ? null : h('span', { className: css.version }, `v${version}`),
    tag === undefined ? null : chip === true ? h('span', { className: css.provenanceChip }, h(Tag, { tone: 'neutral' }, tag)) : h(Tag, { tone: 'neutral' }, tag)
  )
}

/** Shared count and separator for settings and preset cards. */
export function CardCount({ label, count }: { label: string; count: number }): ReactNode {
  return [
    h('span', { key: `sep-${label}`, className: css.separator }, '·'),
    h('span', { key: label, className: css.count }, label, ' ', h('span', { className: css.countValue }, String(count)))
  ]
}

/** Shared warning anchor for settings and preset cards. */
export function CardWarning({
  text,
  label,
  tone = 'warning',
  side,
  portal,
  interactive
}: {
  text: string
  label: string
  tone?: 'warning' | 'quiet'
  side?: 'top' | 'bottom'
  portal?: boolean
  interactive?: boolean
}): ReactNode {
  const stop = (event: { stopPropagation(): void }): void => event.stopPropagation()
  return h(Tooltip, {
    label,
    ...(side === undefined ? {} : { side }),
    ...(portal === true ? { portal: true } : {}),
    children: h('span', { className: css.warnWrap, ...(interactive === true ? { tabIndex: 0, onClick: stop, onKeyDown: stop } : {}) }, h(Tag, { tone }, text))
  })
}
