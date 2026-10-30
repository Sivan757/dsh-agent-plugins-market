import { createElement as h, type HTMLAttributes, type ReactNode } from 'react'
import { Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { hintProps, hoverHint } from './hover-hint.js'
import css from './resource-card.module.css'

/**
 * The card's chrome.
 *
 * `absent` is an entry the surface lists but does not own yet — an uninstalled
 * suite. It keeps the rail's width so a grid of them still lines up, and paints
 * nothing: "switched off" and "not here yet" are different facts, and the reader
 * acts on them differently.
 */
export type ResourceState = 'active' | 'disabled' | 'warning' | 'error' | 'absent'

/** The surface a card belongs to; a few narrow-container rules key off it. */
export type ResourceSurface = 'market' | 'skills' | 'commands' | 'personas' | 'mcp' | 'lsp' | 'hooks'

/** State chrome shared by every resource, independent of the source and the content layout. */
export function ResourceCard({
  state,
  surface,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  state: ResourceState
  surface?: ResourceSurface
  /** Stable identity of the entry the card renders, for tests and for focus restoration. */
  'data-resource-id'?: string
  /**
   * Where this card sits in the set the surface matched, so assistive technology
   * can say "3 of 971" rather than "3 of 120 rendered". The collection pages
   * itself, so the DOM alone cannot tell the difference.
   */
  position?: number
  /** How many entries the surface matched, including the ones not rendered yet. */
  count?: number
  children?: ReactNode
}): ReactNode {
  return h(
    'article',
    {
      ...props,
      className: `${className ?? ''} ${css.card}`,
      role: 'listitem',
      ...(props.position === undefined ? {} : { 'aria-posinset': props.position }),
      ...(props.count === undefined ? {} : { 'aria-setsize': props.count }),
      'data-resource-state': state,
      'data-resource-surface': surface
    },
    children
  )
}

/** A shared, shrinkable scroll area: grid and list never stretch individual cards vertically. */
export function ResourceCollection({
  view,
  className,
  children,
  ...rest
}: { view: 'grid' | 'list'; className?: string; children?: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children'>): ReactNode {
  // A list, so a reader learns the set has a size and where each card sits in
  // it; the grid/flex display is unaffected by the role.
  return h('div', { className: `${className ?? ''} ${css.collection}`, role: 'list', 'data-resource-view': view, ...rest }, children)
}

/**
 * Shared name and owner row for settings and preset cards.
 *
 * The name is the card's own control when the card can be opened: the card is a
 * plain region and the pointer may still click anywhere on it, but a region that
 * contains a switch, an editor and icon actions cannot itself be the button —
 * ARIA flattens the controls inside a button into its name, and every real
 * control disappears from the accessibility tree. One opener, named by the entry,
 * beside the controls rather than around them.
 */
export function CardIdentity({
  text,
  hint,
  mono,
  version,
  tag,
  chip,
  stateLabel,
  onOpen
}: {
  text: string
  hint?: string
  mono?: boolean
  version?: string
  tag?: string
  chip?: boolean
  /**
   * The state in words, for a reader who cannot decode the 3px rail's colour.
   * Rendered for assistive technology only: the visible cue is the rail.
   */
  stateLabel?: string
  /** Opens the entry; when absent the name is plain text. */
  onOpen?: () => void
}): ReactNode {
  const name = hoverHint(hint ?? text, h('span', hintProps({ className: mono === true ? `${css.name} ${css.nameMono}` : css.name }), text))
  return h(
    'div',
    { className: css.rowId, 'data-card-row': 'id' },
    onOpen === undefined
      ? name
      : h(
          'button',
          {
            type: 'button',
            className: css.nameButton,
            'data-card-open': '',
            // The pointer already opens the card anywhere; this click must not
            // reach the card's own handler and open it twice.
            onClick: (event: { stopPropagation: () => void }) => {
              event.stopPropagation()
              onOpen()
            }
          },
          name
        ),
    version === undefined ? null : h('span', { className: css.version }, `v${version}`),
    tag === undefined ? null : chip === true ? h('span', { className: css.provenanceChip }, h(Tag, { tone: 'neutral' }, tag)) : h(Tag, { tone: 'neutral' }, tag),
    stateLabel === undefined ? null : h('span', { className: css.srOnly }, stateLabel)
  )
}

/**
 * The card's body row: the surface's subject, clamped to two lines by `.desc`.
 *
 * A row, not a bare paragraph: the card is a grid with named areas, so a slot that
 * carries no area class is auto-placed into the first free cell — the action column
 * of a card that has no action — and its text lands beside the name.
 */
export function CardBody({ children }: { children?: ReactNode }): ReactNode {
  return h('div', { className: css.rowBody, 'data-card-row': 'body' }, children)
}

/** The card's source row: provenance, counts, and warnings on one quiet line. */
export function CardFoot({ children }: { children?: ReactNode }): ReactNode {
  return h('div', { className: css.rowFoot, 'data-card-row': 'foot' }, children)
}

/**
 * The card's action cluster, ending in the switch.
 *
 * The cluster is in flow in both views, so the control that says whether an entry
 * is on never hides behind a hover; only the secondary icons fade in.
 */
export function CardActions({ children }: { children?: ReactNode }): ReactNode {
  return h('div', { className: css.rowActions, 'data-card-row': 'actions' }, children)
}

/** Shared count and separator for settings and preset cards. */
export function CardCount({ label, count, first = false }: { label: string; count: number; first?: boolean }): ReactNode {
  return [
    first ? null : h('span', { key: `sep-${label}`, className: css.separator }, '·'),
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
