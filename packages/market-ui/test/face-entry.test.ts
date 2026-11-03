/**
 * The two surfaces build a row once.
 *
 * A row is drawn twice in this product: on its own settings face and inside the preset manager.
 * These tests pin the parts they must agree on (the failure sentence, the facts, the switch's
 * existence) and the two places they deliberately differ (the state word and what an
 * unswitchable row says), so a future edit to one surface cannot silently change the other.
 */
import { describe, expect, it } from 'vitest'
import { buildFaceEntry, liveFailureSentence, type FaceRowFacts } from '../../market-ui/src/ui/face-entry.js'
import type { Translate } from '../../market-ui/src/i18n.js'

const t: Translate = (key, params) => (params === undefined ? String(key) : [String(key), ...Object.values(params).map(value => String(value))].join(' '))

/** A failed connector, seen the same way by both surfaces. */
const failed: FaceRowFacts = {
  surface: 'mcp',
  provider: 'suite',
  id: 'mcp:cloudflare',
  name: 'cloudflare',
  tag: 'mcpPlugin',
  meta: 'streamable-http',
  counts: [{ label: 'mcpTools', count: 4 }],
  showSwitch: true,
  on: false,
  live: { state: 'failed', code: 'connection-timeout', reason: '连接超时', causes: ['endpoint 无响应'], mountMs: 10_000 },
  liveWord: 'mcpFailed'
}

describe('face entry', () => {
  it('states one failure sentence for both surfaces', () => {
    const sentence = liveFailureSentence(t, failed.live)
    // The builder classified no guidance for this code, so the recorded reason stands; what
    // matters is that both surfaces read the identical sentence.
    expect(sentence).toContain('连接超时')
    // The time the attempt took rides behind the advice, so a slow failure is visible on the
    // card rather than only in the dialog.
    expect(sentence).toContain('10.0s')
    const settings = buildFaceEntry(t, failed, 'settings')
    const resolve = buildFaceEntry(t, failed, 'resolve')
    expect(settings.warning).toBe(resolve.warning)
    expect(settings.warning).toBe(sentence)
  })

  it('keeps the facts identical and the state words apart', () => {
    const settings = buildFaceEntry(t, failed, 'settings')
    const resolve = buildFaceEntry(t, failed, 'resolve')

    expect(settings.id).toBe(resolve.id)
    expect(settings.tag).toBe(resolve.tag)
    expect(settings.meta).toBe(resolve.meta)
    expect(settings.counts).toEqual(resolve.counts)
    // The face names what the row is doing; a preset names whether it is in the preset.
    expect(settings.state).toBe('error')
    expect(settings.stateLabel).toBe('mcpFailed')
    expect(resolve.state).toBe('disabled')
    expect(resolve.stateLabel).toBe('disabledLabel')
    // Both offer the switch, with the verb that does something from that row's current place.
    expect(settings.toggleLabel).toBe('enable')
    expect(resolve.toggleLabel).toBe('enable')
  })

  it('draws no switch where the surface has none, and says where the row stands', () => {
    const managed: FaceRowFacts = { ...failed, showSwitch: false, on: true, live: undefined, liveWord: undefined }
    const settings = buildFaceEntry(t, managed, 'settings')
    expect(settings.hideToggle).toBe(true)
    expect(settings.toggleLabel).toBeUndefined()
    expect(settings.stateLabel).toBe('enabledLabel')
  })

  it('paints a host-managed row down, and a row with nothing behind it as a warning', () => {
    const hosted: FaceRowFacts = { ...failed, live: undefined, liveWord: undefined, switchability: 'global-only', note: 'epGlobalManaged', unswitchableWord: 'epOn' }
    expect(buildFaceEntry(t, hosted, 'resolve').state).toBe('disabled')
    expect(buildFaceEntry(t, hosted, 'resolve').stateLabel).toBe('epOn')

    const absent: FaceRowFacts = { ...failed, live: undefined, liveWord: undefined, switchability: 'unavailable', note: 'epUnavailable' }
    const entry = buildFaceEntry(t, absent, 'resolve')
    expect(entry.state).toBe('warning')
    expect(entry.stateLabel).toBe('stateUnavailable')
    expect(entry.warning).toBe('epUnavailable')
  })

  it('does not invent a failure for a row that is simply switched off', () => {
    const off: FaceRowFacts = { ...failed, live: { state: 'disabled', reason: 'user chose this' } }
    expect(liveFailureSentence(t, off.live)).toBeUndefined()
    expect(buildFaceEntry(t, off, 'settings').warning).toBeUndefined()
  })
})
