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
import { ConfirmModal, PanelActions, PanelHeader, ReadFailed, type PanelConfirmState } from '../../ui/panel.js'
import { ResourceSurface } from '../../ui/ResourceSurface.js'
import { BilingualToggle } from '../../ui/BilingualToggle.js'
import { captureAction, isSelectable, suiteKeyOf, userNameOf } from './output-styles-view-model.js'
import css from './output-styles.module.css'
import panelCss from '../../ui/panel.module.css'

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
  const [detail, setDetail] = useState<OutputStyleRow | undefined>(undefined)
  const [showOriginal, setShowOriginal] = useState(false)

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

  // One tree for every state. The toolbar and the list box exist from the first
  // paint, so a tab switch never moves the panel's content: the earlier version
  // returned a header-only skeleton while loading, and the header, toolbar and
  // list then appeared under it, shifting everything down by 50px.
  const styles = payload === undefined ? [] : payload.styles
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
    error === undefined ? null : h(ReadFailed, { message: error, retryLabel: t('readRetry'), onRetry: refresh }),
    notice === undefined ? null : h('div', { className: panelCss.notice, role: 'status' }, notice),
    // One card per style, the same grid the catalogue panels draw: the list is for
    // scanning and the card opens everything a person can do with that style.
    h(ResourceSurface, {
      t,
      searchLabel: t('cardSearch'),
      searchPlaceholder: t('outputStylesSearchPh'),
      // Source is the only axis these entries differ on, so it is the filter.
      filters: [
        { id: 'user', label: t('outputStylesGroupUser'), match: item => item.tagId === 'user' },
        { id: 'suite', label: t('outputStylesGroupSuite'), match: item => item.tagId === 'suite' }
      ],
      beforeView: h(BilingualToggle, { t, showOriginal, onToggle: () => setShowOriginal(value => !value) }),
      // One selection, chosen from the list: the switch is the choice, not an on/off
      // switch that can be turned off — picking another style is how you change it.
      capabilities: { toggle: true },
      entries: styles.map(row => ({
        id: row.id,
        name: row.label,
        tag: row.source === 'user' ? t('outputStylesGroupUser') : t('outputStylesGroupSuite'),
        tagId: row.source,
        // A suite row carries a typed hint, not a sentence: the words live in the client's
        // dictionaries because the server that built the row cannot know the reader's
        // language.
        description: row.hint === undefined ? row.description : t('outputStylesSuiteCaptureHint'),
        meta: row.source === 'suite' ? (suiteKeyOf(row)?.split('/')[0] ?? '') : `output-styles/${userNameOf(row) ?? ''}.md`,
        // Choosing a style is the one thing this face is for, and it used to live only
        // inside the row's dialog: the card said 套件 and nothing else, so an installed
        // style looked inert. The switch selects it, and the state word says whether it
        // already is. A row without a current capture cannot be selected, so its state
        // names the step that is missing instead.
        stateLabel: row.id === payload?.selected ? t('outputStylesStateSelected') : isSelectable(row) ? t('outputStylesStateNotSelected') : t('outputStylesStateUncaptured'),
        onToggle: () => select(row),
        disabled: !isSelectable(row)
      })),
      emptyText: error !== undefined ? t('statusUnreadable') : loading ? t('loading') : t('outputStylesEmpty'),
      onOpen: id => setDetail(styles.find(row => row.id === id))
    }),
    detail === undefined
      ? null
      : h(StyleDetail, {
          t,
          row: detail,
          selected: detail.id === payload?.selected,
          injected: payload?.injected ?? '',
          busy: busyStyle === detail.id,
          onSelect: () => {
            select(detail)
            setDetail(undefined)
          },
          onCapture: () => {
            capture(detail)
            setDetail(undefined)
          },
          onEdit: () => {
            setEditor({ name: userNameOf(detail) ?? '', description: detail.description, body: detail.body, exists: true })
            setDetail(undefined)
          },
          onDelete: () => {
            askDelete(detail)
            setDetail(undefined)
          },
          onClose: () => setDetail(undefined)
        }),
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

/** One style's detail: its text, what the prompt would carry, and the actions it allows. */
function StyleDetail(props: {
  t: Translate
  row: OutputStyleRow
  selected: boolean
  injected: string
  busy: boolean
  onSelect: () => void
  onCapture: () => void
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}): ReactNode {
  const { t, row, selected, injected, busy, onSelect, onCapture, onEdit, onDelete, onClose } = props
  const userStyle = row.source === 'user'
  const selectable = isSelectable(row)
  const action = captureAction(row)
  // A selected style shows the bytes the prompt receives; another style shows its own
  // text, because that is what selecting it would send.
  const shown = selected && injected !== '' ? injected : row.body
  return h(
    DetailModal,
    {
      open: true,
      size: 'lg',
      onClose,
      title: row.label,
      closeLabel: t('cancel'),
      footer: h(
        'div',
        { className: css.footer },
        selected ? h(Tag, { tone: 'success' }, t('outputStylesSelected')) : null,
        h('div', { className: css.grow }),
        action === 'none'
          ? null
          : h(Button, { variant: 'outline', disabled: busy, onClick: onCapture }, action === 'first' ? t('outputStylesCapture') : t('outputStylesRecapture')),
        userStyle ? h(Button, { variant: 'outline', disabled: busy, onClick: onEdit }, t('panelEdit')) : null,
        userStyle ? h(Button, { variant: 'ghost', disabled: busy, onClick: onDelete }, t('panelDelete')) : null,
        h(Button, { variant: 'primary', disabled: busy || !selectable || selected, onClick: onSelect }, t('outputStylesSelect'))
      )
    },
    h(
      'div',
      { className: css.editorStack },
      h('p', { className: css.rowDescription }, row.description),
      row.capture === 'missing' ? h('p', { className: css.rowWarn }, t('outputStylesCaptureMissing')) : null,
      row.capture === 'stale' ? h('p', { className: css.rowWarn }, t('outputStylesCaptureStale')) : null,
      // The block head every detail section uses: 11px, uppercase, its own bottom
      // margin. This one was 12px sentence case with the margin on the other side.
      h('h4', { className: panelCss.blockHead }, t('outputStylesPreviewTitle')),
      shown === '' ? h('p', { className: panelCss.empty }, t('outputStylesPreviewEmpty')) : h('pre', { className: css.previewText, 'data-output-style-preview': true }, shown)
    )
  )
}
