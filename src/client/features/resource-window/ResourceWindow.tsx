/**
 * The project resource window.
 *
 * One Modal over the six switchable surfaces, listing only what this workspace
 * has installed. Every control is a host or shared primitive — the tab row,
 * the shared SearchFilterToolbar, the header PanelActions, the favorite chips,
 * the toasts — and the rows ride the shared ResourceCard anatomy (identity,
 * body, foot), the same chrome the market and MCP cards use, with the card
 * itself acting as the entry toggle (a role=button carrying aria-pressed).
 * Switching tabs never closes the window; flipping an entry reconciles
 * through the same chain the composer switches use, so the row state is
 * live, not cosmetic.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Modal, Pill, SegmentedTabs, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import { RESOURCE_FACE_ORDER, type ResourceEntryWire, type ResourceFace } from '../../../contracts/resource-window.js'
import { applyResourceFavorite, deleteResourceFavorite, fetchResourceWindow, saveResourceFavorite, setResourceEntry } from './resource-window-resource.js'
import type { ResourceWindowData } from './resource-window-resource.js'
import type { ResourceLocaleKey } from '../../locales-resources.js'
import { interactiveCardProps, ResourceCard, ResourceCollection } from '../../ui/ResourceCard.js'
import { SearchFilterToolbar, type SearchFilterToolbarView } from '../../ui/SearchFilterToolbar.js'
import { PanelActions } from '../../ui/panel.js'
import panelCss from '../../ui/panel.module.css'
import rc from '../../ui/resource-card.module.css'
import css from './resource-window.module.css'

/** The window's translator: the resource dictionary keys, params like the host's. */
export type ResourceTranslate = (key: ResourceLocaleKey, params?: Record<string, unknown>) => string

const TAB_ID = 'agent-plugins-resource-tab'
const FILTER_ID = 'agent-plugins-resource-filter'

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
}

export function ResourceWindow({ t, open, onClose }: ResourceWindowProps): ReactNode {
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

  // Plain face words: the counts live in the filter segment below, the same
  // one place the five panels keep them.
  const tabs = useMemo(
    () =>
      RESOURCE_FACE_ORDER.map((key): SegmentedTab<ResourceFace> => ({
        value: key,
        label: t(faceLabelKey(key)),
        id: `${TAB_ID}-${key}`,
        // Every face shows through the one list area, whose id follows the
        // filter segment's `<filterId>-<value>-panel` convention (StatusPanel).
        panelId: `${FILTER_ID}-${entryFilter}-panel`
      })) as [SegmentedTab<ResourceFace>, ...SegmentedTab<ResourceFace>[]],
    [t, entryFilter]
  )

  const followGlobal = data?.activeFavoriteId == null

  // The filter tablist names this region, and the host derives the active
  // tab's aria-controls from the same base, so the reference always resolves.
  const panelProps = {
    role: 'tabpanel' as const,
    id: `${FILTER_ID}-${entryFilter}-panel`,
    'aria-labelledby': `${FILTER_ID}-${entryFilter}`
  }

  return h(
    Modal,
    {
      open,
      onClose,
      title: t('resourceWindowTitle'),
      description: data === undefined ? undefined : t('resourceWindowSubtitle'),
      closeLabel: t('resourceWindowClose'),
      className: css.window,
      contentClassName: css.content
    },
    // The workspace chip rides with the header commands: add saves the current
    // state as a favorite, refresh re-reads the inventory — the five panels'
    // header anatomy, scoped to this window.
    h(
      'div',
      { className: css.headerRow },
      h('span', { className: css.workspaceChip, title: data?.workspace ?? '' }, workspaceLabel(data?.workspace ?? '')),
      h(PanelActions, {
        addLabel: t('resourceWindowSaveFavorite'),
        onAdd: () => {
          setNameDraft(t('resourceWindowNameDefault', { n: String((data?.favorites.length ?? 0) + 1) }))
          setNaming(true)
        },
        refreshLabel: t('resourceWindowRefresh'),
        onRefresh: () => {
          void load(() => true)
        },
        busy
      })
    ),
    // Favorites row: follow-global chip and the saved favorites (deletable).
    h(
      'div',
      { className: css.favoritesRow },
      h('span', { className: css.favoritesLabel }, t('resourceWindowFavoritesLabel')),
      // Follow-global is the state indicator, not an action: the workspace
      // always holds concrete state, so the chip renders without a click path.
      h(Pill, { active: followGlobal, title: t('resourceWindowFollowGlobal') }, t('resourceWindowFollowGlobal')),
      ...(data?.favorites ?? []).map(favorite =>
        h(
          Pill,
          {
            key: favorite.id,
            active: data?.activeFavoriteId === favorite.id,
            disabled: busy,
            title: favorite.name,
            onClick: () => {
              void mutate(() => applyResourceFavorite(favorite.id)).then(() => flash(t('resourceWindowApplyFavoriteDone', { name: favorite.name })))
            }
          },
          favorite.name,
          // The delete affordance rides inside the chip the way the
          // prototype's .pchip .del does: a span, because a button inside the
          // chip's own button is invalid nesting. Keyboard parity comes from
          // role="button" plus Enter/Space handling.
          h(
            'span',
            {
              role: 'button',
              tabIndex: 0,
              className: css.favoriteDelete,
              title: t('resourceWindowDeleteFavorite'),
              'aria-label': t('resourceWindowDeleteFavorite') + ' ' + favorite.name,
              onClick: (event: { stopPropagation(): void }) => {
                event.stopPropagation()
                void mutate(() => deleteResourceFavorite(favorite.id)).then(() => flash(t('resourceWindowDeleteFavoriteDone', { name: favorite.name })))
              },
              onKeyDown: (event: { key: string; stopPropagation(): void; preventDefault(): void }) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                void mutate(() => deleteResourceFavorite(favorite.id)).then(() => flash(t('resourceWindowDeleteFavoriteDone', { name: favorite.name })))
              }
            },
            '✕'
          )
        )
      ),
      h('span', { className: css.favoritesNote }, t('resourceWindowFavoriteCrossNote'))
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
      filterLabel: t('resourceWindowTitle'),
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
                  onToggle: enabled => {
                    void mutate(() => setResourceEntry(entry.face, entry.id, enabled))
                  }
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
 * One inventory row in either view. The card carries the shared anatomy
 * (identity / body / foot) and doubles as the toggle — a role=button carrying
 * aria-pressed, pressed while the entry mounts — the way the prototype flips
 * a row; the state rail on its left edge already paints enabled versus
 * filtered, so no text label repeats it.
 */
function ResourceRow(props: { entry: ResourceEntryWire; t: ResourceTranslate; onToggle: (enabled: boolean) => void }): ReactNode {
  const { entry, t } = props
  const on = entry.enabled
  const counts = entry.counts ?? []
  return h(
    ResourceCard,
    {
      state: on ? 'active' : 'disabled',
      surface: entry.face === 'agents' ? 'personas' : entry.face,
      ...interactiveCardProps(() => props.onToggle(!on)),
      'aria-label': t('resourceWindowToggleEntry') + ' ' + entry.name,
      'aria-pressed': on ? 'true' : 'false'
    },
    h(
      'div',
      { className: rc.rowId },
      h('span', { className: rc.name }, entry.name),
      entry.version === undefined ? null : h('span', { className: rc.version }, 'v' + entry.version)
    ),
    entry.description === undefined ? null : h('p', { className: `${rc.rowBody} ${rc.desc}` }, entry.description),
    counts.length === 0
      ? null
      : h(
          'div',
          { className: rc.rowFoot },
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

/** The locale key naming one face's tab. */
function faceLabelKey(face: ResourceFace): ResourceLocaleKey {
  const keys: Record<ResourceFace, ResourceLocaleKey> = {
    market: 'resourceWindowTitle',
    skills: 'resourceWindowCountSkills',
    commands: 'resourceWindowCountCommands',
    agents: 'resourceWindowCountAgents',
    mcp: 'resourceWindowCountMcp',
    lsp: 'resourceWindowCountLsp'
  }
  return keys[face]
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

/** The workspace's directory name, the way the prototype's chip shows it. */
function workspaceLabel(workspace: string): string {
  const trimmed = workspace.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  return slash === -1 ? trimmed : trimmed.slice(slash + 1)
}
