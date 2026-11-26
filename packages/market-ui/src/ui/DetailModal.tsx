import { createContext, createElement as h, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { createPortal } from 'react-dom'
import css from './detail.module.css'
import formCss from './form.module.css'

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

/** The three shipped dialog widths: confirm, form, or detail and editor. */
export type DetailSize = 'sm' | 'md' | 'lg'

/**
 * How a dialog answers its content's height.
 *
 * `auto` follows the content. `short`, `regular` and `frame` fix the window
 * instead, so a state that fills later — a suggestion list, a loading state,
 * an editor's second view — cannot resize the dialog under the reader. `frame`
 * is the settings-sized frame the preset manager and the details it opens share.
 */
export type DetailHeight = 'auto' | 'short' | 'regular' | 'frame'

const HEIGHT_CLASS: Record<Exclude<DetailHeight, 'auto'>, string> = {
  short: css.heightShort ?? '',
  regular: css.heightRegular ?? '',
  frame: css.heightFrame ?? ''
}

function sizeClass(size: DetailSize): string {
  if (size === 'sm') return css.sizeSm ?? ''
  if (size === 'md') return css.sizeMd ?? ''
  return css.sizeLg ?? ''
}

function heightClass(height: DetailHeight): string {
  return height === 'auto' ? '' : ` ${HEIGHT_CLASS[height]} ${css.fixedHeight ?? ''}`
}

/**
 * The dialog body's scroll container and its floating thumb.
 *
 * The native scrollbar is hidden and takes no width, so a body that overflows
 * does not shorten its own content by a scrollbar's width: the dialog's fields
 * keep the same right edge as its header and footer whether or not it scrolls,
 * and the layout does not shift when a scrollbar appears. A slim translucent
 * thumb reports the position instead, painted above the content.
 */
function ScrollRegion({ children }: { children: ReactNode }): ReactNode {
  const scroll = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = scroll.current
    const inner = content.current
    const bar = thumb.current
    if (node === null || inner === null || bar === null) return
    let frame = 0
    const paint = (): void => {
      const range = node.scrollHeight - node.clientHeight
      const height = Math.max(24, Math.round(node.clientHeight * (node.clientHeight / node.scrollHeight)))
      bar.style.height = `${height}px`
      bar.style.opacity = range > 1 ? '1' : '0'
      bar.style.transform = `translateY(${range > 1 ? (node.scrollTop / range) * (node.clientHeight - height) : 0}px)`
    }
    const schedule = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        paint()
      })
    }
    paint()
    node.addEventListener('scroll', schedule, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    observer?.observe(node)
    observer?.observe(inner)
    window.addEventListener('resize', schedule)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      node.removeEventListener('scroll', schedule)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [])
  return h(
    'div',
    { className: css.scrollHost },
    h('div', { className: css.scrollBody, ref: scroll }, h('div', { className: css.scrollContent, ref: content }, children)),
    h('div', { className: css.scrollThumb, ref: thumb, 'aria-hidden': true })
  )
}

/**
 * One dialog chrome for every resource detail and editor.
 *
 * The three parts are fixed: the host's title row, a body that owns its own
 * scrolling, and one footer row. A dialog's actions are that row's whole
 * content, right-aligned — never prose, a count, or a hint beside them — and a
 * refused request is reported under the title, where the reader meets the form
 * rather than at the edge where they press the button.
 */
export function DetailModal(
  props: ComponentProps<typeof Modal> & {
    size?: DetailSize
    height?: DetailHeight
    /** The dialog's actions, in reading order; they render as one right-aligned row. */
    actions?: ReactNode
    /** A failed save or refused request, reported under the title. */
    alert?: string | undefined
  }
): ReactNode {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const settingsFrame = useContext(SettingsFrame)
  // A detail opened from the preset manager rides the manager's frame: its own
  // width and height are the frame's, not a second size chosen at random.
  const { size: sizeProp, height: heightProp, actions, alert, ...modal } = props
  const size: DetailSize = settingsFrame ? 'lg' : (sizeProp ?? 'lg')
  const height: DetailHeight = settingsFrame ? 'frame' : (heightProp ?? 'auto')
  // A dialog with no description keeps only the header's own 12px under the
  // title: the host's body margin assumes a sentence sits between the two.
  const compactTop = modal.description === undefined || modal.description === '' ? ` ${css.compactTop}` : ''
  return h(
    FooterTarget.Provider,
    { value: target },
    h(Modal, {
      ...modal,
      className: `${modal.className ?? ''} ${css.dialog} ${sizeClass(size)}${compactTop}${heightClass(height)}`,
      contentClassName: `${modal.contentClassName ?? ''} ${css.body}`,
      children: [
        alert === undefined || alert === '' ? null : h('p', { key: 'alert', className: css.alert, role: 'alert' }, alert),
        h(ScrollRegion, { key: 'scroll', children: h('div', { className: css.contentStack }, modal.children) })
      ],
      footer: h('div', { className: css.footer }, settingsFrame?.footer, actions, h('div', { ref: setTarget, className: css.footerSlot }))
    })
  )
}

/**
 * One form's dialog: the shared shell, a single column of fields, and the
 * actions that submit it.
 *
 * A form dialog and a detail dialog are the same chrome seen from two sides, so
 * both ride {@link DetailModal}. What this adds is the form body: one column
 * with the sheet's field gap, so every editor spaces its fields the same way.
 */
export function FormDialog(props: {
  title: string
  /** The sentence under the title: what this form does, never a footer note. */
  description?: string | undefined
  /** A refused save, reported under the title. */
  alert?: string | undefined
  /** The footer's buttons, in reading order; they render right-aligned. */
  actions?: ReactNode
  onClose: () => void
  closeLabel: string
  size?: DetailSize
  height?: DetailHeight
  className?: string | undefined
  contentClassName?: string | undefined
  /** The form body; fields keep their own labels and inline reasons. */
  children?: ReactNode
}): ReactNode {
  return h(DetailModal, {
    open: true,
    title: props.title,
    ...(props.description === undefined ? {} : { description: props.description }),
    ...(props.alert === undefined ? {} : { alert: props.alert }),
    ...(props.actions === undefined ? {} : { actions: props.actions }),
    ...(props.size === undefined ? {} : { size: props.size }),
    ...(props.height === undefined ? {} : { height: props.height }),
    ...(props.className === undefined ? {} : { className: props.className }),
    ...(props.contentClassName === undefined ? {} : { contentClassName: props.contentClassName }),
    onClose: props.onClose,
    closeLabel: props.closeLabel,
    children: h('div', { className: formCss.form }, props.children)
  })
}
