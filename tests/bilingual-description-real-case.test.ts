import { describe, expect, it } from 'vitest'
import { pickBilingualDescription } from '../src/client/features/market/bilingual-description.js'
import type { Translate } from '../src/client/index.js'

const zhT: Translate = key => (key === 'localeProbeLang' ? '中文' : '')
const enT: Translate = key => (key === 'localeProbeLang' ? 'English' : '')

// The exact string @michengai/dsh-btw ships, which the objective named as the
// reference for the bilingual form layer 1 has to handle.
const BTW =
  'DSH 一次性只读旁问插件：基于当前上下文回答，独立气泡，不执行工具 · One-shot read-only side-ask plugin: answers from current context in an independent bubble, no tool execution'

describe('layer 1 against the real dsh-btw description', () => {
  it('takes the Chinese half in zh', () => {
    const out = pickBilingualDescription(BTW, zhT)
    expect(out).toBe('DSH 一次性只读旁问插件：基于当前上下文回答，独立气泡，不执行工具')
    expect(/\p{Script=Han}/u.test(out ?? '')).toBe(true)
    expect(out).not.toContain('One-shot')
  })

  it('takes the English half in en', () => {
    const out = pickBilingualDescription(BTW, enT)
    expect(out).toBe('One-shot read-only side-ask plugin: answers from current context in an independent bubble, no tool execution')
    expect(out).not.toContain('旁问')
  })
})
