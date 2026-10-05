/**
 * The plugin workspace: one page, six top tabs.
 *
 * The market, skills, commands, agent personas, MCP services, and LSP
 * servers panels all render inside this shell, so the settings sidebar keeps
 * a single "Agent Plugins" entry and users switch surfaces with the tab row.
 * Each tab's content scrolls inside its own region (never the settings
 * column), which removes the scrollbar show/hide jitter when tabs with
 * different content heights swap.
 * @module client/PluginWorkspace
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../index.js'
import type { CredentialApi } from '../credentials.js'
import { MarketSection } from '../features/market/MarketSection.js'
import { McpStatusPanel } from '../features/mcp/StatusPanel.js'
import { LspStatusPanel } from '../features/lsp/LspStatusPanel.js'
import { UserPanelSurface } from '../ui/UserPanelSurface.js'
import css from './workspace.module.css'

/** The six workspace tabs in display order. */
export type WorkspaceTab = 'market' | 'skills' | 'commands' | 'personas' | 'mcp' | 'lsp'

const TAB_ORDER: ReadonlyArray<WorkspaceTab> = ['market', 'skills', 'commands', 'personas', 'mcp', 'lsp']

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
    lsp: t('workspaceTabLsp')
  }

  return h(
    'div',
    { className: mode === 'page' ? `${css.workspace} ${css.pageMode}` : css.workspace, 'data-agent-plugins-workspace': true },
    // The host's controlled tab row (roving tabindex, sliding indicator).
    // Panels stay caller-owned: the workspace hands every tab one shared
    // panel id and renders the active section inside it below.
    h(SegmentedTabs<WorkspaceTab>, {
      className: css.tabRow,
      label: labelKeys.market,
      value: active,
      // Switching tabs is local state only; the URL stays the host's.
      onChange: setActive,
      // Display order restated so the required first tab is a literal: the
      // host's items demand a non-empty tuple, and the tab set is fixed anyway.
      items: [
        { value: 'market', label: labelKeys.market, id: 'agent-plugins-tab-market', panelId: 'agent-plugins-panel' },
        { value: 'skills', label: labelKeys.skills, id: 'agent-plugins-tab-skills', panelId: 'agent-plugins-panel' },
        { value: 'commands', label: labelKeys.commands, id: 'agent-plugins-tab-commands', panelId: 'agent-plugins-panel' },
        { value: 'personas', label: labelKeys.personas, id: 'agent-plugins-tab-personas', panelId: 'agent-plugins-panel' },
        { value: 'mcp', label: labelKeys.mcp, id: 'agent-plugins-tab-mcp', panelId: 'agent-plugins-panel' },
        { value: 'lsp', label: labelKeys.lsp, id: 'agent-plugins-tab-lsp', panelId: 'agent-plugins-panel' }
      ]
    }),
    h('div', { className: css.tabPanel, role: 'tabpanel', id: 'agent-plugins-panel', 'aria-labelledby': `agent-plugins-tab-${active}` }, renderTab(active, t, credentials, mode))
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
  }
}
