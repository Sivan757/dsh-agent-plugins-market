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
import { loadTabLayout, saveTabLayout } from '../api.js'
import { resolveHiddenTabs, visibleTabs } from '../../../market-contracts/src/contracts/tab-layout.js'
import type { Translate } from '../i18n.js'
import type { ExtensionTranslate } from '../features/extension-presets/types.js'
import type { CredentialApi } from '../credentials.js'
import { MarketSection } from '../features/market/MarketSection.js'
import { McpStatusPanel } from '../features/mcp/StatusPanel.js'
import { LspStatusPanel } from '../features/lsp/LspStatusPanel.js'
import { HooksStatusPanel } from '../features/hooks/StatusPanel.js'
import { UserPanelSurface } from '../ui/UserPanelSurface.js'
import css from './workspace.module.css'

/** The seven workspace tabs in display order. */
export type WorkspaceTab = 'market' | 'skills' | 'commands' | 'personas' | 'mcp' | 'lsp' | 'hooks'

/** Display order of the tab row. The stow menu lists the tabs this array names. */
export const TAB_ORDER: ReadonlyArray<WorkspaceTab> = ['market', 'skills', 'commands', 'personas', 'mcp', 'lsp', 'hooks']

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
function rowTabs(layout: { hidden: string[] }, active: WorkspaceTab): WorkspaceTab[] {
  return visibleTabs(TAB_ORDER, layout, active)
}

export interface PluginWorkspaceProps {
  t: Translate
  credentials?: CredentialApi
  /** The host surface controls only outer spacing; data and actions stay shared. */
  mode?: 'settings' | 'page'
}

/** One page with six top tabs; state is local so switching is instant. */
export function PluginWorkspace({ t, credentials, mode = 'settings' }: PluginWorkspaceProps): ReactNode {
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
    skills: t('workspaceTabSkills'),
    commands: t('workspaceTabCommands'),
    personas: t('workspaceTabPersonas'),
    mcp: t('workspaceTabMcp'),
    lsp: t('workspaceTabLsp'),
    hooks: t('workspaceTabHooks')
  }

  // The stow list is read once and then owned here: the row, the menu and the
  // dialog all render from this value, so a write cannot leave the row and the
  // panel disagreeing about which tabs exist.
  const [layout, setLayout] = useState<{ hidden: string[] }>({ hidden: [] })
  const [layoutError, setLayoutError] = useState<string | undefined>(undefined)
  const [stowing, setStowing] = useState(false)
  /** The last layout the server confirmed, so a failed write can put it back. */
  const confirmed = useRef<{ hidden: string[] }>({ hidden: [] })

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
      const resolved = { hidden: resolveHiddenTabs(next) }
      // Stowing the tab the panel shows would leave a panel whose tab is not
      // rendered, so the selection moves to the first tab that stays. This
      // reads the stow list alone rather than the row, so it does not depend on
      // which tab is pinned or where the pinned tab sits in the order.
      if (resolved.hidden.includes(active)) setActive(TAB_ORDER.find(tab => !resolved.hidden.includes(tab)) ?? 'market')
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
    [active, t]
  )

  const shown = rowTabs(layout, active)

  return h(
    'div',
    { className: mode === 'page' ? `${css.workspace} ${css.pageMode}` : css.workspace, 'data-agent-plugins-workspace': true },
    // The shared tab row: the host owns the roving tab stop, the walk keys and
    // the sliding indicator; the row policy (equal columns, ellipsized labels,
    // no sideways scroll) is the same one the preset manager renders. Panels
    // stay caller-owned: every tab names one shared panel id, and the active
    // section renders inside it below. The row is built from TAB_ORDER, so the
    // stowed tabs are simply the ones it leaves out.
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
        tabs: TAB_ORDER.map(tab => ({ key: tab, label: labelKeys[tab] })),
        hidden: layout.hidden,
        busy: stowing,
        error: layoutError,
        onSelect: tab => setActive(tab as WorkspaceTab),
        onStow: stow
      })
    }),
    // Every detail dialog these panels open inherits the fixed settings-sized
    // frame, the same chrome the preset manager's details use.
    h(
      'div',
      { className: css.tabPanel, role: 'tabpanel', id: 'agent-plugins-panel', 'aria-labelledby': `agent-plugins-tab-${active}` },
      h(SettingsSizedDetails, null, renderTab(active, t, credentials, mode))
    )
  )
}

function renderTab(tab: WorkspaceTab, t: Translate, credentials: CredentialApi | undefined, mode: 'settings' | 'page'): ReactNode {
  switch (tab) {
    case 'market':
      return h(MarketSection, { t, mode })
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
  }
}
/** The text of a thrown value, for a diagnostic that must stay a string. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
