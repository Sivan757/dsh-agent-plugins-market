import { describe, expect, it } from 'vitest'
import { pickBilingualDescription } from '../src/client/ui/bilingual-text.js'
import type { Translate } from '../src/client/index.js'

/** A probe translator: 'zh' resolves the probe key to the Chinese marker. */
const zhT: Translate = key => (key === 'localeProbeLang' ? '中文' : '')
const enT: Translate = key => (key === 'localeProbeLang' ? 'English' : '')

describe('pickBilingualDescription', () => {
  it('returns undefined for missing descriptions', () => {
    expect(pickBilingualDescription(undefined, zhT)).toBeUndefined()
    expect(pickBilingualDescription(null, zhT)).toBeUndefined()
  })

  it('picks the Chinese segment under the zh locale (middot separator)', () => {
    expect(pickBilingualDescription('DSH 一次性只读旁问插件 · One-shot read-only side-ask plugin', zhT)).toBe('DSH 一次性只读旁问插件')
  })

  it('picks the English segment under the en locale (middot separator)', () => {
    expect(pickBilingualDescription('DSH 一次性只读旁问插件 · One-shot read-only side-ask plugin', enT)).toBe('One-shot read-only side-ask plugin')
  })

  it('supports the dash separator and either segment order', () => {
    expect(pickBilingualDescription('One-shot read-only side-ask plugin - DSH 一次性只读旁问插件', zhT)).toBe('DSH 一次性只读旁问插件')
    expect(pickBilingualDescription('管理套件来源 - Manage suite sources', enT)).toBe('Manage suite sources')
  })

  it('passes monolingual strings through untouched', () => {
    expect(pickBilingualDescription('Manage suite sources and installs', zhT)).toBe('Manage suite sources and installs')
    expect(pickBilingualDescription('管理套件来源与安装', enT)).toBe('管理套件来源与安装')
  })

  it('passes two same-language segments through untouched', () => {
    expect(pickBilingualDescription('Fast and simple · works everywhere', zhT)).toBe('Fast and simple · works everywhere')
  })
})
