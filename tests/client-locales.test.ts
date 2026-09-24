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

  it('uses the legacy page only when the settings page is unavailable', () => {
    expect(shouldUseLegacyPageMode(false, true)).toBe(true)
    expect(shouldUseLegacyPageMode(true, true)).toBe(false)
    expect(shouldUseLegacyPageMode(false, false)).toBe(false)
  })
})
