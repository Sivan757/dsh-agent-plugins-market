/**
 * The plugin workspace: one page, one top tab row.
 *
 * One panel per key in `WORKSPACE_TAB_KEYS` renders inside this shell, so the
 * settings sidebar keeps a single "Agent Plugins" entry and users switch
 * surfaces with the tab row. Each tab's content scrolls inside its own region
 * (never the settings column), which removes the scrollbar show/hide jitter when
 * tabs with different content heights swap.
 * @module client/PluginWorkspace
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SettingsSizedDetails } from '../ui/DetailModal.js'
import { TabRail } from '../ui/TabRail.js'
import { TabStowControl } from './TabStowControl.js'
import { useTabLayout, type TabLayoutMessages } from './tab-layout-store.js'
import { TabHoverActions, TabHoverGuide, useTabHover, useTabHoverGuide } from './TabHoverActions.js'
import { PINNED_TAB_KEY, resolveHiddenTabs, visibleTabs, WORKSPACE_TAB_KEYS, type TabLayoutWire, type WorkspaceTabKey } from '../../../market-contracts/src/contracts/tab-layout.js'
import type { Translate } from '../i18n.js'
import type { ExtensionTranslate } from '../features/extension-presets/types.js'
import type { CredentialApi } from '../credentials.js'
import { MarketSection } from '../features/market/MarketSection.js'
import { McpStatusPanel } from '../features/mcp/StatusPanel.js'
import { LspStatusPanel } from '../features/lsp/LspStatusPanel.js'
import { HooksStatusPanel } from '../features/hooks/StatusPanel.js'
import { InstructionsPanel } from '../features/instructions/InstructionsPanel.js'
import { OutputStylesPanel } from '../features/output-styles/OutputStylesPanel.js'
import { UserPanelSurface } from '../ui/UserPanelSurface.js'
import css from './workspace.module.css'

/**
 * One workspace tab.
 *
 * The key set is the contract's, not a second list kept in step with it: that
 * list is what the server validates a stow request against, so it owns the
 * order and this alias only names the type. Adding a tab edits
 * `WORKSPACE_TAB_KEYS` alone; the label map and the panel switch below then
 * fail to compile until they cover the new key.
 */
export type WorkspaceTab = WorkspaceTabKey

/**
 * Display order of the tab row: the contract's own array, not a copy.
 *
 * Sharing the array is what makes one list the owner, and `resolveHiddenTabs`
 * returns its result in this order too, so the row, the stow menu and the
 * manager all read one sequence.
 */
export const TAB_ORDER: ReadonlyArray<WorkspaceTab> = WORKSPACE_TAB_KEYS

/**
 * The tabs the row renders for one active tab.
 *
 * The stowed list decides, except that the active tab always renders: a hash
 * deep link can select a stowed tab, and the panel below must always have its
 * own tab in the row. The reveal is derived from the layout and the selection,
 * never written back, so following a link cannot change what is saved.
 * The order is the layout's own: every producer builds it through
 * `resolveTabOrder`, which appends every missing key, so it is always the whole
 * row and never needs a fallback.
 * @param layout - the resolved stow list.
 * @param active - the tab the panel shows.
 * @returns the visible tabs in display order.
 */
function rowTabs(layout: TabLayoutWire, active: WorkspaceTab): WorkspaceTab[] {
  return visibleTabs(layout.order, layout, active)
}

export interface PluginWorkspaceProps {
  t: Translate
  credentials?: CredentialApi
  /** The live session the workspace describes; the instructions tab reads its chain. */
  sessionId?: string
  /** The host surface controls only outer spacing; data and actions stay shared. */
  mode?: 'settings' | 'page'
}

/** One page, one tab row per `WORKSPACE_TAB_KEYS`; state is local so switching is instant. */
export function PluginWorkspace({ t, credentials, mode = 'settings', sessionId }: PluginWorkspaceProps): ReactNode {
  const [active, setActive] = useState<WorkspaceTab>('market')

  // Deep links: a `#/agent-plugins/<tab>` hash selects the tab, and is then
  // spent. The hash is a one-shot instruction carried in the URL — the resource
  // window's "view" action hands a face over it — not tab state the plugin
  // maintains: a click never writes it, so the plugin leaves the host page's
  // URL as it found it and reopening always starts on the default tab. A hash
  // left behind would be invisible and un-clearable, since nothing else in the
  // host writes one.
  useEffect(() => {
    const applyHash = (): void => {
      if (typeof window === 'undefined') return
      const match = /^#\/agent-plugins\/(\w+)$/.exec(window.location.hash)
      if (match === null) return
      const tab = match[1] as WorkspaceTab
      if (!TAB_ORDER.includes(tab)) return
      setActive(tab)
      // Consume it so it cannot outlive the visit and reselect on a later mount.
      // `replaceState` fires no `hashchange`, so this cannot loop.
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      } catch {
        // Sandboxed contexts may refuse history writes; the tab still switches.
      }
    }
    applyHash()
    if (typeof window === 'undefined') return
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [])

  const labelKeys: Record<WorkspaceTab, string> = {
    market: t('workspaceTabMarket'),
    outputStyles: t('workspaceTabOutputStyles'),
    instructions: t('workspaceTabInstructions'),
    skills: t('workspaceTabSkills'),
    commands: t('workspaceTabCommands'),
    personas: t('workspaceTabPersonas'),
    mcp: t('workspaceTabMcp'),
    lsp: t('workspaceTabLsp'),
    hooks: t('workspaceTabHooks')
  }

  // The layout is shared with the preset manager, which opens inside this screen,
  // so both rows render from one store: a reorder or a stow in either is visible
  // in the other immediately. The store starts from the same default the server
  // answers, so the first paint is the row the workspace really has.
  const layoutMessages = useMemo<TabLayoutMessages>(
    () => ({
      load: (error: unknown) => t('tabLayoutLoadFailed', { error: messageOf(error) }),
      write: (error: unknown) => t('tabLayoutWriteFailed', { error: messageOf(error) })
    }),
    [t]
  )
  const { state: layoutState, stow: applyStowList, move: applyTabMoveTo } = useTabLayout(layoutMessages)
  const layout = layoutState.layout
  const layoutError = layoutState.error
  const stowing = layoutState.busy
  // The manager is a dialog with its own trigger in the trailing control, and
  // the long-hover bubble opens the same dialog. Owning that flag here is what
  // lets both entry points reach it without duplicating the panel.
  const [managing, setManaging] = useState(false)

  /**
   * Apply a stow list now and persist it behind the row.
   *
   * The row paints first because the change is the user's own click; the store
   * owns that ordering, the write and the rollback, because the preset manager
   * renders the same list and must see the same result.
   */
  const stow = useCallback(
    (next: readonly string[]) => {
      const hidden = resolveHiddenTabs(next)
      // Stowing the tab the panel shows would leave a panel whose tab is not
      // rendered, so the selection moves to the first tab that stays. This
      // reads the stow list alone rather than the row, so it does not depend on
      // which tab is pinned or where the pinned tab sits in the order.
      if (hidden.includes(active)) setActive(layout.order.find(tab => !hidden.includes(tab)) ?? 'market')
      applyStowList(next)
    },
    [active, applyStowList, layout.order]
  )

  const shown = rowTabs(layout, active)

  /**
   * Move one tab and persist the new order.
   *
   * Same shape as stowing: the row paints at once, the write follows, and a
   * failed write restores the confirmed order with a reason. Sorting never
   * touches the stow list, so a tab put away keeps its place for later.
   * @param from - the index of the tab being moved, in the rendered row.
   * @param to - the index it should land on, in the rendered row.
   */
  const reorder = useCallback(
    (from: number, to: number) => {
      const moving = shown[from]
      const landing = shown[to]
      if (moving === undefined || landing === undefined) return
      applyTabMoveTo(moving, landing)
    },
    [applyTabMoveTo, shown]
  )

  /**
   * Move a focused tab with the keyboard.
   *
   * The mouse gesture in the manager is one way to sort; this is the same
   * operation without a pointer, and it is what makes sorting reachable for a
   * keyboard or screen-reader user. Alt is required so a plain arrow keeps the
   * host's own tab walk.
   */
  const onKeyDown = useCallback(
    (event: { key: string; altKey: boolean; target: EventTarget | null; preventDefault: () => void }) => {
      if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
      const target = event.target as { closest?: (selector: string) => Element | null } | null
      const tab = target?.closest?.('[role="tab"]') ?? null
      if (tab === null) return
      // The host mints each tab's id from the value, so the id is the reliable
      // way back to the tab a caller moved; a data attribute is only a fallback.
      const raw = tab.getAttribute('data-value') ?? (tab.getAttribute('id') ?? '').replace('agent-plugins-tab-', '')
      const from = shown.indexOf(raw as WorkspaceTab)
      if (from < 0) return
      event.preventDefault()
      const to = from + (event.key === 'ArrowLeft' ? -1 : 1)
      if (to <= 0 || to >= shown.length) return
      reorder(from, to)
    },
    [reorder, shown]
  )

  const rowRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = rowRef.current
    if (node === null) return
    const listener = (event: Event): void => onKeyDown(event as unknown as Parameters<typeof onKeyDown>[0])
    node.addEventListener('keydown', listener)
    return () => node.removeEventListener('keydown', listener)
  }, [onKeyDown])

  // A pointer resting on a tab is asking about that tab, so the row answers
  // there rather than in a menu at the far end. The row keeps no button for it.
  const hover = useTabHover(
    layout.order.map(tab => ({ key: tab, label: labelKeys[tab] })),
    PINNED_TAB_KEY
  )
  // A gesture with no visible control introduces itself once. The guide waits for
  // the row to settle and retires itself, so it never blocks the workspace.
  const guide = useTabHoverGuide(shown.length >= 3)
  const hovered = hover.target
  const hoverAt = hovered === undefined ? -1 : shown.indexOf(hovered.key as WorkspaceTab)

  const moveHovered = useCallback(
    (direction: -1 | 1) => {
      if (hovered === undefined) return
      const from = shown.indexOf(hovered.key as WorkspaceTab)
      hover.close()
      if (from < 0) return
      const to = from + direction
      if (to <= 0 || to >= shown.length) return
      reorder(from, to)
    },
    [hover, hovered, reorder, shown]
  )

  const stowHovered = useCallback(() => {
    if (hovered === undefined) return
    hover.close()
    stow([...layout.hidden, hovered.key])
  }, [hover, hovered, layout.hidden, stow])

  return h(
    'div',
    { className: mode === 'page' ? `${css.workspace} ${css.pageMode}` : css.workspace, 'data-agent-plugins-workspace': true },
    // The shared tab row: the host owns the roving tab stop, the walk keys and
    // the sliding indicator; the row policy (equal columns, ellipsized labels,
    // no sideways scroll) is the same one the preset manager renders. Panels
    // stay caller-owned: every tab names one shared panel id, and the active
    // section renders inside it below. The row is built from TAB_ORDER, so the
    // stowed tabs are simply the ones it leaves out.
    // display: contents on the wrapper keeps the host's own row layout: the
    // element exists only to carry the Alt+arrow listener, and it adds no box.
    h(
      'div',
      { ref: rowRef, className: css.rowKeys, ...hover.bind },
      h(TabRail<WorkspaceTab>, {
        label: labelKeys.market,
        value: active,
        // Switching tabs is local state only; the URL stays the host's.
        onChange: setActive,
        items: shown.map(tab => ({ value: tab, text: labelKeys[tab], id: `agent-plugins-tab-${tab}`, panelId: 'agent-plugins-panel' })),
        // Dragging moves one tab to another's position: the same write the manager
        // and the Alt+arrow gesture make, so all three paths persist one order.
        onReorder: reorder,
        trailing: h(TabStowControl, {
          t,
          tabs: layout.order.map(tab => ({ key: tab, label: labelKeys[tab] })),
          visible: shown,
          hidden: layout.hidden,
          busy: stowing,
          error: layoutError,
          manageOpen: managing,
          onManageOpenChange: setManaging,
          onSelect: tab => setActive(tab as WorkspaceTab),
          onStow: stow,
          onReorder: reorder
        })
      })
    ),
    guide.anchor === undefined ? null : h(TabHoverGuide, { t, target: guide.anchor, onDismiss: guide.dismiss }),
    hovered === undefined
      ? null
      : h(TabHoverActions, {
          t,
          target: hovered,
          canMoveLeft: hoverAt > 1,
          canMoveRight: hoverAt >= 0 && hoverAt < shown.length - 1,
          onMove: moveHovered,
          onStow: stowHovered,
          onOpenList: () => {
            hover.close()
            setManaging(true)
          },
          onHold: hover.hold,
          onLeave: hover.close
        }),
    // Every detail dialog these panels open inherits the fixed settings-sized
    // frame, the same chrome the preset manager's details use.
    h(
      'div',
      { className: css.tabPanel, role: 'tabpanel', id: 'agent-plugins-panel', 'aria-labelledby': `agent-plugins-tab-${active}` },
      h(SettingsSizedDetails, null, renderTab(active, t, credentials, mode, sessionId))
    )
  )
}

/**
 * Render the panel for one tab.
 *
 * The closed union ends in an exhaustiveness check rather than a default, so a
 * tab added to `WORKSPACE_TAB_KEYS` fails this file to compile until its panel
 * exists. That is the whole contract for adding a tab: the key list, the two
 * locale dictionaries, and this switch.
 * @param tab - the tab whose panel renders.
 * @param t - the translator this page renders through.
 * @param credentials - the credential API an MCP panel needs.
 * @param mode - the host surface the panel renders inside.
 * @param sessionId - the live session, which the instructions panel reads its chain for.
 * @returns the tab's panel.
 */
function renderTab(tab: WorkspaceTab, t: Translate, credentials: CredentialApi | undefined, mode: 'settings' | 'page', sessionId: string | undefined): ReactNode {
  switch (tab) {
    case 'market':
      return h(MarketSection, { t, mode })
    case 'instructions':
      return h(InstructionsPanel, { t, sessionId })
    case 'outputStyles':
      return h(OutputStylesPanel, { t, sessionId })
    case 'skills':
      return h(UserPanelSurface, { t, kind: 'skills' })
    case 'commands':
      return h(UserPanelSurface, { t, kind: 'commands' })
    case 'personas':
      return h(UserPanelSurface, { t, kind: 'agents' })
    case 'mcp':
      return h(McpStatusPanel, { t, credentials })
    case 'lsp':
      return h(LspStatusPanel, { t })
    case 'hooks':
      // Both dictionaries are registered under this one namespace, so the
      // translator already answers the preset keys; the declared split is a
      // typing boundary, reconciled here as the entry point does.
      return h(HooksStatusPanel, { t: t as ExtensionTranslate })
    default:
      return unreachableTab(tab)
  }
}

/** Fail loud on a tab with no panel: the compiler stops this before a user sees it. */
function unreachableTab(tab: never): never {
  throw new Error('unhandled workspace tab: ' + String(tab))
}
/** The text of a thrown value, for a diagnostic that must stay a string. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
