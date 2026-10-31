// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { en, zh } from '../../../packages/market-ui/src/locales.js'
import { shouldUseLegacyPageMode } from '../../../packages/market-ui/src/workspace/page-mode-selection.js'

describe('Agent Plugins Market client compatibility', () => {
  it('keeps Chinese and English dictionaries in lockstep', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const key of Object.keys(zh)) {
      expect(en[key as keyof typeof en]).not.toBe('')
      expect(zh[key as keyof typeof zh]).not.toBe('')
    }
  })

  it('uses everyday names consistently across navigation and content labels', () => {
    const tabKeys = ['workspaceTabMarket', 'workspaceTabSkills', 'workspaceTabCommands', 'workspaceTabPersonas', 'workspaceTabMcp', 'workspaceTabLsp'] as const
    expect(tabKeys.map(key => zh[key])).toEqual(['市场', '技能', '快捷指令', '专家', '连接器', '语言引擎'])
    expect(tabKeys.map(key => en[key])).toEqual(['Market', 'Skills', 'Shortcuts', 'Experts', 'Connectors', 'Language Engine'])
    for (const labels of [zh, en]) {
      expect(labels.commandsSection).toBe(labels.workspaceTabCommands)
      expect(labels.agentsSection).toBe(labels.workspaceTabPersonas)
      expect(labels.mcpStatusTitle).toBe(labels.workspaceTabMcp)
      expect(labels.lspStatusTitle).toBe(labels.workspaceTabLsp)
      expect(labels.mcpStatusSubtitle).toContain('MCP')
      // The LSP subtitle keeps to the 20-character header budget, so the acronym
      // rides the action that creates a server instead of the one-line intro.
      expect(labels.lspAddTitle).toContain('LSP')
      expect(labels.lspStatusSubtitle.toLowerCase()).toMatch(/language server|语言服务器/)
    }
    expect(zh.detailCommand).toBe('命令')
    expect(en.detailCommand).toBe('Command')
  })

  it('keeps every panel intro within the header line budget', () => {
    // A panel intro sits on one line under the header. Chinese gets 20 characters,
    // English 70, and an ASCII name such as MCP or AGENTS.md counts as its visible
    // length. The market and the three user panels name their intro *Description.
    const zhLimit = 20
    const enLimit = 70
    const introKeys = [
      ...Object.keys(zh).filter(key => key.endsWith('Subtitle')),
      'navDescription',
      'skillsPanelDescription',
      'commandsPanelDescription',
      'personasPanelDescription'
    ]
    expect(introKeys).toEqual(expect.arrayContaining(['mcpStatusSubtitle', 'hooksPanelSubtitle', 'lspStatusSubtitle', 'instructionsSubtitle', 'outputStylesSubtitle']))
    for (const key of introKeys) {
      expect(Array.from(zh[key as keyof typeof zh].trim()).length, `zh ${key}`).toBeLessThanOrEqual(zhLimit)
      expect(Array.from(en[key as keyof typeof en].trim()).length, `en ${key}`).toBeLessThanOrEqual(enLimit)
    }
  })

  it('uses the legacy page only when the settings page is unavailable', () => {
    expect(shouldUseLegacyPageMode(false, true)).toBe(true)
    expect(shouldUseLegacyPageMode(true, true)).toBe(false)
    expect(shouldUseLegacyPageMode(false, false)).toBe(false)
  })
})
