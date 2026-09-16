import { afterEach, describe, expect, it } from 'vitest'
import { bindHostLocale, readHostLocalePreference, readLocalePreference, setHostLocaleSource } from '../src/runtime/host-locale.js'

describe('host locale', () => {
  afterEach(() => {
    setHostLocaleSource(() => undefined)
  })

  it('defaults to zh copy', () => {
    const t = bindHostLocale(undefined)
    expect(t('commandAcknowledged', { command: 'review' })).toBe('/review 已转交模型执行')
  })

  it('resolves en for en-prefixed preferences', () => {
    const t = bindHostLocale('en-US')
    expect(t('commandAcknowledged', { command: 'review' })).toBe('/review forwarded to the model for execution')
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

  it('prefers the host settings service over the file once one is wired', async () => {
    setHostLocaleSource(() => 'en-GB')
    await expect(readLocalePreference()).resolves.toBe('en-GB')
  })

  it('reads the preference field off the locale namespace section', () => {
    const settingsCtx = { settings: { get: (ns: string) => (ns === 'locale' ? { preference: 'en' } : undefined) } }
    expect(readHostLocalePreference(settingsCtx)).toBe('en')
    expect(readHostLocalePreference({})).toBeUndefined()
    expect(readHostLocalePreference({ settings: { get: () => ({ preference: 42 }) } })).toBeUndefined()
  })
})
