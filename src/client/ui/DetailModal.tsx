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

/** One wide, viewport-bounded dialog for all resource details and editors. */
export function DetailModal(props: ComponentProps<typeof Modal>): ReactNode {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  return h(
    FooterTarget.Provider,
    { value: target },
    h(Modal, {
      ...props,
      className: `${props.className ?? ''} ${css.dialog}`,
      contentClassName: `${props.contentClassName ?? ''} ${css.body}`,
      footer: h('div', { className: css.footer }, props.footer, h('div', { ref: setTarget, className: css.footerSlot }))
    })
  )
}
