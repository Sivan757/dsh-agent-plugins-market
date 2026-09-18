import { createContext, createElement as h, useContext, useState, type ComponentProps, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { createPortal } from 'react-dom'
import css from './detail.module.css'

const FooterTarget = createContext<HTMLDivElement | null>(null)

/** Configuration editors contribute their save action to the same fixed footer as other details. */
export function DetailFooterAction({ children }: { children: ReactNode }): ReactNode {
  const target = useContext(FooterTarget)
  return target === null ? null : createPortal(children, target)
}

/** One of the three shipped dialog widths: confirm, small form, or detail. */
export type DetailSize = 'sm' | 'md' | 'lg'

function sizeClass(size: DetailSize): string {
  if (size === 'sm') return css.sizeSm ?? ''
  if (size === 'md') return css.sizeMd ?? ''
  return css.sizeLg ?? ''
}

/** One dialog chrome for every resource detail and editor. */
export function DetailModal(props: ComponentProps<typeof Modal> & { size?: DetailSize }): ReactNode {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const { size = 'lg', ...modal } = props
  return h(
    FooterTarget.Provider,
    { value: target },
    h(Modal, {
      ...modal,
      className: `${modal.className ?? ''} ${css.dialog} ${sizeClass(size)}`,
      contentClassName: `${modal.contentClassName ?? ''} ${css.body}`,
      footer: h('div', { className: css.footer }, modal.footer, h('div', { ref: setTarget, className: css.footerSlot }))
    })
  )
}
