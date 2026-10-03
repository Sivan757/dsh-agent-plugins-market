import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.js'
import { shouldUseLegacyPageMode } from '../src/client/workspace/page-mode-selection.js'

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
    expect(tabKeys.map(key => zh[key])).toEqual(['市场', '技能', '快捷指令', '专家', '连接器', '代码智能'])
    expect(tabKeys.map(key => en[key])).toEqual(['Market', 'Skills', 'Shortcuts', 'Experts', 'Connectors', 'Code intelligence'])
    for (const labels of [zh, en]) {
      expect(labels.commandsSection).toBe(labels.workspaceTabCommands)
      expect(labels.agentsSection).toBe(labels.workspaceTabPersonas)
      expect(labels.mcpStatusTitle).toBe(labels.workspaceTabMcp)
      expect(labels.lspStatusTitle).toBe(labels.workspaceTabLsp)
      expect(labels.mcpStatusSubtitle).toContain('MCP')
      expect(labels.lspStatusSubtitle).toContain('LSP')
    }
    expect(zh.detailCommand).toBe('命令')
    expect(en.detailCommand).toBe('Command')
  })

  it('uses the legacy page only when the settings page is unavailable', () => {
    expect(shouldUseLegacyPageMode(false, true)).toBe(true)
    expect(shouldUseLegacyPageMode(true, true)).toBe(false)
    expect(shouldUseLegacyPageMode(false, false)).toBe(false)
  })
})
