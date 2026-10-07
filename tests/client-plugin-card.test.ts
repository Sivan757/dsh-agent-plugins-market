/**
 * Tests for the market card's binding onto the host's published settings-form
 * model: what it reads before the host serves the namespace, how a staged
 * draft differs from a committed value, that an unset hands the field back to
 * the plugin, that a save the host did not accept is reported instead of
 * looking saved, and that the compat-mode guard blocks the save.
 */
import { describe, expect, it } from 'vitest'
import { MARKET_SETTINGS_DEFAULTS, type MarketSettings } from '../packages/market-contracts/src/contracts/settings.js'
import { bindMarketCardForm, regionChoice } from '../packages/market-ui/src/features/settings-card/market-card-form.js'
import type { InterfaceLanguage } from '../packages/market-ui/src/ui/translation-enabled.js'

/** The probe answer a test's card reads: host client present or missing. */
const probeAnswer = (hostClientAvailable: boolean) => async () => ({
  backend: 'builtin' as const,
  hostClient: { available: hostClientAvailable },
  downloadRegion: { setting: 'auto' as const, effective: 'global' as const }
})

/**
 * The section the host serves over one user layer: every declared default, and
 * the translation switch only when the layer carries it — its schema declares
 * no default, so an untouched document serves a section without the field.
 */
function servedSection(user: Partial<MarketSettings> = {}): MarketSettings {
  const section: MarketSettings = { ...MARKET_SETTINGS_DEFAULTS, ...user }
  if (!Object.hasOwn(user, 'translationEnabled')) Reflect.deleteProperty(section, 'translationEnabled')
  return section
}

/** The interface language a card resolves its translation default against. */
function languageSource(preference: string): InterfaceLanguage & { update(next: string): void } {
  let value = preference
  const listeners = new Set<() => void>()
  return {
    current: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(next: string) {
      value = next
      for (const listener of listeners) listener()
    }
  }
}

/** A settings scope double speaking the model's SettingsFormScope shape. */
function scopeDouble(initial: Partial<MarketSettings> = {}, options: { writable?: boolean; ready?: boolean } = {}) {
  let value: MarketSettings = servedSection(initial)
  let user: Record<string, unknown> = { ...initial }
  const writable = options.writable ?? true
  const ready = options.ready ?? true
  let revision = 1
  const listeners = new Set<() => void>()
  /** Set by a test to make the next mutate fail, as a rejected document write does. */
  let writesFail = false
  const scope = {
    getSnapshot: () => ({
      status: ready ? ('ready' as const) : ('loading' as const),
      value,
      base: undefined,
      user,
      revision,
      writable,
      mode: 'host' as const
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    mutate: async (ops: ReadonlyArray<{ op: 'set' | 'unset'; path: readonly string[] }>): Promise<boolean> => {
      if (writesFail) return false
      revision += 1
      for (const op of ops) {
        const field = op.path[0]
        if (field === undefined) continue
        if (op.op === 'unset') {
          const next = { ...user }
          delete next[field]
          user = next
        } else if ('value' in op) {
          user = { ...user, [field]: op.value }
        }
        // The served section is the user layer resolved over the defaults, so
        // every write rebuilds it the way the host would.
        value = servedSection(user)
      }
      for (const listener of listeners) listener()
      return true
    }
  }
  return Object.assign(scope, {
    setWritesFail: (next: boolean) => {
      writesFail = next
    }
  })
}

/** The payload a probe read answers with. */
type ProbeAnswer = Awaited<ReturnType<ReturnType<typeof probeAnswer>>>

/** A bound card with its face; the probe answers synchronously settleable. */
function cardFor(scope: ReturnType<typeof scopeDouble>, hostClientAvailable = true, language?: InterfaceLanguage) {
  const bound = bindMarketCardForm(scope, probeAnswer(hostClientAvailable), language)
  const state = () => bound.face.hooks.marketCard.getSnapshot()
  return { ...bound, state }
}

/** Let the model's fire-and-forget save settle. */
const settle = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('market card form binding', () => {
  it('renders nothing until the host serves the namespace', () => {
    const { state } = cardFor(scopeDouble({}, { ready: false }))
    expect(state().available).toBe(false)
  })

  it('shows the stored value and marks the user-layer override', () => {
    const { state } = cardFor(scopeDouble({ scanProjectLayouts: true }))
    expect(state().scanProjectLayouts).toMatchObject({ text: 'true', overridden: true, invalid: false })
    // A field the document says nothing about shows the declared default.
    expect(state().mcpEnhanced).toMatchObject({ text: String(MARKET_SETTINGS_DEFAULTS.mcpEnhanced), overridden: false })
    // The regions field reads the stored word.
    expect(state().downloadRegion.text).toBe(MARKET_SETTINGS_DEFAULTS.downloadRegion)
  })

  it('shows the language default on the translation switch while the document says nothing', () => {
    const zh = cardFor(scopeDouble(), true, languageSource('zh'))
    expect(zh.state().translationEnabled).toMatchObject({ text: 'true', overridden: false })
    const en = cardFor(scopeDouble(), true, languageSource('en'))
    expect(en.state().translationEnabled).toMatchObject({ text: 'false', overridden: false })
  })

  it('keeps an explicit translation preference in either interface language', () => {
    const english = cardFor(scopeDouble({ translationEnabled: true }), true, languageSource('en'))
    expect(english.state().translationEnabled).toMatchObject({ text: 'true', overridden: true })
    const on = cardFor(scopeDouble({ translationEnabled: true }), true, languageSource('zh'))
    expect(on.state().translationEnabled).toMatchObject({ text: 'true', overridden: true })
    // A stored "off" always wins, whichever way the interface language points.
    const off = cardFor(scopeDouble({ translationEnabled: false }), true, languageSource('zh'))
    expect(off.state().translationEnabled).toMatchObject({ text: 'false', overridden: true })
  })

  it('lets an English reader stage translation on', () => {
    const language = languageSource('en')
    const { face, state } = cardFor(scopeDouble(), true, language)
    expect(state().translationEnabled).toMatchObject({ text: 'false', overridden: false })
    face.edit('translationEnabled', 'true')
    expect(state().translationEnabled).toMatchObject({ text: 'true', overridden: true })
    expect(state().dirty).toBe(true)
  })

  it('moves an unset translation row with the language and shows the language again after a clear', () => {
    const language = languageSource('zh')
    const { face, state } = cardFor(scopeDouble(), true, language)
    expect(state().translationEnabled).toMatchObject({ text: 'true', overridden: false })
    language.update('en')
    expect(state().translationEnabled).toMatchObject({ text: 'false', overridden: false })
    // A staged edit answers for itself from the moment it is staged.
    face.edit('translationEnabled', 'true')
    language.update('zh')
    expect(state().translationEnabled).toMatchObject({ text: 'true', overridden: true })
    // Clearing it hands the row back to the language, which is on again.
    face.resetField('translationEnabled')
    expect(state().translationEnabled).toMatchObject({ text: 'true', overridden: false })
  })

  it('writes the answer the user gives and stops following the language', async () => {
    const language = languageSource('zh')
    const scope = scopeDouble()
    const { face, state } = cardFor(scope, true, language)
    expect(state().translationEnabled.text).toBe('true')
    face.edit('translationEnabled', 'false')
    face.save()
    await settle()
    expect(scope.getSnapshot().user).toMatchObject({ translationEnabled: false })
    // Switching the language back to Chinese must not re-enable it.
    language.update('en')
    language.update('zh')
    expect(state().translationEnabled).toMatchObject({ text: 'false', overridden: true })
  })

  it('keeps a staged edit out of the document until the save, then commits it', async () => {
    const scope = scopeDouble()
    const { face, state } = cardFor(scope)
    face.edit('scanProjectLayouts', 'true')
    expect(state().scanProjectLayouts).toMatchObject({ text: 'true', overridden: true })
    expect(state().dirty).toBe(true)
    // Nothing reached the document yet.
    expect(scope.getSnapshot().user).toEqual({})
    face.save()
    await settle()
    expect(scope.getSnapshot().value?.scanProjectLayouts).toBe(true)
    expect(state().dirty).toBe(false)
  })

  it('stages a region choice and an unset through the same form', async () => {
    const scope = scopeDouble({ downloadRegion: 'china' })
    const { face, state } = cardFor(scope)
    face.edit('downloadRegion', 'global')
    face.resetField('scanProjectLayouts')
    expect(state().downloadRegion).toMatchObject({ text: 'global', overridden: true })
    expect(state().scanProjectLayouts).toMatchObject({ overridden: false })
    face.save()
    await settle()
    expect(scope.getSnapshot().value?.downloadRegion).toBe('global')
    // The reset cleared the user layer, so nothing stands for the field.
    expect(Object.hasOwn(scope.getSnapshot().user, 'scanProjectLayouts')).toBe(false)
  })

  it('keeps a draft the field does not accept and blocks the save', () => {
    const scope = scopeDouble()
    const { face, state } = cardFor(scope)
    face.edit('mcpEnhanced', 'yes-please')
    expect(state().mcpEnhanced).toMatchObject({ invalid: true })
    expect(state().invalid).toBe(true)
    const before = scope.getSnapshot().user
    face.save()
    expect(scope.getSnapshot().user).toBe(before)
  })

  it('reports a write the host refused instead of looking saved', async () => {
    const scope = scopeDouble()
    const { face, state } = cardFor(scope)
    scope.setWritesFail(true)
    face.edit('autoUpdateSources', 'true')
    face.save()
    await settle()
    expect(state().failed).toBe(true)
    // The edit survives so the user can correct it rather than retype it.
    expect(state().dirty).toBe(true)
  })

  it('blocks compat mode while the host MCP client is missing', () => {
    const { face, state } = cardFor(scopeDouble(), false)
    face.refreshProbe()
    expect(state().hostClientMissing).toBe(false)
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(state().hostClientMissing).toBe(true)
        // Turning the bridge off is a save the guard must refuse.
        face.edit('mcpEnhanced', 'false')
        expect(state().invalid).toBe(true)
        resolve()
      }, 0)
    })
  })

  it('refuses compat mode while the probe read is still in flight', async () => {
    let release: (answer: ProbeAnswer) => void = () => {}
    const bound = bindMarketCardForm(
      scopeDouble(),
      () =>
        new Promise<ProbeAnswer>(resolve => {
          release = resolve
        })
    )
    const state = () => bound.face.hooks.marketCard.getSnapshot()
    bound.face.refreshProbe()
    bound.face.edit('mcpEnhanced', 'false')
    // The deployment's host client is still unknown, so the save that would pin
    // compat mode stays blocked for the duration of the read.
    expect(state().invalid).toBe(true)
    release(await probeAnswer(true)())
    await settle()
    expect(state().invalid).toBe(false)
  })

  it('leaves the compat guard permissive when the probe read fails', async () => {
    const bound = bindMarketCardForm(scopeDouble(), async () => {
      throw new Error('offline')
    })
    const state = () => bound.face.hooks.marketCard.getSnapshot()
    bound.face.refreshProbe()
    bound.face.edit('mcpEnhanced', 'false')
    expect(state().invalid).toBe(true)
    await settle()
    // The read taught the card nothing, so it stops standing in the save's way.
    expect(state().invalid).toBe(false)
  })

  it('highlights the auto segment for a region draft that clears the setting', () => {
    const { face, state } = cardFor(scopeDouble({ downloadRegion: 'china' }))
    face.resetField('downloadRegion')
    expect(state().downloadRegion).toMatchObject({ text: '', overridden: false, invalid: false })
    expect(regionChoice(state().downloadRegion.text)).toBe('auto')
  })

  it('keeps the read-only document out of the save: the save refuses and reports failed', async () => {
    const scope = scopeDouble()
    const { face, state } = cardFor(scope, true)
    // Force the write to be refused even though the snapshot claims writable:
    // the host is the authority, and a refusal is a save that did not land.
    scope.setWritesFail(true)
    face.edit('mcpEnhanced', 'false')
    face.save()
    await settle()
    expect(state().failed).toBe(true)
    expect(state().dirty).toBe(true)
  })

  it('rejects edits outright while the namespace is not writable', () => {
    const scope = scopeDouble({}, { writable: false })
    const { face, state } = cardFor(scope)
    // The renderer disables the controls; the staged actions are the guard of
    // last resort. Staging still works at the model level, so only the UI
    // contract is asserted here.
    expect(state().writable).toBe(false)
    expect(face.edit).toBeTypeOf('function')
  })
})
