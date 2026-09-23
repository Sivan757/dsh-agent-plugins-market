/**
 * Shared panel building blocks for the plugin workspace surfaces
 * (market / skills / commands / personas / MCP / LSP).
 *
 * Everything the six panels repeat lives here: the header, the trailing header
 * commands, the busy indicator, the entry editor modal, the danger-confirm
 * modal, and the source badge. The pieces are intentionally small and
 * prop-driven so a panel composes them instead of re-implementing the geometry.
 * @module client/ui/panel
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { Button, Modal, IconLoadingOutlineMedium, IconPlusOutlineMedium, IconRefreshOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './panel.module.css'
import cardCss from './resource-card.module.css'
import formCss from './form.module.css'
import { beginBusyOperation } from './busy-operation.js'
import { CodeEditor } from './CodeEditor.js'
import { DetailModal } from './DetailModal.js'
import { MarkdownDocument } from './MarkdownDocument.js'
import type { Translate } from '../index.js'
import { clientErrorMessage } from './error-message.js'

/** The trailing header commands have one position and one visual treatment. */
export function PanelActions(props: { addLabel?: string; onAdd?: () => void; refreshLabel?: string; onRefresh?: () => void; busy?: boolean }): ReactNode {
  // Flat 24px icon buttons, the same geometry as the actions inside a card: the
  // header holds two icons instead of a text button, so its width no longer
  // changes with the language. The labels move to `title` and `aria-label`.
  return h(
    'div',
    { className: css.headerActions },
    props.onAdd === undefined
      ? null
      : h(
          'button',
          { type: 'button', className: cardCss.iconBtn, disabled: props.busy, title: props.addLabel, 'aria-label': props.addLabel, onClick: props.onAdd },
          h(IconPlusOutlineMedium)
        ),
    props.onRefresh === undefined
      ? null
      : h(
          'button',
          { type: 'button', className: cardCss.iconBtn, disabled: props.busy, title: props.refreshLabel, 'aria-label': props.refreshLabel, onClick: props.onRefresh },
          h(IconRefreshOutlineMedium)
        )
  )
}

/** Shared heading geometry for all resource tabs. */
export function PanelHeader(props: { title: string; subtitle?: string; actions?: ReactNode }): ReactNode {
  return h('header', { className: css.header, 'data-panel-header': true },
    h('div', { className: css.headerText },
      h('h2', { className: css.title }, props.title),
      props.subtitle === undefined ? null : h('p', { className: css.subtitle }, props.subtitle)),
    props.actions === undefined ? null : h('div', { className: css.headerActions }, props.actions))
}

/**
 * Inline loading feedback, or a lease on the client's shared blocking overlay.
 * Overlay leases render no layout element and can span request + refresh work.
 */
export function BusyIndicator(props: { label?: string; overlay?: boolean }): ReactNode {
  if (props.overlay) return h(BusyLease)
  return h(
    'div',
    { className: css.busyLine, role: 'status' },
    h('span', { className: `${css.spinner} ${css.spinning}`, 'aria-hidden': true }, h(IconLoadingOutlineMedium)),
    props.label === undefined ? null : h('span', { className: css.busyLabel }, props.label)
  )
}

/** Hold the shared mask through local refresh/validation after the HTTP mutation finishes. */
function BusyLease(): ReactNode {
  useEffect(() => beginBusyOperation(), [])
  return null
}

/** Editor state for the shared entry editor modal. */
export interface PanelEditorState {
  /** 'create' starts a blank draft; 'edit' loads the entry's raw text. */
  mode: 'create' | 'edit'
  name: string
  id?: string
  path?: string
  text: string
}

/** The shared Markdown entry editor: name (create only) + raw text. */
export function EntryEditorModal(props: {
  t: Translate
  open: boolean
  state: PanelEditorState | undefined
  title: string
  /** One line above the body: the segmented control that swaps edit and preview. */
  modeControl?: ReactNode
  nameLabel: string
  /** Placeholder for the name field; defaults to the label. */
  namePlaceholder?: string
  textLabel: string
  /** Shown opposite the dialog's buttons; says what happens after saving. */
  footerHint?: string
  /** A short field that pairs with the name on the create row (e.g. argument hint). */
  renderNamePairField?: (text: string, onChange: (text: string) => void) => ReactNode
  /** True once the caller has switched the body to the rendered draft. */
  showPreview?: boolean
  busy?: boolean
  saveError?: string
  saveLabel?: string
  cancelLabel?: string
  renderFields?: (text: string, onChange: (text: string) => void) => ReactNode
  onClose: () => void
  onSave: (state: PanelEditorState) => Promise<boolean>
}): ReactNode {
  const [draft, setDraft] = useState<PanelEditorState | undefined>(props.state)
  const [error, setError] = useState<string | undefined>(undefined)
  useEffect(() => {
    setDraft(props.state)
    setError(undefined)
  }, [props.state, props.open])
  if (!props.open || props.state === undefined) return null
  const current = draft ?? props.state
  const submit = (): void => {
    if (current.name.trim() === '') {
      setError(props.nameLabel)
      return
    }
    void props
      .onSave({ ...current, name: current.name.trim() })
      .then(ok => {
        // A failed save keeps the modal open; the panel-level error strip also
        // carries the message, so only clear a stale inline validation error.
        if (ok) setError(undefined)
      })
      .catch(reason => setError(clientErrorMessage(props.t, reason)))
  }
  const nameControl = h('input', {
    value: current.name,
    disabled: props.busy,
    placeholder: props.namePlaceholder ?? props.nameLabel,
    'aria-label': props.nameLabel,
    onChange: (event: { target: HTMLInputElement }) => setDraft({ ...current, name: event.target.value })
  })
  return h(
    DetailModal,
    {
      open: true,
      size: 'lg',
      onClose: () => {
        if (props.busy !== true) props.onClose()
      },
      title: props.title,
      closeLabel: props.cancelLabel ?? '×',
      className: css.editorDialog,
      contentClassName: css.editorBody,
      footer: h(
        'div',
        { className: formCss.footer },
        (error ?? props.saveError) === undefined ? null : h('span', { className: formCss.footerError, role: 'alert' }, error ?? props.saveError),
        props.footerHint === undefined ? null : h('span', { className: formCss.footerHint }, props.footerHint),
        h('div', { className: formCss.grow }),
        h(Button, { variant: 'outline', disabled: props.busy, onClick: props.onClose }, props.cancelLabel ?? '×'),
        h(Button, { variant: 'primary', disabled: props.busy === true, onClick: submit }, props.saveLabel ?? '✓')
      )
    },
    // The identity row sits above the body: an entry's name is the one field
    // the document cannot supply.
    props.state.mode !== 'create'
      ? null
      : props.renderNamePairField === undefined
        ? h('label', { className: formCss.field }, h('span', null, props.nameLabel), nameControl)
        : h(
            'div',
            { className: formCss.formGrid },
            h('label', { className: formCss.field }, h('span', null, props.nameLabel), nameControl),
            props.renderNamePairField(current.text, text => setDraft({ ...current, text }))
          ),
    props.renderFields?.(current.text, text => setDraft({ ...current, text })),
    // The document's own row: its label with the view switch on the same line,
    // then one view at a time. Switching to the preview renders the draft once;
    // nothing re-renders while the author types in the editing view.
    props.modeControl === undefined && props.textLabel === undefined
      ? null
      : h('div', { className: formCss.rowHead }, props.textLabel === undefined ? null : h('span', null, props.textLabel), props.modeControl),
    props.showPreview === true
      ? h('div', { className: formCss.previewBox }, h(MarkdownDocument, { text: current.text, t: props.t }))
      : h(CodeEditor, {
          value: current.text,
          onChange: (text: string) => setDraft({ ...current, text }),
          language: 'markdown',
          label: props.textLabel,
          disabled: props.busy,
          minHeight: 300
        })
  )
}

/** Danger-confirm state for the shared confirm modal. */
export interface PanelConfirmState {
  title: string
  description?: string
  /** Optional extra checkbox (e.g. "also delete local files"). */
  checkbox?: { label: string; checked: boolean }
  onConfirm: (checkboxChecked: boolean) => Promise<void> | void
}

/** The shared danger-confirm modal with an optional checkbox. */
export function ConfirmModal(props: { state: PanelConfirmState | undefined; confirmLabel: string; cancelLabel: string; busy?: boolean; onClose: () => void }): ReactNode {
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    setChecked(props.state?.checkbox?.checked === true)
  }, [props.state])
  if (props.state === undefined) return null
  const state = props.state
  return h(
    Modal,
    {
      open: true,
      onClose: props.onClose,
      title: state.title,
      description: state.description,
      closeLabel: props.cancelLabel,
      footer: h(
        'div',
        { className: css.editorFooter },
        h(Button, { variant: 'ghost', onClick: props.onClose }, props.cancelLabel),
        h(
          Button,
          {
            variant: 'primary',
            disabled: props.busy === true,
            onClick: () => {
              void Promise.resolve(state.onConfirm(checked)).then(() => props.onClose())
            }
          },
          props.confirmLabel
        )
      )
    },
    props.state.checkbox === undefined
      ? null
      : h(
          'label',
          { className: css.confirmCheck },
          h('input', {
            type: 'checkbox',
            checked,
            onChange: (event: { target: HTMLInputElement }) => setChecked(event.target.checked)
          }),
          props.state.checkbox.label
        )
  )
}
