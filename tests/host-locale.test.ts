import { afterEach, describe, expect, it } from 'vitest'
import { bindHostLocale, readHostLocalePreference, readLocalePreference, setHostLocaleSource, type LocaleSettingsSource } from '../src/runtime/host-locale.js'

const unwire: Array<() => void> = []

afterEach(() => {
  for (const release of unwire.splice(0)) release()
})

/** The settings service projection: one descriptor per active profile entry. */
const projection = (entries: Array<{ ns: string; value?: unknown }>): LocaleSettingsSource => ({
  describe: () => entries.map(entry => ({ ns: entry.ns, value: entry.value }))
})

describe('host locale', () => {
  it('defaults to zh copy', () => {
    const t = bindHostLocale(undefined)
    expect(t('commandAcknowledged', { command: 'review' })).toBe('/review 已转交模型执行')
  })

  it('resolves en for en-prefixed preferences', () => {
    const t = bindHostLocale('en-US')
    expect(t('commandAcknowledged', { command: 'review' })).toBe('/review forwarded to the model for execution')
    expect(t('feedbackToolCardTitle')).toBe('File market feedback')
  })

  it('translates only the strings a person reads', () => {
    // The model-facing subagent catalog is fixed English and lives in
    // `subagent-catalog.ts`; this dictionary must not carry it.
    for (const preference of ['zh', 'en']) {
      const t = bindHostLocale(preference)
      expect(t('commandAcknowledged', { command: 'review' }).length).toBeGreaterThan(0)
      expect(t('userCommandSourceLabel').length).toBeGreaterThan(0)
      expect(t('feedbackToolCardTitle').length).toBeGreaterThan(0)
    }
  })

  it('reads the preference off the locale entry the settings service projects', () => {
    // The pinned host exposes `SettingsForms.describe()`; the `settings.get(ns)`
    // seam it once had was removed in harness 601d6761e4. Every absence is
    // `undefined`, which the dictionary reads as zh.
    expect(readHostLocalePreference(projection([{ ns: 'locale', value: { preference: 'en-GB' } }]))).toBe('en-GB')
    expect(readHostLocalePreference(projection([{ ns: 'llm-deepseek', value: { preference: 'en' } }]))).toBeUndefined()
    expect(readHostLocalePreference(projection([{ ns: 'locale', value: { preference: 42 } }]))).toBeUndefined()
    expect(readHostLocalePreference(projection([{ ns: 'locale' }]))).toBeUndefined()
    expect(readHostLocalePreference(projection([]))).toBeUndefined()
    expect(readHostLocalePreference(undefined)).toBeUndefined()
  })

  it('answers undefined until an entry wires a source, and again after it unwires', () => {
    expect(readLocalePreference()).toBeUndefined()
    const release = setHostLocaleSource(() => 'en-GB')
    unwire.push(release)
    expect(readLocalePreference()).toBe('en-GB')
    release()
    expect(readLocalePreference()).toBeUndefined()
  })

  it('keeps a newer wiring when an older disposer runs late', () => {
    // A reload can dispose the previous entry after the next one has wired its
    // own reader; the late disposer must not clear the newer wiring.
    const stale = setHostLocaleSource(() => 'en')
    const current = setHostLocaleSource(() => 'zh')
    unwire.push(current)
    stale()
    expect(readLocalePreference()).toBe('zh')
  })
})
