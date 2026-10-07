import { createContext, createElement as h, useContext, useState, type ComponentProps, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { createPortal } from 'react-dom'
import css from './detail.module.css'

const FooterTarget = createContext<HTMLDivElement | null>(null)
const SettingsFrame = createContext<{ footer?: ReactNode } | null>(null)

/** Keep nested resource details in the preset manager's fixed settings-sized frame. */
export function SettingsSizedDetails({ children, footer }: { children: ReactNode; footer?: ReactNode }): ReactNode {
  return h(SettingsFrame.Provider, { value: { footer } }, children)
}

/** Configuration editors contribute their save action to the same fixed footer as other details. */
export function DetailFooterAction({ children }: { children: ReactNode }): ReactNode {
  const target = useContext(FooterTarget)
  return target === null ? null : createPortal(children, target)
}

/** One of the three shipped dialog widths: confirm, small form, or detail. */
export type DetailSize = 'sm' | 'md' | 'lg'

/**
 * How a dialog answers its content's height. `auto` is the host behavior —
 * the dialog is as tall as what it holds; `tall` fixes it to a share of the
 * overlay, which an editor with two views of one document needs: a view
 * switch that resizes the window reads as a flicker, and a long document
 * wants the room.
 */
export type DetailHeight = 'auto' | 'tall'

function sizeClass(size: DetailSize): string {
  if (size === 'sm') return css.sizeSm ?? ''
  if (size === 'md') return css.sizeMd ?? ''
  return css.sizeLg ?? ''
}

/** One dialog chrome for every resource detail and editor. */
export function DetailModal(props: ComponentProps<typeof Modal> & { size?: DetailSize; height?: DetailHeight }): ReactNode {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const settingsFrame = useContext(SettingsFrame)
  const { size = 'lg', height = settingsFrame ? 'tall' : 'auto', ...modal } = props
  // A dialog with no description keeps only the header's own 12px under the
  // title: the host's body margin assumes a sentence sits between the two.
  const compactTop = modal.description === undefined || modal.description === '' ? ` ${css.compactTop}` : ''
  return h(
    FooterTarget.Provider,
    { value: target },
    h(Modal, {
      ...modal,
      className: `${modal.className ?? ''} ${css.dialog} ${sizeClass(size)}${compactTop}${height === 'tall' ? ` ${css.tallDialog}` : ''}${settingsFrame ? ` ${css.settingsFrame}` : ''}`,
      contentClassName: `${modal.contentClassName ?? ''} ${css.body}`,
      footer: h('div', { className: css.footer }, settingsFrame?.footer, modal.footer, h('div', { ref: setTarget, className: css.footerSlot }))
    })
  )
}
