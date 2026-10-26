/**
 * Output styles panel: choose, author and preview the instruction block the
 * session prompt receives.
 *
 * The preview is the point of the surface. It renders the server's own
 * `injected` string, which the server builds with the same function the prompt
 * section uses, so what a person reads here is byte for byte what the model
 * gets, heading included.
 *
 * A suite style is the one row whose text is not authored in place: a suite
 * delivers it by running a hook, so the text is captured once, explicitly, and
 * shown before it can be selected. A capture stops matching when the suite
 * changes, and the row says so instead of replaying text nobody re-approved.
 * @module features/output-styles/OutputStylesPanel
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OutputStyleRow, OutputStylesPayload } from '../../api.js'
import { captureOutputStyle, deleteUserOutputStyle, fetchOutputStyles, saveUserOutputStyle, selectOutputStyle } from '../../api.js'
import type { Translate } from '../../i18n.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import { CodeEditor } from '../../ui/CodeEditor.js'
import { DetailModal } from '../../ui/DetailModal.js'
import { ConfirmModal, PanelActions, PanelHeader, type PanelConfirmState } from '../../ui/panel.js'
import { captureAction, groupLocaleKey, groupOutputStyles, isSelectable, suiteKeyOf, userNameOf } from './output-styles-view-model.js'
import css from './output-styles.module.css'

interface OutputStylesPanelProps {
  t: Translate
  /** The live session whose workspace this selection belongs to. */
  sessionId?: string
}

/** The one style document the page is drafting. */
interface EditorState {
  name: string
  description: string
  body: string
  exists: boolean
}

/** The output-style surface. */
export function OutputStylesPanel({ t, sessionId }: OutputStylesPanelProps): ReactNode {
  const [payload, setPayload] = useState<OutputStylesPayload | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [busyStyle, setBusyStyle] = useState<string | undefined>(undefined)
  const [editor, setEditor] = useState<EditorState | undefined>(undefined)
  const [confirm, setConfirm] = useState<PanelConfirmState | undefined>(undefined)

  const refresh = (): void => {
    setLoading(true)
    setError(undefined)
    fetchOutputStyles(sessionId)
      .then(setPayload)
      .catch(caught => setError(clientErrorMessage(t, caught)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    // The selection belongs to the session's workspace, so a different session
    // is a different read.
  }, [sessionId])

  const select = (row: OutputStyleRow): void => {
    setNotice(undefined)
    setError(undefined)
    setBusyStyle(row.id)
    selectOutputStyle(row.id, sessionId)
      .then(setPayload)
      .catch(caught => setError(clientErrorMessage(t, caught)))
      .finally(() => setBusyStyle(undefined))
  }

  const capture = (row: OutputStyleRow): void => {
    const suiteKey = suiteKeyOf(row)
    if (suiteKey === undefined) return
    setNotice(undefined)
    setError(undefined)
    setBusyStyle(row.id)
    captureOutputStyle(suiteKey, sessionId)
      .then(result => {
        setNotice(t('outputStylesCapturedAt') + ' ' + String(result.text.length) + ' · ' + row.label)
        refresh()
      })
      .catch(caught => setError(clientErrorMessage(t, caught)))
      .finally(() => setBusyStyle(undefined))
  }

  const save = async (draft: EditorState): Promise<boolean> => {
    try {
      setPayload(await saveUserOutputStyle({ name: draft.name.trim(), description: draft.description, body: draft.body }, sessionId))
      setEditor(undefined)
      return true
    } catch (caught) {
      setError(clientErrorMessage(t, caught))
      return false
    }
  }

  const askDelete = (row: OutputStyleRow): void => {
    const name = userNameOf(row)
    if (name === undefined) return
    setConfirm({
      title: t('outputStylesDeleteTitle', { name }),
      description: t('outputStylesDeleteDesc'),
      onConfirm: async () => {
        try {
          setPayload(await deleteUserOutputStyle(name, sessionId))
        } catch (caught) {
          setError(clientErrorMessage(t, caught))
        }
      }
    })
  }

  if (payload === undefined) {
    return h(
      'div',
      { className: css.surface },
      h(PanelHeader, { subtitle: t('outputStylesSubtitle') }),
      h('div', { className: css.empty }, loading ? t('loading') : t('outputStylesErrorTitle'))
    )
  }

  return h(
    'div',
    { className: css.surface },
    h(PanelHeader, {
      subtitle: t('outputStylesSubtitle'),
      actions: h(PanelActions, {
        addLabel: t('outputStylesCreate'),
        onAdd: () => setEditor({ name: '', description: '', body: '', exists: false }),
        refreshLabel: t('refresh'),
        onRefresh: refresh,
        busy: loading
      })
    }),
    error === undefined ? null : h('div', { className: css.error, role: 'alert' }, t('outputStylesErrorTitle'), ' ', error),
    notice === undefined ? null : h('div', { className: css.notice, role: 'status' }, notice),
    ...groupOutputStyles(payload.styles).map(group =>
      h(
        'section',
        { key: group.source, className: css.group },
        h('h3', { className: css.groupTitle }, t(groupLocaleKey(group.source))),
        h(
          'ul',
          { className: css.list },
          group.rows.map(row =>
            h(StyleRow, {
              key: row.id,
              row,
              t,
              selected: row.id === payload.selected,
              busy: busyStyle === row.id,
              onSelect: () => select(row),
              onCapture: () => capture(row),
              onEdit: () => setEditor({ name: userNameOf(row) ?? '', description: row.description, body: row.body, exists: true }),
              onDelete: () => askDelete(row)
            })
          )
        )
      )
    ),
    h(
      'section',
      { className: css.preview, 'data-output-style-preview': true },
      h('h3', { className: css.groupTitle }, t('outputStylesPreviewTitle')),
      payload.injected === '' ? h('p', { className: css.empty }, t('outputStylesPreviewEmpty')) : h('pre', { className: css.previewText }, payload.injected)
    ),
    editor === undefined ? null : h(StyleEditor, { t, draft: editor, error, onChange: setEditor, onClose: () => setEditor(undefined), onSave: save }),
    h(ConfirmModal, { state: confirm, confirmLabel: t('panelDelete'), cancelLabel: t('cancel'), onClose: () => setConfirm(undefined) })
  )
}

/** The editor dialog for one user-authored style. */
function StyleEditor(props: {
  t: Translate
  draft: EditorState
  error: string | undefined
  onChange: (draft: EditorState) => void
  onClose: () => void
  onSave: (draft: EditorState) => Promise<boolean>
}): ReactNode {
  const { t, draft, error, onChange, onClose, onSave } = props
  const [busy, setBusy] = useState(false)
  const nameValid = /^[a-z0-9][a-z0-9._-]*$/.test(draft.name.trim())
  return h(
    DetailModal,
    {
      open: true,
      size: 'lg',
      onClose,
      title: draft.exists ? t('outputStylesEditTitle', { name: draft.name }) : t('outputStylesCreateTitle'),
      closeLabel: t('cancel'),
      footer: h(
        'div',
        { className: css.footer },
        error === undefined ? null : h('span', { className: css.footerError, role: 'alert' }, error),
        h('span', { className: css.footerHint }, t('outputStylesNameHint')),
        h('div', { className: css.grow }),
        h(Button, { variant: 'outline', onClick: onClose }, t('cancel')),
        h(
          Button,
          {
            variant: 'primary',
            disabled: busy || !nameValid,
            onClick: () => {
              setBusy(true)
              void onSave(draft).finally(() => setBusy(false))
            }
          },
          t('save')
        )
      )
    },
    h(
      'div',
      { className: css.editorStack },
      h(
        'label',
        { className: css.field },
        h('span', null, t('outputStylesName')),
        h('input', {
          value: draft.name,
          disabled: draft.exists || busy,
          'aria-label': t('outputStylesName'),
          onChange: (event: { target: HTMLInputElement }) => onChange({ ...draft, name: event.target.value })
        })
      ),
      h(
        'label',
        { className: css.field },
        h('span', null, t('outputStylesDescription')),
        h('input', {
          value: draft.description,
          disabled: busy,
          'aria-label': t('outputStylesDescription'),
          onChange: (event: { target: HTMLInputElement }) => onChange({ ...draft, description: event.target.value })
        })
      ),
      h(CodeEditor, {
        value: draft.body,
        onChange: (body: string) => onChange({ ...draft, body }),
        language: 'markdown',
        label: t('outputStylesBody'),
        minHeight: 240
      })
    )
  )
}

/** One style row: a selection control, the label, its state, and its actions. */
function StyleRow(props: {
  row: OutputStyleRow
  t: Translate
  selected: boolean
  busy: boolean
  onSelect: () => void
  onCapture: () => void
  onEdit: () => void
  onDelete: () => void
}): ReactNode {
  const { row, t, selected, busy, onSelect, onCapture, onEdit, onDelete } = props
  const userStyle = row.source === 'user'
  const selectable = isSelectable(row)
  const action = captureAction(row)
  const group = 'output-style-' + row.id.replace(/[^a-z0-9]+/gi, '-')
  return h(
    'li',
    { className: selected ? css.rowSelected : css.row, 'data-output-style-row': row.id, 'data-selected': selected ? 'true' : 'false' },
    h('input', {
      type: 'radio',
      name: 'output-style',
      id: group,
      checked: selected,
      disabled: busy || !selectable,
      'aria-label': row.label,
      onChange: onSelect
    }),
    h(
      'label',
      { className: css.rowBody, htmlFor: group, title: row.description },
      h('span', { className: css.rowLabel }, row.label),
      h('span', { className: css.rowDescription }, row.description),
      row.capture === 'missing' ? h('span', { className: css.rowWarn }, t('outputStylesCaptureMissing')) : null,
      row.capture === 'stale' ? h('span', { className: css.rowWarn }, t('outputStylesCaptureStale')) : null
    ),
    selected ? h(Tag, { tone: 'success' }, t('outputStylesSelected')) : null,
    action === 'none'
      ? null
      : h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: onCapture }, action === 'first' ? t('outputStylesCapture') : t('outputStylesRecapture')),
    userStyle ? h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: onEdit }, t('panelEdit')) : null,
    userStyle ? h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: onDelete }, t('panelDelete')) : null
  )
}
