/**
 * The generic user-panel surface: search, state filter, grid/list toggle,
 * and full CRUD over one user panel directory. The skills / commands /
 * agent-personas panels mount this component with their own kind and copy —
 * one implementation, three surfaces, identical interaction language.
 * @module client/ui/UserPanelSurface
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconEditOutlineMedium, IconTrashOutlineMedium, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { createUserPanelEntry, deleteUserPanelEntry, fetchUserPanelEntry, updateUserPanelEntry, type UserPanelEntry, type UserPanelKind } from '../api.js'
import { cachedUserPanel, loadUserPanel } from './user-panel-resource.js'
import { commandCallName } from '../../../market-contracts/src/model/command-names.js'
import type { Translate } from '../i18n.js'
import { SearchFilterToolbar } from './SearchFilterToolbar.js'
import { CardIdentity, ResourceCard, ResourceCollection } from './ResourceCard.js'
import { useDisplayText } from './translated-text.js'
import { hintProps, hoverHint } from './hover-hint.js'
import { BilingualToggle } from './BilingualToggle.js'
import { useTranslationRefresh } from './translation-enabled.js'
import { useWorkspaceView } from './workspace-view.js'
import { pollUntilTranslated } from './translation-settle.js'
import { PanelActions, PanelHeader, BusyIndicator, ConfirmModal, EntryEditorModal, type PanelConfirmState, type PanelEditorState } from './panel.js'
import css from './panel.module.css'
import formCss from './form.module.css'
import rc from './resource-card.module.css'
import { RoleMetadataFields } from './RoleMetadataFields.js'
import { UserEntryDetailModal } from './UserEntryDetail.js'
import { readArgumentHint, readRoleFields, setSkillInvocationEnabled, updateFrontmatter } from './frontmatter.js'
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
  // The filter tablist names the body below; the host derives its panel id from
  // the same base the toolbar receives, and the kind keeps panels apart.
  const filterId = `${kind}-panel-filter`
  const [view, setView] = useWorkspaceView()
  const [editor, setEditor] = useState<PanelEditorState | undefined>(undefined)
  // The document editor shows one view at a time; the switch lives above it.
  const [showPreview, setShowPreview] = useState(false)
  const [confirm, setConfirm] = useState<PanelConfirmState | undefined>(undefined)
  const [detail, setDetail] = useState<UserPanelEntry | undefined>(undefined)
  // One reading mode for the whole panel: the switch lifts to this surface so a
  // single click re-reads every card and the detail dialog under it.
  const [showOriginal, setShowOriginal] = useState(false)
  const language = t('localeProbeLang')
  const languageRef = useRef(language)
  languageRef.current = language
  const [entriesLanguage, setEntriesLanguage] = useState<string | undefined>()
  // Latest-wins guard: overlapping mutations re-read the list, and a slow
  // earlier response must never overwrite a newer one's result.
  const refreshSeq = useRef(0)

  // One settle poll at a time: every read restarts it, and the effect's cleanup
  // stops the previous one so an unmounted panel never keeps polling.
  const settle = useRef<{ stop: () => void } | undefined>(undefined)

  /**
   * Re-read the panel.
   *
   * `force` is the Refresh button: an ordinary read may be answered from the
   * host's row cache, and a user pressing Refresh is asking for the working
   * tree as it stands. The settle poll below never forces — it runs every
   * 1.5 s and the cache is what keeps it cheap.
   *
   * Rows the last visit cached are already on screen; this read replaces them
   * when it lands, so a revisit never waits behind a spinner for its own paint.
   */
  const refresh = useCallback(
    async (force = false): Promise<void> => {
      const seq = ++refreshSeq.current
      const requestedLanguage = languageRef.current
      setError(undefined)
      settle.current?.stop()
      settle.current = undefined
      try {
        const data = await loadUserPanel(kind, force)
        if (refreshSeq.current !== seq || languageRef.current !== requestedLanguage) return
        setEntriesLanguage(requestedLanguage)
        setEntries(data.entries)
        setDetail(current => (current === undefined ? undefined : (data.entries.find(entry => (entry.id ?? entry.name) === (current.id ?? current.name)) ?? current)))
        // The host translates off the read path, so the first read carries the
        // authored text and a count. Polling until that count clears is what swaps
        // the translated text in without the user pressing refresh.
        if (data.translationPending > 0) {
          settle.current = pollUntilTranslated({
            read: async () => {
              const next = await loadUserPanel(kind)
              return { value: next.entries, pending: next.translationPending }
            },
            report: entriesNow => {
              if (refreshSeq.current !== seq || languageRef.current !== requestedLanguage) return
              setEntries(entriesNow)
              setDetail(current => (current === undefined ? undefined : (entriesNow.find(entry => (entry.id ?? entry.name) === (current.id ?? current.name)) ?? current)))
            },
            isStopped: () => refreshSeq.current !== seq || languageRef.current !== requestedLanguage
          })
        }
      } catch (reason) {
        if (refreshSeq.current === seq) setError(clientErrorMessage(t, reason))
      } finally {
        if (refreshSeq.current === seq) setLoading(false)
      }
    },
    [kind]
  )

  useTranslationRefresh(t, refresh)

  useEffect(() => {
    // A revisit paints the rows the last read cached and revalidates behind
    // them; only a panel that has never read anything has nothing to show.
    const cached = cachedUserPanel(kind)
    setEntries(cached ?? [])
    setLoading(cached === undefined)
    setSearch('')
    setFilter('all')
    setEditor(undefined)
    setConfirm(undefined)
    setDetail(undefined)
    void refresh()
    return () => {
      refreshSeq.current++
      settle.current?.stop()
      settle.current = undefined
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

  /**
   * Open one entry's editor.
   *
   * The list read carries no document, so the editor seeds from the entry route
   * — the only read that ships the file's own text, which the save then diffs
   * against. The panel shows its working state while that read is in flight.
   */
  const openEdit = (entry: UserPanelEntry): void => {
    // Plugin documents are the suite's, except an agent persona's model
    // routing: the server accepts exactly that frontmatter diff, so this
    // surface opens the structured controls without the Markdown editor.
    // Plugin skills/commands have no routing controls and stay guarded.
    const routingEditable = entry.origin === 'plugin' && kind === 'agents'
    if (entry.origin !== 'user' && !routingEditable) return
    setError(undefined)
    setBusy(true)
    void (async () => {
      try {
        // The server's raw document preserves YAML metadata and Markdown exactly.
        const document = await fetchUserPanelEntry(kind, entry.id ?? entry.name)
        setShowPreview(false)
        setEditor({
          mode: 'edit',
          id: entry.id ?? entry.name,
          name: entry.name,
          path: entry.path,
          text: document.rawText,
          ...(routingEditable ? { routingOnly: true } : {})
        })
      } catch (reason) {
        setError(clientErrorMessage(t, reason))
      } finally {
        setBusy(false)
      }
    })()
  }

  /**
   * Flip one entry's enable state.
   *
   * The rewrite is a frontmatter diff, so it needs the document: the list read
   * omits it, and the toggle fetches the entry before it writes.
   */
  const toggleDisabled = (entry: UserPanelEntry): void => {
    void mutate(async () => {
      const document = await fetchUserPanelEntry(kind, entry.id ?? entry.name)
      // A skill is switched through the harness's invocation controls, which
      // every reader of the file honors; commands and personas use the panel's
      // own `disabled` key.
      const text = kind === 'skills' ? setSkillInvocationEnabled(document.rawText, entry.disabled) : updateFrontmatter(document.rawText, 'disabled', !entry.disabled)
      await updateUserPanelEntry(kind, entry.id ?? entry.name, text)
    })
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
    // The tab row already names this panel; the description is the part that
    // says something the tab does not.
    h(PanelHeader, {
      subtitle: panelDescription,
      // Refresh is the one read that forces: it is the user asking for the
      // working tree as it stands, not a poll.
      actions: h(PanelActions, {
        addLabel: t('panelAdd'),
        onAdd: openCreate,
        refreshLabel: t('refresh'),
        onRefresh: () => {
          void refresh(true)
        },
        busy
      })
    }),
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
      filterId,
      // The panel header's title names the filter segment for assistive tech.
      filterLabel: panelTitle,
      view,
      toListLabel: t('switchToList'),
      toGridLabel: t('switchToGrid'),
      onViewChange: nextView => setView(nextView),
      beforeView: h(BilingualToggle, { t, showOriginal, onToggle: () => setShowOriginal(current => !current) })
    }),
    h(
      'div',
      {
        className: css.body,
        role: 'tabpanel',
        id: `${filterId}-${filter}-panel`,
        'aria-labelledby': `${filterId}-${filter}`
      },
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
                  showOriginal: showOriginal || entriesLanguage !== language,
                  onOpen: () => openDetail(entry),
                  // The pencil on a plugin persona edits routing only; the document stays
                  // the suite's, so plugin skills/commands carry no edit affordance.
                  onEdit: entry.origin === 'user' || (entry.origin === 'plugin' && kind === 'agents') ? () => openEdit(entry) : undefined,
                  onToggle: () => toggleDisabled(entry),
                  onDelete: entry.origin === 'user' ? () => openDelete(entry) : undefined
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
          : (editor?.name ?? t(kind === 'skills' ? 'panelEditSkillTitle' : kind === 'commands' ? 'panelEditCommandTitle' : 'panelEditPersonaTitle')),
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
      footerHint: t(editor?.mode === 'create' ? 'editorFooterCreate' : editor?.routingOnly === true ? 'editorFooterRouting' : 'editorFooterEdit'),
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
    detail === undefined
      ? null
      : h(UserEntryDetailModal, {
          t,
          kind,
          entry: detail,
          showOriginal: showOriginal || entriesLanguage !== language,
          onClose: () => setDetail(undefined)
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
  /** Panel-wide text view: the authored text instead of the translation. */
  showOriginal: boolean
  onOpen: () => void
  onEdit?: () => void
  onToggle: () => void
  onDelete?: () => void
}): ReactNode {
  const { entry, t } = props
  // A command registers under its flattened call name and every other kind under
  // its own name: a name is never translated — it is the identity the user types,
  // searches and sorts by.
  const title = props.kind === 'commands' ? commandCallName(entry.name) : entry.name
  const description = useDisplayText(entry.translatedDescription, entry.description, t, { original: props.showOriginal })
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
    h(CardIdentity, { text: title, hint: entry.name, mono, tag: entry.origin === 'user' ? t('panelSourceUser') : t('panelSourcePlugin') }),
    h(
      'div',
      { className: rc.rowActions },
      props.onEdit === undefined
        ? null
        : h(
            'button',
            {
              type: 'button',
              className: `${rc.iconBtn} ${rc.revealOnHover}`,
              'aria-label': t('panelEditTitle'),
              disabled: props.busy,
              title: t('panelEditTitle'),
              onClick: stop(props.onEdit)
            },
            h(IconEditOutlineMedium)
          ),
      props.onDelete === undefined
        ? null
        : h(
            'button',
            {
              type: 'button',
              className: `${rc.iconBtn} ${rc.iconBtnDanger} ${rc.revealOnHover}`,
              'aria-label': t('panelDelete'),
              disabled: props.busy,
              title: t('panelDelete'),
              onClick: stop(props.onDelete)
            },
            h(IconTrashOutlineMedium)
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
    // Two lines fit; anything longer stays readable through the hint.
    description === undefined || description === '' ? null : hoverHint(description, h('p', hintProps({ className: `${rc.rowBody} ${rc.desc}` }), description)),
    h(
      'div',
      { className: rc.rowFoot },
      // The source row names where the entry comes from: the owning suite for a
      // plugin-provided file, the file's own location for a user-authored one.
      hoverHint(
        entry.suiteName ?? entry.path,
        h('span', hintProps({ className: rc.provenance }), entry.origin === 'plugin' && entry.suiteName !== undefined ? entry.suiteName : entry.path)
      )
    )
  )
}
