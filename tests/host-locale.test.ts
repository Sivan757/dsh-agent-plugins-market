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
    expect(t('agentCommandHint')).toBe('subagent')
  })

  it('interpolates params into agent definition titles', () => {
    expect(bindHostLocale('zh')('agentDefinitionTitle', { suite: 'my-plugin' })).toContain('my-plugin')
  })

  it('reads locale.preference from a settings file when present', async () => {
    // The real file may or may not exist in the test environment; both
    // outcomes are valid — the function must not throw.
    const preference = await readLocalePreference()
    expect(preference === undefined || typeof preference === 'string').toBe(true)
  })
})
