/**
 * The project resource window.
 *
 * One Modal over the six switchable surfaces, listing only what this workspace
 * has installed. Every control is a host or shared primitive — the tab row,
 * the shared SearchFilterToolbar, the favorites riding the market's source
 * strip (ui/SourceTabsRow), the toasts — and the rows carry the settings
 * page's full card anatomy: the provenance tag in the identity row, the view
 * and enable cluster on its trailing edge (view first, the switch last), and
 * the source line plus counts in the foot. The card itself stays the entry
 * toggle (a role=button carrying aria-pressed): the window is the settings
 * page's user-level capability set as a fast-switch surface — toggling and
 * viewing, no editing writes. Switching tabs never closes the window;
 * flipping an entry reconciles through the same chain the composer switches
 * use, so the row state is live, not cosmetic.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, IconInspectOutlineMedium, Input, Modal, SegmentedTabs, Switch, Tag, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import { RESOURCE_FACE_ORDER, type ResourceEntryWire, type ResourceFace } from '../../../contracts/resource-window.js'
import { applyResourceFavorite, deleteResourceFavorite, fetchResourceWindow, saveResourceFavorite, setResourceEntry } from './resource-window-resource.js'
import type { ResourceWindowData } from './resource-window-resource.js'
import type { ResourceLocaleKey } from '../../locales-resources.js'
import type { Translate } from '../../index.js'
import { interactiveCardProps, ResourceCard, ResourceCollection } from '../../ui/ResourceCard.js'
import { SourceTabsRow, type SourceTabItem } from '../../ui/SourceTabsRow.js'
import { SearchFilterToolbar, type SearchFilterToolbarView } from '../../ui/SearchFilterToolbar.js'
import panelCss from '../../ui/panel.module.css'
import rc from '../../ui/resource-card.module.css'
import css from './resource-window.module.css'

/** The window's translator: the resource dictionary keys, params like the host's. */
export type ResourceTranslate = (key: ResourceLocaleKey, params?: Record<string, unknown>) => string

/** The merged namespace serves the main dictionary too (index.ts registers
 * both under the one namespace), so the face tabs read the settings page's
 * exact words through this widened view of the translator — widened here
 * only, keeping every resource-key call site checked. */
type WideTranslate = (key: string, params?: Record<string, unknown>) => string

/** The settings workspace's tab ids — the deep link's segment per face. */
type WorkspaceTab = 'market' | 'skills' | 'commands' | 'personas' | 'mcp' | 'lsp'

const TAB_ID = 'agent-plugins-resource-tab'
const FILTER_ID = 'agent-plugins-resource-filter'
/** The strip's state chip: active while no favorite applies. */
const FOLLOW_GLOBAL_ID = 'follow-global'

// The settings panel's activation channel and its panel name: the same
// literals page-mode.tsx dispatches to lift the market panel in page mode.
// Repeated here instead of imported so the window (features/) and the
// page-mode bootstrap (workspace/) stay decoupled; renaming the channel means
// renaming it in both files in one change.
const PANEL_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'agent-plugins-market'

/** The entry filter rides the shared toolbar's segment: every entry, mounted, or filtered out. */
type EntryFilter = 'all' | 'on' | 'off'

/** One toast in flight; the key restarts the cycle when a new one lands. */
interface ToastState {
  key: number
  message: string
}

export interface ResourceWindowProps {
  t: ResourceTranslate
  open: boolean
  onClose: () => void
  /** Open the entry's settings-page surface; the window's own default closes
   * and deep-links, so callers may omit it. */
  onView?: (face: ResourceFace, entryId: string) => void
}

export function ResourceWindow({ t, open, onClose, onView }: ResourceWindowProps): ReactNode {
  const [data, setData] = useState<ResourceWindowData | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [face, setFace] = useState<ResourceFace>('skills')
  const [view, setView] = useState<SearchFilterToolbarView>('grid')
  const [entryFilter, setEntryFilter] = useState<EntryFilter>('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<ToastState | undefined>(undefined)
  const [naming, setNaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const toastSeq = useRef(0)

  /** One inventory fetch; `alive` lets the caller scope the state writes. */
  const load = useCallback((alive: () => boolean): Promise<void> => {
    setFailed(false)
    return fetchResourceWindow()
      .then(window => {
        if (alive()) setData(window)
      })
      .catch(() => {
        if (alive()) setFailed(true)
      })
  }, [])

  // Opening reads the inventory every time; no separate refresh control.
  useEffect(() => {
    if (!open) return
    let alive = true
    void load(() => alive)
    return () => {
      alive = false
    }
  }, [open, load])

  const flash = useCallback((message: string) => {
    toastSeq.current += 1
    setToast({ key: toastSeq.current, message })
  }, [])

  /** Run one window mutation, keeping the busy lock and surfacing failures. */
  const mutate = useCallback(
    async (run: () => Promise<ResourceWindowData>): Promise<void> => {
      setBusy(true)
      try {
        setData(await run())
      } catch {
        // Reads stay authoritative: a failed write leaves the last good window.
      } finally {
        setBusy(false)
      }
    },
    []
  )

  /**
   * One quick entry toggle: the flip paints at once (the switch is the user's
   * own action — waiting a full reconcile round-trip to show it reads as a
   * hang), the write rides in the background, and the authoritative payload
   * replaces the optimistic rows when the reconcile finishes. A failure rolls
   * the row back; rapid flips compose because each write carries its own ids.
   */
  const toggleEntry = useCallback((target: ResourceEntryWire, enabled: boolean): void => {
    setData(current =>
      current === undefined
        ? current
        : {
            ...current,
            activeFavoriteId: null,
            entries: current.entries.map(entry => (entry.id === target.id ? { ...entry, enabled } : entry))
          }
    )
    void setResourceEntry(target.face, target.id, enabled)
      .then(window => setData(window))
      .catch(() => {
        setData(current =>
          current === undefined
            ? current
            : { ...current, entries: current.entries.map(entry => (entry.id === target.id ? { ...entry, enabled: !enabled } : entry)) }
        )
      })
  }, [])

  const entries = data?.entries ?? []
  const byFace = useMemo(() => {
    const grouped = new Map<ResourceFace, ResourceEntryWire[]>()
    for (const key of RESOURCE_FACE_ORDER) grouped.set(key, [])
    for (const entry of entries) grouped.get(entry.face)?.push(entry)
    return grouped
  }, [entries])

  const faceRows = byFace.get(face) ?? []
  const visible = useMemo(() => {
    const matched = entryFilter === 'all' ? faceRows : faceRows.filter(row => (entryFilter === 'on') === row.enabled)
    const q = query.trim().toLowerCase()
    if (q === '') return matched
    return matched.filter(row => row.name.toLowerCase().includes(q) || (row.description ?? '').toLowerCase().includes(q))
  }, [faceRows, query, entryFilter])

  // The settings page names each face with its own tab word — the main
  // dictionary's workspaceTab* keys, the exact labels PluginWorkspace shows.
  const wt = t as WideTranslate
  const tabs = useMemo(
    () =>
      RESOURCE_FACE_ORDER.map((key): SegmentedTab<ResourceFace> => ({
        value: key,
        label: wt(FACE_LABEL_KEYS[key]),
        id: `${TAB_ID}-${key}`,
        // Every face shows through the one list area, whose id follows the
        // filter segment's `<filterId>-<value>-panel` convention (StatusPanel).
        panelId: `${FILTER_ID}-${entryFilter}-panel`
      })) as [SegmentedTab<ResourceFace>, ...SegmentedTab<ResourceFace>[]],
    [wt, entryFilter]
  )

  // The favorites strip reuses the market's collapsible chip strip, chip
  // order and all: the follow-global state rides the first chip (the market
  // puts `全部` there) and lights while no favorite applies; every saved
  // favorite follows as a chip that applies on click and carries a trailing
  // delete control. Selecting the state chip is a no-op — it is a state, not
  // an action.
  const favoriteItems = useMemo<SourceTabItem[]>(
    () => [
      { id: FOLLOW_GLOBAL_ID, label: t('resourceWindowFollowGlobal') },
      ...(data?.favorites ?? []).map(favorite => ({ id: favorite.id, label: favorite.name, deletable: true }))
    ],
    [t, data?.favorites]
  )
  const selectFavorite = useCallback(
    (id: string) => {
      if (id === FOLLOW_GLOBAL_ID) return
      void mutate(() => applyResourceFavorite(id)).then(() => {
        const favorite = data?.favorites.find(entry => entry.id === id)
        if (favorite !== undefined) flash(t('resourceWindowApplyFavoriteDone', { name: favorite.name }))
      })
    },
    [mutate, data?.favorites, t, flash]
  )
  const deleteFavorite = useCallback(
    (id: string) => {
      void mutate(() => deleteResourceFavorite(id)).then(() => {
        const favorite = data?.favorites.find(entry => entry.id === id)
        if (favorite !== undefined) flash(t('resourceWindowDeleteFavoriteDone', { name: favorite.name }))
      })
    },
    [mutate, data?.favorites, t, flash]
  )

  /** Close the window and land on the entry's settings-page surface. */
  const viewEntry = (viewFace: ResourceFace, viewId: string): void => {
    onClose()
    ;(onView ?? defaultViewDetail)(viewFace, viewId)
  }

  // The filter tablist names this region, and the host derives the active
  // tab's aria-controls from the same base, so the reference always resolves.
  const panelProps = {
    role: 'tabpanel' as const,
    id: `${FILTER_ID}-${entryFilter}-panel`,
    'aria-labelledby': `${FILTER_ID}-${entryFilter}`
  }

  /** Open the naming dialog pre-filled with the next default favorite name. */
  const openNaming = useCallback(() => {
    setNameDraft(t('resourceWindowNameDefault', { n: String((data?.favorites.length ?? 0) + 1) }))
    setNaming(true)
  }, [t, data?.favorites.length])

  return h(
    Modal,
    {
      open,
      onClose,
      title: t('resourceWindowTitle'),
      closeLabel: t('resourceWindowClose'),
      className: css.window,
      contentClassName: css.content
    },
    // Favorites row: the market's source strip — the follow-global chip
    // first, then the saved favorites — and the save button at the tail.
    h(
      'div',
      { className: css.favoritesRow },
      h(SourceTabsRow, {
        // The strip is shared with the market section, whose translator takes
        // the full locale union; the window's t covers the keys the strip
        // renders, so the widening is a property of the shared component.
        t: t as unknown as Translate,
        items: favoriteItems,
        activeId: data?.activeFavoriteId ?? FOLLOW_GLOBAL_ID,
        onSelect: selectFavorite,
        onDelete: deleteFavorite,
        deleteTitle: t('resourceWindowDeleteFavorite')
      }),
      h(
        'button',
        {
          type: 'button',
          className: `${rc.iconBtn} ${css.favoritesSave}`,
          title: t('resourceWindowSaveFavorite'),
          'aria-label': t('resourceWindowSaveFavorite'),
          disabled: busy,
          onClick: openNaming
        },
        h(SaveGlyph)
      )
    ),
    // Six face tabs; switching never closes the window (Modal stays open above).
    h(SegmentedTabs<ResourceFace>, {
      className: css.tabs,
      label: t('resourceWindowTabList'),
      value: face,
      onChange: setFace,
      items: tabs
    }),
    // The shared toolbar: search, the three-state entry filter with counts,
    // and the card/list switch — the five panels' control row verbatim.
    h(SearchFilterToolbar, {
      search: query,
      searchLabel: t('resourceWindowSearchPh'),
      searchPlaceholder: t('resourceWindowSearchPh'),
      onSearchChange: setQuery,
      filters: [
        { id: 'all', label: t('resourceWindowFilterAll'), count: faceRows.length, active: entryFilter === 'all', onSelect: () => setEntryFilter('all') },
        { id: 'on', label: t('resourceWindowFilterOn'), count: faceRows.filter(row => row.enabled).length, active: entryFilter === 'on', onSelect: () => setEntryFilter('on') },
        { id: 'off', label: t('resourceWindowFilterOff'), count: faceRows.filter(row => !row.enabled).length, active: entryFilter === 'off', onSelect: () => setEntryFilter('off') }
      ],
      filterId: FILTER_ID,
      filterLabel: t('resourceWindowTabList'),
      view,
      toListLabel: t('resourceWindowViewList'),
      toGridLabel: t('resourceWindowViewCard'),
      onViewChange: setView
    }),
    // The list. Only the active face renders, through the shared
    // ResourceCollection — the window's card view is the anatomy's grid view,
    // its list view the anatomy's list. Loading and failure take the shared
    // panel's empty state.
    failed
      ? h('div', { className: panelCss.empty, ...panelProps }, t('resourceWindowLoadFailed'))
      : data === undefined
        ? h('div', { className: panelCss.empty, ...panelProps }, t('resourceWindowLoading'))
        : visible.length === 0
          ? h('div', { className: panelCss.empty, ...panelProps }, t('resourceWindowEmpty'))
          : h(
              ResourceCollection,
              { view, ...panelProps, className: css.list },
              visible.map(entry =>
                h(ResourceRow, {
                  key: entry.id,
                  entry,
                  t,
                  onToggle: enabled => toggleEntry(entry, enabled),
                  onView: () => viewEntry(entry.face, entry.id)
                })
              )
            ),
    naming
      ? h(Modal, {
          open: true,
          onClose: () => setNaming(false),
          title: t('resourceWindowNameDialogTitle'),
          closeLabel: t('resourceWindowNameDialogCancel'),
          description: t('resourceWindowNameDialogHint'),
          footer: h(
            'div',
            { className: panelCss.editorFooter },
            h(Button, { variant: 'outline', onClick: () => setNaming(false) }, t('resourceWindowNameDialogCancel')),
            h(
              Button,
              {
                variant: 'primary',
                disabled: nameDraft.trim() === '',
                onClick: () => {
                  const name = nameDraft.trim()
                  if (name === '') return
                  setNaming(false)
                  void mutate(() => saveResourceFavorite(name).then(answer => answer.window)).then(() => flash(t('resourceWindowSaveFavoriteDone', { name })))
                }
              },
              t('resourceWindowNameDialogConfirm')
            )
          ),
          children: h(Input, {
            className: css.nameField,
            value: nameDraft,
            placeholder: t('resourceWindowNameDialogToken'),
            'aria-label': t('resourceWindowNameDialogToken'),
            onChange: event => setNameDraft(event.currentTarget.value)
          })
        })
      : null,
    toast === undefined ? null : h(Toast, { key: toast.key, text: toast.message, tone: 'success', onDone: () => setToast(undefined) })
  )
}

/**
 * The save-favorite glyph: a hollow bookmark outline. The host icon set has no
 * bookmark or save glyph, so it stays drawn here in the platform's outline
 * paint — the same 16-grid, currentColor, medium-weight stroke the shared
 * toolbar's view glyphs use.
 */
function SaveGlyph(): ReactNode {
  return h(
    'svg',
    {
      width: 16,
      height: 16,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 1.3,
      'aria-hidden': true
    },
    h('path', { d: 'M4.5 2.5h7a.5.5 0 01.5.5v10.2l-4-2.3-4 2.3V3a.5.5 0 01.5-.5z' })
  )
}

/**
 * One inventory row in either view, the settings page's SuiteCard anatomy:
 * identity row (name, version, provenance tag) with the action cluster on its
 * trailing edge — view details first, the enable switch last — a full-width
 * description, and a foot carrying the source line and the counts. The card
 * itself doubles as the toggle — a role=button carrying aria-pressed, pressed
 * while the entry mounts; the cluster's controls keep their clicks (and key
 * presses) off the card.
 */
function ResourceRow(props: { entry: ResourceEntryWire; t: ResourceTranslate; onToggle: (enabled: boolean) => void; onView: () => void }): ReactNode {
  const { entry, t } = props
  const on = entry.enabled
  const counts = entry.counts ?? []
  const stop = (callback: () => void) => (event: { stopPropagation(): void }) => {
    event.stopPropagation()
    callback()
  }
  // The card doubles as the quick toggle — except for a globally disabled
  // entry, where the toggle would silently do nothing: the user level owns
  // that switch, and this surface can only filter further.
  const quickToggle = (): void => {
    if (entry.globalDisabled === true) return
    props.onToggle(!on)
  }
  return h(
    ResourceCard,
    {
      state: on ? 'active' : 'disabled',
      surface: entry.face === 'agents' ? 'personas' : entry.face,
      ...interactiveCardProps(quickToggle),
      'aria-label':
        entry.globalDisabled === true ? t('resourceWindowGloballyOff') : t('resourceWindowToggleEntry') + ' ' + entry.name,
      'aria-pressed': on ? 'true' : 'false'
    },
    h(
      'div',
      { className: rc.rowId },
      h('span', { className: rc.name }, entry.name),
      entry.version === undefined ? null : h('span', { className: rc.version }, 'v' + entry.version),
      h(Tag, { tone: 'neutral' }, entry.source)
    ),
    // Key presses stop here too: a focused switch or view button would
    // otherwise bubble Enter/Space into the card's own button handler and
    // toggle the entry a second time.
    h(
      'div',
      { className: rc.rowActions, onKeyDown: (event: { stopPropagation(): void }) => event.stopPropagation() },
      h(
        'button',
        {
          type: 'button',
          className: rc.iconBtn,
          title: t('resourceWindowView') + ' ' + entry.name,
          'aria-label': t('resourceWindowView') + ' ' + entry.name,
          onClick: stop(props.onView)
        },
        h(IconInspectOutlineMedium)
      ),
      // The enable switch reads last, at the cluster's trailing edge. A
      // globally disabled entry locks it for good — this surface can filter
      // further, never re-enable what the user level turned off. Per-project
      // flips stay unlocked: they paint at once (see toggleEntry).
      h(
        'span',
        { className: rc.switchWrap, onClick: (event: { stopPropagation(): void }) => event.stopPropagation() },
        h(Switch, {
          checked: on,
          disabled: entry.globalDisabled === true,
          label: entry.globalDisabled === true ? t('resourceWindowGloballyOff') : t('resourceWindowToggleEntry'),
          title:
            entry.globalDisabled === true
              ? t('resourceWindowGloballyOff')
              : t('resourceWindowToggleEntry'),
          onChange: props.onToggle
        })
      )
    ),
    entry.description === undefined ? null : h('p', { className: `${rc.rowBody} ${rc.desc}` }, entry.description),
    h(
      'div',
      { className: rc.rowFoot },
      h('span', { className: rc.provenance, title: entry.source }, entry.source),
      ...counts.flatMap(count => [
        h('span', { key: 'sep-' + count.label, className: rc.separator }, '·'),
        h(
          'span',
          { key: count.label, className: rc.count },
          countLabel(t, count.label),
          ' ',
          h('span', { className: rc.countValue }, String(count.count))
        )
      ])
    )
  )
}

/** The settings page's tab word for one face: the main dictionary's
 * workspaceTab* keys, the exact labels PluginWorkspace renders. */
const FACE_LABEL_KEYS: Record<ResourceFace, string> = {
  market: 'workspaceTabMarket',
  skills: 'workspaceTabSkills',
  commands: 'workspaceTabCommands',
  agents: 'workspaceTabPersonas',
  mcp: 'workspaceTabMcp',
  lsp: 'workspaceTabLsp'
}

/** The settings page's tab id for one face — the `#/agent-plugins/<tab>`
 * segment the workspace shell parses; `agents` is the personas tab there. */
function faceTab(face: ResourceFace): WorkspaceTab {
  const tabs: Record<ResourceFace, WorkspaceTab> = {
    market: 'market',
    skills: 'skills',
    commands: 'commands',
    agents: 'personas',
    mcp: 'mcp',
    lsp: 'lsp'
  }
  return tabs[face]
}

/**
 * The default view action: land on the entry's settings page. The hash the
 * workspace shell parses selects the tab, and the panel event lifts the
 * market panel when the settings surface is not on screen yet — the same
 * literals page-mode.tsx dispatches for its own entry.
 */
function defaultViewDetail(viewFace: ResourceFace): void {
  if (typeof location !== 'undefined') {
    try {
      location.hash = `#/agent-plugins/${faceTab(viewFace)}`
    } catch {
      // Sandboxed contexts may refuse hash writes; the dispatch below still lifts the surface.
    }
  }
  document.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: PANEL_NAME }))
}

/** Map one wire count label onto the window's localized word. */
function countLabel(t: ResourceTranslate, label: string): string {
  if (label === 'skills') return t('resourceWindowCountSkills')
  if (label === 'mcp') return t('resourceWindowCountMcp')
  if (label === 'hooks') return t('resourceWindowCountHooks')
  if (label === 'commands') return t('resourceWindowCountCommands')
  if (label === 'agents') return t('resourceWindowCountAgents')
  if (label === 'lsp') return t('resourceWindowCountLsp')
  return label
}
