/**
 * The generic user-panel surface: search, state filter, grid/list toggle,
 * and full CRUD over one user panel directory. The skills / commands /
 * agent-personas panels mount this component with their own kind and copy —
 * one implementation, three surfaces, identical interaction language.
 * @module client/ui/UserPanelSurface
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconEditOutline16, IconTrashOutline16, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { createUserPanelEntry, deleteUserPanelEntry, fetchUserPanel, updateUserPanelEntry, type UserPanelEntry, type UserPanelKind } from '../api.js'
import { commandCallName } from '../../model/command-names.js'
import type { Translate } from '../index.js'
import { SearchFilterToolbar } from '../SearchFilterToolbar.js'
import { ResourceCard, ResourceCollection } from './ResourceCard.js'
import { useWorkspaceView } from './workspace-view.js'
import { PanelActions, PanelHeader, BusyIndicator, ConfirmModal, EntryEditorModal, type PanelConfirmState, type PanelEditorState } from './panel.js'
import css from './panel.module.css'
import formCss from './form.module.css'
import rc from './resource-card.module.css'
import { RoleMetadataFields } from '../features/personas/RoleMetadataFields.js'
import { UserEntryDetailModal } from './UserEntryDetail.js'
import { readArgumentHint, readRoleFields, setSkillInvocationEnabled, updateFrontmatter } from '../features/personas/frontmatter.js'
import { clientErrorMessage } from './error-message.js'

/** Draft templates per panel kind (bilingual; the user edits from here). */
function draftTemplate(kind: UserPanelKind, t: Translate): string {
  if (kind === 'skills') {
    return ['---', `description: ${t('panelDraftSkillDesc')}`, '---', '', t('panelDraftSkillBody'), ''].join('\n')
  }
  if (kind === 'commands') {
    return ['---', `description: ${t('panelDraftCommandDesc')}`, 'argument-hint: ', '---', '', `${t('panelDraftCommandBody')}: $ARGUMENTS`, ''].join('\n')
  }
  return ['---', `description: ${t('panelDraftPersonaDesc')}`, '---', '', t('panelDraftPersonaBody'), ''].join('\n')
}

type PanelFilter = 'all' | 'disabled' | 'user' | 'plugin'

/** The generic user-panel surface for one panel kind. */
export function UserPanelSurface(props: { t: Translate; kind: UserPanelKind }): ReactNode {
  const { t, kind } = props
  const [entries, setEntries] = useState<UserPanelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PanelFilter>('all')
  const [view, setView] = useWorkspaceView()
  const [editor, setEditor] = useState<PanelEditorState | undefined>(undefined)
  // The document editor shows one view at a time; the switch lives above it.
  const [showPreview, setShowPreview] = useState(false)
  const [confirm, setConfirm] = useState<PanelConfirmState | undefined>(undefined)
  const [detail, setDetail] = useState<UserPanelEntry | undefined>(undefined)
  // Latest-wins guard: overlapping mutations re-read the list, and a slow
  // earlier response must never overwrite a newer one's result.
  const refreshSeq = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++refreshSeq.current
    setError(undefined)
    try {
      const data = await fetchUserPanel(kind)
      if (refreshSeq.current === seq) setEntries(data)
    } catch (reason) {
      if (refreshSeq.current === seq) setError(clientErrorMessage(t, reason))
    } finally {
      if (refreshSeq.current === seq) setLoading(false)
    }
  }, [kind])

  useEffect(() => {
    setEntries([])
    setLoading(true)
    setSearch('')
    setFilter('all')
    setEditor(undefined)
    setConfirm(undefined)
    setDetail(undefined)
    void refresh()
    return () => {
      refreshSeq.current++
    }
  }, [refresh])

  /** Mutate with the shared busy spinner + error surface, then re-read. */
  const mutate = useCallback(
    async (work: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true)
      setError(undefined)
      try {
        await work()
        await refresh()
        return true
      } catch (reason) {
        setError(clientErrorMessage(t, reason))
        return false
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  const needle = search.trim().toLowerCase()
  const visible = useMemo(
    () =>
      entries.filter(entry => {
        if ((filter === 'user' || filter === 'plugin') && entry.origin !== filter) return false
        if (filter === 'disabled' && !entry.disabled) return false
        if (needle !== '' && !`${entry.name} ${entry.description} ${entry.suiteName ?? ''} ${entry.path}`.toLowerCase().includes(needle)) return false
        return true
      }),
    [entries, needle, filter]
  )
  const disabledCount = entries.filter(entry => entry.disabled).length

  const openCreate = (): void => {
    setError(undefined)
    setShowPreview(false)
    setEditor({ mode: 'create', name: '', text: draftTemplate(kind, t) })
  }

  const openDetail = (entry: UserPanelEntry): void => {
    setDetail(entry)
  }

  const openEdit = (entry: UserPanelEntry): void => {
    setError(undefined)
    // The server's raw document preserves YAML metadata and Markdown exactly.
    setShowPreview(false)
    setEditor({ mode: 'edit', id: entry.id ?? entry.name, name: entry.name, path: entry.path, text: entry.rawText })
  }

  const toggleDisabled = (entry: UserPanelEntry): void => {
    // A skill is switched through the harness's invocation controls, which
    // every reader of the file honors; commands and personas use the panel's
    // own `disabled` key.
    const text = kind === 'skills' ? setSkillInvocationEnabled(entry.rawText, entry.disabled) : updateFrontmatter(entry.rawText, 'disabled', !entry.disabled)
    void mutate(() => updateUserPanelEntry(kind, entry.id ?? entry.name, text))
  }

  const saveEditor = async (state: PanelEditorState): Promise<boolean> => {
    if (kind === 'agents') {
      const fields = readRoleFields(state.text)
      if (fields.provider !== '' && (fields.model === '' || fields.model === 'inherit')) {
        setError(t('personaSelectModel'))
        return false
      }
    }
    if (state.mode === 'create') {
      const ok = await mutate(() => createUserPanelEntry(kind, state.name, state.text))
      if (ok) setEditor(undefined)
      return ok
    }
    const ok = await mutate(() => updateUserPanelEntry(kind, state.id ?? state.name, state.text))
    if (ok) setEditor(undefined)
    return ok
  }

  const openDelete = (entry: UserPanelEntry): void => {
    setConfirm({
      title: t('panelDeleteTitle', { name: entry.name }),
      description: t('panelDeleteDesc', { path: entry.path }),
      onConfirm: async () => {
        await mutate(() => deleteUserPanelEntry(kind, entry.id ?? entry.name))
      }
    })
  }

  const panelTitle = kind === 'skills' ? t('workspaceTabSkills') : kind === 'commands' ? t('workspaceTabCommands') : t('workspaceTabPersonas')
  const panelDescription = kind === 'skills' ? t('skillsPanelDescription') : kind === 'commands' ? t('commandsPanelDescription') : t('personasPanelDescription')

  return h(
    'div',
    { className: css.shell },
    h(PanelHeader, { title: panelTitle, subtitle: panelDescription, actions: h(PanelActions, { addLabel: t('panelAdd'), onAdd: openCreate, refreshLabel: t('refresh'), onRefresh: () => { void refresh() }, busy }) }),
    error === undefined ? null : h('div', { className: css.editorError }, error),
    busy ? h(BusyIndicator, { overlay: true, label: t('panelWorking') }) : null,
    h(SearchFilterToolbar, {
      search,
      searchLabel: t('panelSearchLabel'),
      searchPlaceholder: t('panelSearchLabel'),
      onSearchChange: setSearch,
      filters: [
        { id: 'all', label: t('panelFilterAll'), count: entries.length, active: filter === 'all', onSelect: () => setFilter('all') },
        ...(['user', 'plugin'] as const).map(origin => ({
          id: origin,
          label: t(origin === 'user' ? 'panelSourceUser' : 'panelSourcePlugin'),
          count: entries.filter(entry => entry.origin === origin).length,
          active: filter === origin,
          onSelect: () => setFilter(origin)
        })),
        { id: 'disabled', label: t('panelFilterDisabled'), count: disabledCount, active: filter === 'disabled', onSelect: () => setFilter('disabled') }
      ],
      view,
      toListLabel: t('switchToList'),
      toGridLabel: t('switchToGrid'),
      onViewChange: nextView => setView(nextView),
    }),
    h(
      'div',
      { className: css.body },
      loading && entries.length === 0
        ? h('div', { className: css.empty }, t('loading'))
        : visible.length === 0
          ? h('div', { className: css.empty }, t('panelEmpty'))
          : h(
              ResourceCollection,
              { view },
              visible.map(entry =>
                h(UserEntryRow, {
                  key: entry.id ?? entry.name,
                  entry,
                  t,
                  kind,
                  busy,
                  onOpen: () => openDetail(entry),
                  onEdit: () => openEdit(entry),
                  onToggle: () => toggleDisabled(entry),
                  onDelete: () => openDelete(entry)
                })
              )
            )
    ),
    h(EntryEditorModal, {
      t,
      open: editor !== undefined,
      state: editor,
      title:
        editor?.mode === 'create'
          ? t(kind === 'skills' ? 'panelAddSkillTitle' : kind === 'commands' ? 'panelAddCommandTitle' : 'panelAddPersonaTitle')
          : editor?.name ?? t(kind === 'skills' ? 'panelEditSkillTitle' : kind === 'commands' ? 'panelEditCommandTitle' : 'panelEditPersonaTitle'),
      modeControl: h(
        'div',
        { className: formCss.seg },
        h('button', { type: 'button', 'aria-pressed': !showPreview, onClick: () => setShowPreview(false) }, t('detailMarkdown')),
        h('button', { type: 'button', 'aria-pressed': showPreview, onClick: () => setShowPreview(true) }, t('detailPreview'))
      ),
      showPreview,
      nameLabel: t('panelNamePh'),
      namePlaceholder: t(kind === 'skills' ? 'editorNamePhSkill' : kind === 'commands' ? 'editorNamePhCommand' : 'editorNamePhPersona'),
      textLabel: t(kind === 'skills' ? 'panelSkillTextLabel' : kind === 'commands' ? 'panelCommandTextLabel' : 'panelPersonaTextLabel'),
      footerHint: t(editor?.mode === 'create' ? 'editorFooterCreate' : 'editorFooterEdit'),
      busy,
      saveError: error,
      saveLabel: editor?.mode === 'create' ? t('editorCreate') : t('panelSave'),
      cancelLabel: t('cancel'),
      // A command's argument hint is frontmatter, so it pairs with the name on
      // the create row and edits the same document the textarea shows.
      ...(kind === 'commands'
        ? {
            renderNamePairField: (text: string, onChange: (text: string) => void) =>
              h(
                'label',
                { className: formCss.field },
                h('span', null, t('commandArgumentHint')),
                h('input', {
                  value: readArgumentHint(text),
                  placeholder: '[--force]',
                  disabled: busy,
                  'aria-label': t('commandArgumentHint'),
                  onChange: (event: { target: HTMLInputElement }) => onChange(updateFrontmatter(text, 'argument-hint', event.target.value))
                })
              )
          }
        : {}),
      renderFields: kind === 'agents' ? (text, onChange) => h(RoleMetadataFields, { text, onChange, t, disabled: busy }) : undefined,
      onClose: () => setEditor(undefined),
      onSave: saveEditor
    }),
    detail === undefined ? null : h(UserEntryDetailModal, { t, kind, entry: detail, onClose: () => setDetail(undefined) }),
    h(ConfirmModal, {
      state: confirm,
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      busy,
      onClose: () => setConfirm(undefined)
    })
  )
}

/**
 * One entry card: identity (name, provenance, disabled state) with the action
 * cluster on its trailing edge, a full-width description, and the provenance
 * row. Opening the card shows the entry's document; the pencil edits it.
 */
function UserEntryRow(props: {
  entry: UserPanelEntry
  t: Translate
  kind: UserPanelKind
  busy: boolean
  onOpen: () => void
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}): ReactNode {
  const { entry, t } = props
  // A command registers under its flattened call name, so the card shows that.
  const title = props.kind === 'commands' ? `/${commandCallName(entry.name)}` : entry.name
  const mono = props.kind === 'commands'
  // A rejected document cannot be switched on: its state is recomputed from the
  // document, so the fix is editing the document.
  const locked = props.busy || entry.metadata['validationError'] !== undefined
  const stop = (callback: () => void) => (event: { stopPropagation(): void }) => {
    event.stopPropagation()
    callback()
  }
  const interactive = {
    role: 'button' as const,
    tabIndex: 0,
    onClick: props.onOpen,
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      props.onOpen()
    }
  }
  return h(
    ResourceCard,
    { state: entry.disabled ? 'disabled' : 'active', surface: props.kind === 'agents' ? 'personas' : props.kind, ...interactive },
    h(
      'div',
      { className: rc.rowId },
      h('span', { className: mono ? `${rc.name} ${rc.nameMono}` : rc.name }, title),
      h(Tag, { tone: 'neutral' }, entry.origin === 'user' ? t('panelSourceUser') : t('panelSourcePlugin'))
    ),
    h(
      'div',
      { className: rc.rowActions },
      h(
        'button',
        { type: 'button', className: `${rc.iconBtn} ${rc.revealOnHover}`, 'aria-label': t('panelEditTitle'), disabled: props.busy, title: t('panelEditTitle'), onClick: stop(props.onEdit) },
        h(IconEditOutline16)
      ),
      h(
        'button',
        {
          type: 'button',
          className: `${rc.iconBtn} ${rc.iconBtnDanger} ${rc.revealOnHover}`,
          'aria-label': t('panelDelete'),
          disabled: props.busy,
          title: t('panelDelete'),
          onClick: stop(props.onDelete)
        },
        h(IconTrashOutline16)
      ),
      h(
        'span',
        { className: rc.switchWrap, onClick: (event: { stopPropagation(): void }) => event.stopPropagation() },
        h(Switch, {
          checked: !entry.disabled,
          disabled: locked,
          label: entry.disabled ? t('enable') : t('disable'),
          title: entry.disabled ? t('enable') : t('disable'),
          onChange: props.onToggle
        })
      )
    ),
    entry.description === '' ? null : h('p', { className: `${rc.rowBody} ${rc.desc}` }, entry.description),
    h(
      'div',
      { className: rc.rowFoot },
      // The source row names where the entry comes from: the owning suite for a
      // plugin-provided file, the file's own location for a user-authored one.
      h(
        'span',
        { className: rc.provenance, title: entry.suiteName ?? entry.path },
        entry.origin === 'plugin' && entry.suiteName !== undefined ? entry.suiteName : entry.path
      )
    )
  )
}
