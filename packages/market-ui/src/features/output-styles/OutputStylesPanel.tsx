/**
 * The output-styles surface: one card per style, the detail a card opens, and the
 * text a person reads before any of it reaches the prompt.
 *
 * Every style is a Markdown file: one the person wrote, one a suite ships, or one the
 * workspace keeps. Nothing is captured and nothing runs, so the page is a read of files
 * the reader can also open in an editor.
 * @module features/output-styles/OutputStylesPanel
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button, IconTrashOutlineMedium, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OutputStyleRow, OutputStylesPayload } from '../../../../market-contracts/src/contracts/output-styles.js'
import { deleteUserOutputStyle, fetchOutputStyles, saveUserOutputStyle, selectOutputStyle } from '../../api.js'
import type { Translate } from '../../i18n.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import { CodeEditor } from '../../ui/CodeEditor.js'
import { buildFaceEntry } from '../../ui/face-entry.js'
import { DetailModal } from '../../ui/DetailModal.js'
import { ConfirmModal, PanelActions, PanelHeader, ReadFailed, type PanelConfirmState } from '../../ui/panel.js'
import { ResourceSurface } from '../../ui/ResourceSurface.js'
import { surfaceProviderCuts } from '../../ui/surface-facets.js'
import { BilingualToggle } from '../../ui/BilingualToggle.js'
import { groupLocaleKey, sourceMetaOf, userNameOf } from './output-styles-view-model.js'
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
      // The shared provider facet: who wrote the style, not where its text came from.
      filters: surfaceProviderCuts('outputStyles', t, id => (id.startsWith('user:') ? 'user' : 'suite')),
      beforeView: h(BilingualToggle, { t, showOriginal, onToggle: () => setShowOriginal(value => !value) }),
      // One selection, chosen from the list: the switch is the choice, not an on/off
      // switch that can be turned off — picking another style is how you change it. The
      // handler belongs to the surface, not to an entry: the renderer reads the surface's
      // handler, so an entry-level one drew no switch at all.
      capabilities: { toggle: true },
      onToggle: (id: string) => {
        const row = styles.find(item => item.id === id)
        if (row !== undefined) select(row)
      },
      isOn: (id: string) => id === payload?.selected,
      // The shared builder paints the rail and writes the switch's verb; this face supplies
      // its own words for the two states a style can be in.
      entries: styles.map(row => {
        const userName = userNameOf(row)
        return {
          ...buildFaceEntry(
            t,
            {
              surface: 'commands',
              provider: row.source === 'user' ? 'user' : 'suite',
              id: row.id,
              name: row.label,
              tag: t(groupLocaleKey(row.source)),
              ...(row.description === undefined ? {} : { description: row.description }),
              meta: row.source === 'user' ? `output-styles/${userName ?? ''}.md` : sourceMetaOf(row),
              // Choosing a style is the one thing this face is for. The switch selects and the
              // state word says whether it already is.
              showSwitch: true,
              on: row.id === payload?.selected,
              liveWord: row.id === payload?.selected ? t('outputStylesStateSelected') : t('outputStylesStateNotSelected')
            },
            'settings'
          ),
          tagId: row.source,
          // The switch is a choice, not an on/off: the verb says so. Without a verb a screen
          // reader hears the style's own name twice, once for the row and once for the control.
          toggleLabel: t('outputStylesSelect'),
          // A style the person wrote is theirs to remove; a suite's or the workspace's is
          // not. The icon opens the panel's existing confirmation, never the removal.
          ...(row.source === 'user' && userName !== undefined
            ? {
                actions: [
                  {
                    id: 'delete',
                    // The accessible name says the verb and the row; the tooltip
                    // is the bare verb, the way the switch and the edit button
                    // do it.
                    label: t('outputStylesDelete') + ' ' + userName,
                    title: t('outputStylesDelete'),
                    icon: h(IconTrashOutlineMedium),
                    danger: true,
                    onSelect: () => askDelete(row)
                  }
                ]
              }
            : {})
        }
      }),
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
  // What the editor held when the current draft arrived, so undo can put it back.
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
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}): ReactNode {
  const { t, row, selected, injected, busy, onSelect, onEdit, onDelete, onClose } = props
  const userStyle = row.source === 'user'
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
        userStyle ? h(Button, { variant: 'outline', disabled: busy, onClick: onEdit }, t('panelEdit')) : null,
        userStyle ? h(Button, { variant: 'ghost', disabled: busy, onClick: onDelete }, t('panelDelete')) : null,
        h(Button, { variant: 'primary', disabled: busy || selected, onClick: onSelect }, t('outputStylesSelect'))
      )
    },
    h(
      'div',
      { className: css.editorStack },
      h('p', { className: css.rowDescription }, row.description),
      // The block head every detail section uses: 11px, uppercase, its own bottom
      // margin. This one was 12px sentence case with the margin on the other side.
      h('h4', { className: panelCss.blockHead }, t('outputStylesPreviewTitle')),
      shown === '' ? h('p', { className: panelCss.empty }, t('outputStylesPreviewEmpty')) : h('pre', { className: css.previewText, 'data-output-style-preview': true }, shown)
    )
  )
}
