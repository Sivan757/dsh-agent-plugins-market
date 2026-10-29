/**
 * A card grid for panels that list a handful of files or styles.
 *
 * The catalog panels already speak this language: one card per entry, a title with its
 * family chip, one line of detail, and a click that opens it. This reuses those card
 * primitives for panels whose entries are files rather than plugin resources, so the two
 * kinds of panel look like the same product.
 * @module client/ui/CardListSurface
 */
import { createElement as h, type ReactNode } from 'react'
import { CardIdentity, ResourceCard, ResourceCollection, interactiveCardProps } from './ResourceCard.js'
import { useWorkspaceView } from './workspace-view.js'
import surface from './card-list-surface.module.css'

/** One entry: what it is called, which family it belongs to, and its one line of detail. */
export interface CardListItem {
  id: string
  /** The card's title: a path for a file, a name for a style. */
  name: string
  /** The chip after the title. */
  tag: string
  /** One sentence under the title; omitted when the entry has none. */
  description?: string
  /** The quiet line at the bottom: size, scope, or the source it came from. */
  meta: string
  /** Whether the entry can be used as it stands. */
  disabled?: boolean
}

export interface CardListSurfaceProps {
  items: readonly CardListItem[]
  /** Shown when there is nothing to render. */
  emptyText: string
  /** Opens one entry. */
  onOpen: (id: string) => void
}

/**
 * Render the shared card grid.
 * @param props - the entries, the empty line, and the open callback.
 * @returns the cards, or the empty line.
 */
export function CardListSurface({ items, emptyText, onOpen }: CardListSurfaceProps): ReactNode {
  const [view] = useWorkspaceView()
  if (items.length === 0) return h('p', { className: surface.empty }, emptyText)
  return h(
    ResourceCollection,
    { view },
    items.map(item =>
      h(
        ResourceCard,
        {
          key: item.id,
          state: item.disabled === true ? 'disabled' : 'active',
          ...interactiveCardProps(() => onOpen(item.id))
        },
        h(CardIdentity, { text: item.name, mono: true }),
        h('span', { className: surface.tag }, item.tag),
        item.description === undefined ? null : h('p', { className: surface.description }, item.description),
        h('span', { className: surface.meta }, item.meta)
      )
    )
  )
}
