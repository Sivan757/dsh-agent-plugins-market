import { createElement as h, type HTMLAttributes, type ReactNode } from 'react'
import css from './resource-card.module.css'

export type ResourceState = 'active' | 'disabled' | 'warning' | 'error'

/** State chrome shared by every resource, independent of the source and the content layout. */
export function ResourceCard({ state, className, children, ...props }: HTMLAttributes<HTMLElement> & { state: ResourceState; children?: ReactNode }): ReactNode {
  return h('article', { ...props, className: `${className ?? ''} ${css.card}`, 'data-resource-state': state }, children)
}

/** A shared, shrinkable scroll area: grid and list never stretch individual cards vertically. */
export function ResourceCollection({ view, className, children }: { view: 'grid' | 'list'; className?: string; children?: ReactNode }): ReactNode {
  return h('div', { className: `${className ?? ''} ${css.collection}`, 'data-resource-view': view }, children)
}
