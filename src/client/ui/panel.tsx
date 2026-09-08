/**
 * Shared panel building blocks for the plugin workspace surfaces
 * (market / skills / commands / personas / MCP / LSP).
 *
 * Everything the six panels repeat lives here: the surface shell (title +
 * actions + toolbar + scrollable content region), the busy indicator, the
 * entry editor modal, the danger-confirm modal, and the source badge. The
 * pieces are intentionally small and prop-driven so a panel composes them
 * instead of re-implementing the geometry.
 * @module client/ui/panel
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { Button, Input, Modal, IconLoadingOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './panel.module.css'

/** One header action slot (a button + its handler). */
export interface PanelAction {
  key: string
  label: string
  title?: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

/** Shared heading geometry for all resource tabs. */
export function PanelHeader(props: { title: string; subtitle?: string; actions?: ReactNode }): ReactNode {
  return h('header', { className: css.header, 'data-panel-header': true },
    h('div', { className: css.headerText },
      h('h2', { className: css.title }, props.title),
      props.subtitle === undefined ? null : h('p', { className: css.subtitle }, props.subtitle)),
    props.actions === undefined ? null : h('div', { className: css.headerActions }, props.actions))
}

/** Shared panel shell: title, subtitle, actions, and the scroll region body. */
export function PanelShell(props: { title: string; subtitle?: string; actions?: PanelAction[]; children: ReactNode }): ReactNode {
  return h(
    'div',
    { className: css.shell },
    h(PanelHeader, {
      title: props.title,
      subtitle: props.subtitle,
      actions: props.actions?.map(action =>
              h(
                Button,
                {
                  key: action.key,
                  variant: 'ghost',
                  size: 'sm',
                  disabled: action.disabled === true,
                  title: action.title ?? action.label,
                  onClick: action.onSelect
                },
                action.label
              )
            )
    }),
    h('div', { className: css.body }, props.children)
  )
}

/**
 * Global busy indicator: an inline spinner with an optional label. Panels
 * render it as an overlay strip while a mutation is in flight so every
 * action's pending state reads identically across the workspace.
 */
export function BusyIndicator(props: { label?: string; overlay?: boolean }): ReactNode {
  return h(
    'div',
    { className: props.overlay === true ? css.busyOverlay : css.busyLine, role: 'status' },
    h('span', { className: `${css.spinner} ${css.spinning}`, 'aria-hidden': true }, h(IconLoadingOutline16)),
    props.label === undefined ? null : h('span', { className: css.busyLabel }, props.label)
  )
}

/** The source badge: where an entry comes from (suite plugin vs user). */
export function SourceBadge(props: { kind: 'plugin' | 'user'; label: string; detail?: string }): ReactNode {
  return h('span', { className: props.kind === 'plugin' ? css.badgePlugin : css.badgeUser, title: props.detail ?? props.label }, props.label)
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
  open: boolean
  state: PanelEditorState | undefined
  title: string
  nameLabel: string
  textLabel: string
  hint?: string
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
  return h(
    Modal,
    {
      open: true,
      onClose: () => {
        if (props.busy !== true) props.onClose()
      },
      title: props.title,
      closeLabel: props.cancelLabel ?? '×',
      className: css.editorDialog,
      contentClassName: css.editorBody,
      footer: h(
        'div',
        { className: css.editorFooter },
        (error ?? props.saveError) === undefined ? null : h('span', { className: css.editorError, role: 'alert' }, error ?? props.saveError),
        h(Button, { variant: 'ghost', disabled: props.busy, onClick: props.onClose }, props.cancelLabel ?? '×'),
        h(
          Button,
          {
            variant: 'primary',
            disabled: props.busy === true,
            onClick: () => {
              if (current.name.trim() === '') {
                setError(props.nameLabel)
                return
              }
              void props
                .onSave({ ...current, name: current.name.trim() })
                .then(ok => {
                  // A failed save keeps the modal open; the panel-level
                  // error strip also carries the message, so only clear a
                  // stale inline validation error here.
                  if (ok) setError(undefined)
                })
                .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
            }
          },
          props.saveLabel ?? '✓'
        )
      )
    },
    h(
      'div',
      { className: css.editorForm },
      props.state.mode === 'create'
        ? h(
            'label',
            { className: css.editorLabel },
            props.nameLabel,
            h(Input, {
              value: current.name,
              placeholder: props.nameLabel,
              'aria-label': props.nameLabel,
              onChange: (event: { target: HTMLInputElement }) => setDraft({ ...current, name: event.target.value })
            })
          )
        : h(
            'div',
            { className: css.editorNameRow },
            h('span', { className: css.editorName }, current.name),
            h('code', { className: css.editorPath }, props.state.path ?? props.state.name)
          ),
      props.renderFields?.(current.text, text => setDraft({ ...current, text })),
      props.hint === undefined ? null : h('p', { className: css.editorHint }, props.hint),
      h(
        'label',
        { className: css.editorLabel },
        props.textLabel,
        h('textarea', {
          className: css.editorArea,
          value: current.text,
          rows: 14,
          spellCheck: false,
          'aria-label': props.textLabel,
          onChange: (event: { target: HTMLTextAreaElement }) => setDraft({ ...current, text: event.target.value })
        })
      )
    )
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
  return h(
    Modal,
    {
      open: true,
      onClose: props.onClose,
      title: props.state.title,
      description: props.state.description,
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
              void Promise.resolve(props.state!.onConfirm(checked)).then(() => props.onClose())
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
