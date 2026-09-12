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
import type { Translate } from './index.js'
import type { CredentialApi } from './credentials.js'
import { MarketSection } from './MarketSection.js'
import { McpStatusPanel } from './McpStatusPanel.js'
import { LspStatusPanel } from './LspStatusPanel.js'
import { UserPanelSurface } from './ui/UserPanelSurface.js'
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

  // Deep links: a `#/agent-plugins/<tab>` hash selects the tab directly, and
  // a tab click writes the hash back (guarded — replaceState keeps the
  // session history clean) so a copied URL reopens on the same tab.
  useEffect(() => {
    const applyHash = (): void => {
      const match = /^#\/agent-plugins\/(\w+)$/.exec(typeof window === 'undefined' ? '' : window.location.hash)
      if (match === null) return
      const tab = match[1] as WorkspaceTab
      if (TAB_ORDER.includes(tab)) setActive(tab)
    }
    applyHash()
    if (typeof window === 'undefined') return
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [])

  const select = (tab: WorkspaceTab): void => {
    setActive(tab)
    if (typeof window === 'undefined' || typeof window.history === 'undefined') return
    try {
      window.history.replaceState(null, '', `#/agent-plugins/${tab}`)
    } catch {
      // Sandboxed contexts may refuse history writes; the tab still switches.
    }
  }

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
    h(
      'nav',
      { className: css.tabRow, role: 'tablist' },
      TAB_ORDER.map(tab =>
        h(
          'button',
          {
            key: tab,
            type: 'button',
            role: 'tab',
            'aria-selected': active === tab,
            className: active === tab ? css.tabOn : css.tab,
            onClick: () => select(tab)
          },
          labelKeys[tab]
        )
      )
    ),
    h('div', { className: css.tabPanel, role: 'tabpanel' }, renderTab(active, t, credentials, mode))
  )
}

function renderTab(tab: WorkspaceTab, t: Translate, credentials: CredentialApi | undefined, mode: 'settings' | 'page'): ReactNode {
  switch (tab) {
    case 'market':
      return h(MarketSection, { t, mode })
    case 'skills':
      return h(UserPanelSurface, { t, kind: 'skills' })
    case 'commands':
      return h(UserPanelSurface, { t, kind: 'commands', hint: t('commandsPanelHint') })
    case 'personas':
      return h(UserPanelSurface, { t, kind: 'agents' })
    case 'mcp':
      return h(McpStatusPanel, { t, credentials })
    case 'lsp':
      return h(LspStatusPanel, { t })
  }
}
