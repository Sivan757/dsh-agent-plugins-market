/**
 * The project resource window.
 *
 * One Modal over the six switchable surfaces, listing only what this workspace
 * has installed. Every control is a host primitive — the tab row, the view
 * switch, the search input, the row switches, the favorite chips, the toasts —
 * and the rows ride the shared ResourceCard anatomy — identity, action
 * cluster, body, foot — the same chrome the market and MCP cards use, with
 * the card itself toggling the entry the way the prototype flips a row.
 * Switching tabs never closes the window; flipping an entry reconciles
 * through the same chain the composer switches use, so the row state is
 * live, not cosmetic.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Modal, Pill, SegmentedTabs, Switch, Tag, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconSearchOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { RESOURCE_FACE_ORDER, type ResourceEntryWire, type ResourceFace } from '../../../contracts/resource-window.js'
import { applyResourceFavorite, deleteResourceFavorite, fetchResourceWindow, saveResourceFavorite, setResourceEntry } from './resource-window-resource.js'
import type { ResourceWindowData } from './resource-window-resource.js'
import type { ResourceLocaleKey } from '../../locales-resources.js'
import { interactiveCardProps, ResourceCard, ResourceCollection } from '../../ui/ResourceCard.js'
import rc from '../../ui/resource-card.module.css'
import css from './resource-window.module.css'

/** The window's translator: the resource dictionary keys, params like the host's. */
export type ResourceTranslate = (key: ResourceLocaleKey, params?: Record<string, unknown>) => string

/** The two list views the toolbar switches between. */
type ViewMode = 'card' | 'list'

const TAB_ID = 'agent-plugins-resource-tab'
const PANEL_ID = 'agent-plugins-resource-panel'

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
  const [view, setView] = useState<ViewMode>('card')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<ToastState | undefined>(undefined)
  const [naming, setNaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const toastSeq = useRef(0)

  useEffect(() => {
    if (!open) return
    let alive = true
    setFailed(false)
    fetchResourceWindow()
      .then(window => {
        if (alive) setData(window)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [open])

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

  const visible = useMemo(() => {
    const rows = byFace.get(face) ?? []
    const q = query.trim().toLowerCase()
    if (q === '') return rows
    return rows.filter(row => row.name.toLowerCase().includes(q) || (row.description ?? '').toLowerCase().includes(q))
  }, [byFace, face, query])

  // The tab label keeps the prototype's two levels (face word + small count)
  // as a ReactNode: SegmentedTabs takes nodes, unlike SegmentedControl.
  const tabs = useMemo(
    () =>
      RESOURCE_FACE_ORDER.map((key): SegmentedTab<ResourceFace> => ({
        value: key,
        label: h(
          'span',
          { className: css.tabLabel },
          t(faceLabelKey(key)),
          h('span', { className: css.tabCount }, String(byFace.get(key)?.length ?? 0))
        ),
        id: `${TAB_ID}-${key}`,
        panelId: PANEL_ID
      })) as [SegmentedTab<ResourceFace>, ...SegmentedTab<ResourceFace>[]],
    [byFace, t]
  )

  const followGlobal = data?.activeFavoriteId == null

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
    // Header: title, workspace chip, subtitle. The host Modal owns the close button.
    h(
      'div',
      { className: css.headerRow },
      h('span', { className: css.workspaceChip, title: data?.workspace ?? '' }, workspaceLabel(data?.workspace ?? '')),
      h('span', { className: css.subtitle }, t('resourceWindowSubtitle'))
    ),
    // Favorites row: follow-global chip, saved favorites (deletable), save-current.
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
      h(
        Pill,
        {
          onClick: () => {
            setNameDraft(t('resourceWindowNameDefault', { n: String((data?.favorites.length ?? 0) + 1) }))
            setNaming(true)
          }
        },
        t('resourceWindowSaveFavorite')
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
    // Toolbar: search + card/list view switch.
    h(
      'div',
      { className: css.toolbar },
      h(Input, {
        className: css.search,
        icon: h(IconSearchOutlineMedium),
        type: 'search',
        value: query,
        placeholder: t('resourceWindowSearchPh'),
        'aria-label': t('resourceWindowSearchPh'),
        onChange: event => setQuery(event.currentTarget.value)
      }),
      h(
        'span',
        { className: css.viewGroup, role: 'group', 'aria-label': t('resourceWindowViewGroup') },
        h(
          'button',
          {
            type: 'button',
            className: css.viewSeg,
            'aria-pressed': view === 'list' ? 'true' : 'false',
            'aria-label': t('resourceWindowViewList'),
            title: t('resourceWindowViewList'),
            onClick: () => setView('list')
          },
          h('svg', { viewBox: '0 0 24 24', 'aria-hidden': true }, h('path', { d: 'M4 6h16M4 12h16M4 18h16' }))
        ),
        h(
          'button',
          {
            type: 'button',
            className: css.viewSeg,
            'aria-pressed': view === 'card' ? 'true' : 'false',
            'aria-label': t('resourceWindowViewCard'),
            title: t('resourceWindowViewCard'),
            onClick: () => setView('card')
          },
          h('svg', { viewBox: '0 0 24 24', 'aria-hidden': true }, [
            h('rect', { key: 'tl', x: 4, y: 4, width: 7, height: 7, rx: 1.5 }),
            h('rect', { key: 'tr', x: 13, y: 4, width: 7, height: 7, rx: 1.5 }),
            h('rect', { key: 'bl', x: 4, y: 13, width: 7, height: 7, rx: 1.5 }),
            h('rect', { key: 'br', x: 13, y: 13, width: 7, height: 7, rx: 1.5 })
          ])
        )
      )
    ),
    // The list. One shared panel id: only the active face renders. The
    // container is the shared ResourceCollection — the window's card view is
    // the anatomy's grid view, its list view the anatomy's list — so the
    // view rules (and the container queries below 700px) actually apply.
    h(
      ResourceCollection,
      {
        view: view === 'card' ? 'grid' : 'list',
        role: 'tabpanel',
        id: PANEL_ID,
        'aria-labelledby': `${TAB_ID}-${face}`,
        className: css.list
      },
      failed
        ? h('div', { className: css.loadFailed }, t('resourceWindowLoadFailed'))
        : visible.length === 0
          ? h('div', { className: css.empty }, t('resourceWindowEmpty'))
          : visible.map(entry =>
              h(ResourceRow, {
                key: entry.id,
                entry,
                busy,
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
            { className: css.toolbar },
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
 * (identity / action cluster / body / foot) and doubles as the toggle, the
 * way the prototype flips a row; the state rail on its left edge already
 * paints enabled versus filtered, so no text label repeats it.
 */
function ResourceRow(props: { entry: ResourceEntryWire; busy: boolean; t: ResourceTranslate; onToggle: (enabled: boolean) => void }): ReactNode {
  const { entry, busy, t } = props
  const on = entry.enabled
  return h(
    ResourceCard,
    {
      state: on ? 'active' : 'disabled',
      surface: entry.face === 'agents' ? 'personas' : entry.face,
      ...interactiveCardProps(() => props.onToggle(!on))
    },
    h(
      'div',
      { className: rc.rowId },
      h('span', { className: rc.name }, entry.name),
      entry.version === undefined ? null : h('span', { className: rc.version }, 'v' + entry.version),
      h(Tag, { tone: 'neutral' }, entry.source)
    ),
    h(
      'div',
      { className: rc.rowActions },
      h(
        'span',
        { className: rc.switchWrap, onClick: (event: { stopPropagation(): void }) => event.stopPropagation() },
        h(Switch, {
          checked: on,
          disabled: busy,
          label: entry.name,
          title: t('resourceWindowToggleEntry'),
          onChange: props.onToggle
        })
      )
    ),
    entry.description === undefined ? null : h('p', { className: `${rc.rowBody} ${rc.desc}` }, entry.description),
    h(
      'div',
      { className: rc.rowFoot },
      h('span', { className: rc.provenance, title: entry.source }, entry.source),
      ...(entry.counts ?? []).flatMap(count => [
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
