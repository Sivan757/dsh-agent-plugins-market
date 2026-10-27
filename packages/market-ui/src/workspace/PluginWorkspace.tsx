/**
 * The plugin workspace: one page, seven top tabs.
 *
 * The market, skills, commands, agent personas, MCP services, LSP servers,
 * and hooks panels all render inside this shell, so the settings sidebar
 * keeps a single "Agent Plugins" entry and users switch surfaces with the tab
 * row. Each tab's content scrolls inside its own region (never the settings
 * column), which removes the scrollbar show/hide jitter when tabs with
 * different content heights swap.
 * @module client/PluginWorkspace
 */
import { createElement as h, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { SettingsSizedDetails } from '../ui/DetailModal.js'
import { ResourceTabs } from '../ui/ResourceTabs.js'
import { TabStowControl } from './TabStowControl.js'
import { loadTabLayout, saveTabLayout, saveTabOrder } from '../api.js'
import {
  defaultTabLayout,
  moveTab,
  resolveHiddenTabs,
  visibleTabs,
  WORKSPACE_TAB_KEYS,
  type TabLayoutWire,
  type WorkspaceTabKey
} from '../../../market-contracts/src/contracts/tab-layout.js'
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
 * @param layout - the resolved stow list.
 * @param active - the tab the panel shows.
 * @returns the visible tabs in display order.
 */
function rowTabs(layout: TabLayoutWire, active: WorkspaceTab): WorkspaceTab[] {
  return visibleTabs(layout.order.length > 0 ? layout.order : TAB_ORDER, layout, active)
}

export interface PluginWorkspaceProps {
  t: Translate
  credentials?: CredentialApi
  /** The live session the workspace describes; the instructions tab reads its chain. */
  sessionId?: string
  /** The host surface controls only outer spacing; data and actions stay shared. */
  mode?: 'settings' | 'page'
}

/** One page with six top tabs; state is local so switching is instant. */
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

  // The stow list is read once and then owned here: the row, the menu and the
  // dialog all render from this value, so a write cannot leave the row and the
  // panel disagreeing about which tabs exist. It starts from the same default the
  // server answers, so the first paint is the row the workspace really has
  // instead of a full one that collapses a frame later.
  const [layout, setLayout] = useState<TabLayoutWire>(() => defaultTabLayout())
  const [layoutError, setLayoutError] = useState<string | undefined>(undefined)
  const [stowing, setStowing] = useState(false)
  /** The last layout the server confirmed, so a failed write can put it back. */
  const confirmed = useRef<TabLayoutWire>(defaultTabLayout())

  useEffect(() => {
    let live = true
    void loadTabLayout()
      .then(stored => {
        if (!live) return
        confirmed.current = stored
        setLayout(stored)
      })
      .catch((error: unknown) => {
        // A failed read costs the user their layout, never the workspace: every
        // tab stays visible and the reason appears where the controls are.
        if (live) setLayoutError(t('tabLayoutLoadFailed', { error: messageOf(error) }))
      })
    return () => {
      live = false
    }
  }, [t])

  /**
   * Apply a stow list now and persist it behind the row.
   *
   * The row paints first because the change is the user's own click, and a
   * local file write is fast enough that waiting would only make it feel late.
   * A failed write puts the confirmed layout back and says why, so the row
   * never shows a layout the server does not have.
   */
  const stow = useCallback(
    (next: readonly string[]) => {
      const resolved: TabLayoutWire = { hidden: resolveHiddenTabs(next), order: layout.order }
      // Stowing the tab the panel shows would leave a panel whose tab is not
      // rendered, so the selection moves to the first tab that stays. This
      // reads the stow list alone rather than the row, so it does not depend on
      // which tab is pinned or where the pinned tab sits in the order.
      if (resolved.hidden.includes(active)) setActive(resolved.order.find(tab => !resolved.hidden.includes(tab)) ?? 'market')
      setLayout(resolved)
      setStowing(true)
      setLayoutError(undefined)
      void saveTabLayout(resolved.hidden)
        .then(committed => {
          confirmed.current = committed
          setLayout(committed)
        })
        .catch((error: unknown) => {
          setLayout(confirmed.current)
          setLayoutError(t('tabLayoutWriteFailed', { error: messageOf(error) }))
        })
        .finally(() => setStowing(false))
    },
    [active, layout.order, t]
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
      const row = shown
      const moving = row[from]
      const landing = row[to]
      if (moving === undefined || landing === undefined || moving === landing) return
      const order = moveTab(layout.order, layout.order.indexOf(moving), layout.order.indexOf(landing))
      setLayout({ hidden: layout.hidden, order })
      setStowing(true)
      setLayoutError(undefined)
      void saveTabOrder(order)
        .then(committed => {
          confirmed.current = committed
          setLayout(committed)
        })
        .catch((error: unknown) => {
          setLayout(confirmed.current)
          setLayoutError(t('tabLayoutWriteFailed', { error: messageOf(error) }))
        })
        .finally(() => setStowing(false))
    },
    [layout.hidden, layout.order, shown, t]
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
      { ref: rowRef, className: css.rowKeys },
      h(ResourceTabs<WorkspaceTab>, {
        label: labelKeys.market,
        value: active,
        // Switching tabs is local state only; the URL stays the host's.
        onChange: setActive,
        items: shown.map(tab => ({ value: tab, text: labelKeys[tab], id: `agent-plugins-tab-${tab}`, panelId: 'agent-plugins-panel' })),
        // The trigger renders outside the tablist, so the host's roving tab stop
        // and walk keys stay exactly what they were.
        trailing: h(TabStowControl, {
          t,
          tabs: layout.order.map(tab => ({ key: tab, label: labelKeys[tab] })),
          visible: shown,
          hidden: layout.hidden,
          busy: stowing,
          error: layoutError,
          onSelect: tab => setActive(tab as WorkspaceTab),
          onStow: stow,
          onReorder: reorder
        })
      })
    ),
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
