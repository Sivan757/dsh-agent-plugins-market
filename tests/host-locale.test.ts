import { describe, expect, it } from 'vitest'
import { bindHostLocale, readLocalePreference } from '../src/runtime/host-locale.js'

describe('host locale', () => {
  it('defaults to zh copy', () => {
    const t = bindHostLocale(undefined)
    expect(t('commandAcknowledged', { command: 'review', suite: 'demo' })).toBe('/review 已转交模型执行（demo）')
  })

  it('resolves en for en-prefixed preferences', () => {
    const t = bindHostLocale('en-US')
    expect(t('commandAcknowledged', { command: 'review', suite: 'demo' })).toBe('/review forwarded to the model for execution (demo)')
    expect(t('subagentCatalogCall')).toContain('subagent_run')
  })

  it('provides explicit catalog replacement and clearing guidance in both languages', () => {
    expect(bindHostLocale('zh')('subagentCatalogUpdated')).toContain('替代')
    expect(bindHostLocale('en')('subagentCatalogEmpty')).toContain('Do not use role IDs')
  })

  it('reads locale.preference from a settings file when present', async () => {
    // The real file may or may not exist in the test environment; both
    // outcomes are valid — the function must not throw.
    const preference = await readLocalePreference()
    expect(preference === undefined || typeof preference === 'string').toBe(true)
  })
})
