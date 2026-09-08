/**
 * The generic user-panel surface: search, state filter, grid/list toggle,
 * and full CRUD over one user panel directory. The skills / commands /
 * agent-personas panels mount this component with their own kind and copy —
 * one implementation, three surfaces, identical interaction language.
 * @module client/ui/UserPanelSurface
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconEditOutline16, IconTrashOutline16, IconPauseOutline16, IconPlayOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { createUserPanelEntry, deleteUserPanelEntry, fetchUserPanel, updateUserPanelEntry, type UserPanelEntry, type UserPanelKind } from '../api.js'
import type { Translate } from '../index.js'
import { SearchFilterToolbar, type SearchFilterToolbarView } from '../SearchFilterToolbar.js'
import { PanelHeader, BusyIndicator, ConfirmModal, EntryEditorModal, SourceBadge, type PanelConfirmState, type PanelEditorState } from './panel.js'
import css from './panel.module.css'
import { RoleMetadataFields } from '../features/personas/RoleMetadataFields.js'
import { readRoleFields, updateFrontmatter } from '../features/personas/frontmatter.js'

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
export function UserPanelSurface(props: {
  t: Translate
  kind: UserPanelKind
  /** The "quick reply" hint line, only rendered for commands. */
  hint?: string
}): ReactNode {
  const { t, kind } = props
  const [entries, setEntries] = useState<UserPanelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PanelFilter>('all')
  const [view, setView] = useState<SearchFilterToolbarView>('list')
  const [editor, setEditor] = useState<PanelEditorState | undefined>(undefined)
  const [confirm, setConfirm] = useState<PanelConfirmState | undefined>(undefined)
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
      if (refreshSeq.current === seq) setError(reason instanceof Error ? reason.message : String(reason))
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
        setError(reason instanceof Error ? reason.message : String(reason))
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
    setEditor({ mode: 'create', name: '', text: draftTemplate(kind, t) })
  }

  const openEdit = (entry: UserPanelEntry): void => {
    setError(undefined)
    // The server's raw document preserves YAML metadata and Markdown exactly.
    setEditor({ mode: 'edit', id: entry.id ?? entry.name, name: entry.name, path: entry.path, text: entry.rawText })
  }

  const toggleDisabled = (entry: UserPanelEntry): void => {
    void mutate(() => updateUserPanelEntry(kind, entry.id ?? entry.name, updateFrontmatter(entry.rawText, 'disabled', !entry.disabled)))
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
    h(PanelHeader, { title: panelTitle, subtitle: panelDescription }),
    error === undefined ? null : h('div', { className: css.editorError }, error),
    busy ? h(BusyIndicator, { overlay: true, label: t('panelWorking') }) : null,
    h(SearchFilterToolbar, {
      search,
      searchLabel: t('panelSearchLabel'),
      searchPlaceholder: t('panelSearchLabel'),
      onSearchChange: setSearch,
      filters: [
        { id: 'all', label: t('panelFilterAll'), count: entries.length, icon: null, active: filter === 'all', onSelect: () => setFilter('all') },
        ...(['user', 'plugin'] as const).map(origin => ({
          id: origin,
          label: t(origin === 'user' ? 'panelSourceUser' : 'panelSourcePlugin'),
          count: entries.filter(entry => entry.origin === origin).length,
          icon: null,
          active: filter === origin,
          onSelect: () => setFilter(origin)
        })),
        { id: 'disabled', label: t('panelFilterDisabled'), count: disabledCount, icon: null, active: filter === 'disabled', onSelect: () => setFilter('disabled') }
      ],
      view,
      gridLabel: t('grid'),
      listLabel: t('list'),
      onViewChange: nextView => setView(nextView),
      extraAction: { label: t('panelAdd'), title: t('panelAdd'), onSelect: openCreate }
    }),
    h(
      'div',
      { className: css.body },
      loading && entries.length === 0
        ? h('div', { className: css.empty }, t('loading'))
        : visible.length === 0
          ? h('div', { className: css.empty }, t('panelEmpty'))
          : h(
              'div',
              { className: view === 'grid' ? css.entryGrid : css.entryList },
              visible.map(entry =>
                h(UserEntryRow, {
                  key: entry.id ?? entry.name,
                  entry,
                  t,
                  compact: view === 'grid',
                  kind,
                  busy,
                  onEdit: () => openEdit(entry),
                  onToggle: () => toggleDisabled(entry),
                  onDelete: () => openDelete(entry)
                })
              )
            ),
      props.hint === undefined ? null : h('p', { className: css.editorHint }, props.hint)
    ),
    h(EntryEditorModal, {
      open: editor !== undefined,
      state: editor,
      title: editor?.mode === 'create' ? t('panelAddTitle') : t('panelEditTitle'),
      nameLabel: t('panelNamePh'),
      textLabel: t('panelTextPh'),
      busy,
      saveError: error,
      saveLabel: t('panelSave'),
      cancelLabel: t('cancel'),
      renderFields: kind === 'agents' ? (text, onChange) => h(RoleMetadataFields, { text, onChange, t, disabled: busy }) : undefined,
      onClose: () => setEditor(undefined),
      onSave: saveEditor
    }),
    h(ConfirmModal, {
      state: confirm,
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      busy,
      onClose: () => setConfirm(undefined)
    })
  )
}

/** One entry row: name, source badge, description, path, and row actions. */
function UserEntryRow(props: {
  entry: UserPanelEntry
  t: Translate
  compact: boolean
  kind: UserPanelKind
  busy: boolean
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}): ReactNode {
  const { entry, t } = props
  const metaPairs = Object.entries(entry.metadata).filter(([key]) => key !== 'description' && key !== 'disabled')
  return h(
    'div',
    { className: `${css.entryRow} ${entry.disabled ? css.entryRowDisabled : ''}` },
    h(
      'div',
      { className: css.entryMain },
      h(
        'div',
        { className: css.entryHead },
        h('button', { type: 'button', className: css.entryName, onClick: props.onEdit, title: t('panelDetails') }, props.kind === 'commands' ? `/${entry.name}` : entry.name),
        h(SourceBadge, {
          kind: entry.origin,
          label: entry.origin === 'user' ? t('panelSourceUser') : `${t('panelSourcePlugin')}${entry.suiteName ? ` · ${entry.suiteName}` : ''}`,
          detail: entry.path
        }),
        entry.disabled ? h('span', { className: css.editorPath }, t('panelDisabledBadge')) : null
      ),
      entry.description === '' ? null : h('p', { className: css.entryDesc }, entry.description),
      h('span', { className: css.entryPath }, entry.path),
      metaPairs.length === 0 || props.compact
        ? null
        : h('span', { className: css.entryPath }, metaPairs.map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' · '))
    ),
    h(
      'div',
      { className: css.entryActions },
      h('button', { type: 'button', className: css.iconBtn, 'aria-label': t('panelEditTitle'), disabled: props.busy, title: t('panelEditTitle'), onClick: props.onEdit }, h(IconEditOutline16)),
      h(
        'button',
        {
          type: 'button',
          className: css.iconBtn,
          'aria-label': entry.disabled ? t('enable') : t('disable'),
          disabled: props.busy,
          title: entry.disabled ? t('enable') : t('disable'),
          onClick: props.onToggle
        },
        h(entry.disabled ? IconPlayOutline16 : IconPauseOutline16)
      ),
      h(
        'button',
        {
          type: 'button',
          className: `${css.iconBtn} ${css.iconBtnDanger}`,
          'aria-label': t('panelDelete'),
          disabled: props.busy,
          title: t('panelDelete'),
          onClick: props.onDelete
        },
        h(IconTrashOutline16)
      )
    )
  )
}
