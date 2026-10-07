import { createElement as h, type HTMLAttributes, type ReactNode } from 'react'
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
