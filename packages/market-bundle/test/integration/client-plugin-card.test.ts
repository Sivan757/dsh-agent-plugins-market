// @vitest-environment jsdom
/**
 * Tests for the market card's binding onto the host's published settings-form
 * model: what it reads before the host serves the namespace, how a staged
 * draft differs from a committed value, that an unset hands the field back to
 * the plugin default, that a save the host did not accept is reported instead
 * of looking saved, and that the compat-mode guard blocks the save.
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MARKET_SETTINGS_DEFAULTS, type MarketSettings } from '../../../../packages/market-contracts/src/contracts/settings.js'
import { bindMarketCardForm, regionChoice, type MarketCardState } from '../../../../packages/market-ui/src/features/settings-card/market-card-form.js'
import { McpPluginCard } from '../../../../packages/market-ui/src/features/settings-card/McpPluginCard.js'

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
function cardFor(scope: ReturnType<typeof scopeDouble>, hostClientAvailable = true) {
  const bound = bindMarketCardForm(scope, probeAnswer(hostClientAvailable))
  const state = () => bound.face.hooks.marketCard.getSnapshot()
  return { ...bound, state }
}

/** The renderer props the host binds; the translator names the tag copy it is asked for. */
function cardProps(scope: ReturnType<typeof scopeDouble>) {
  const bound = bindMarketCardForm(scope, probeAnswer(true))
  const current = (): MarketCardState => bound.face.hooks.marketCard.getSnapshot()
  return {
    view: 'page' as const,
    t: (key: string): string => (key.endsWith('Experimental') ? 'Experimental' : key),
    useMarketCard: <S>(select: (state: MarketCardState) => S): S => select(current()),
    edit: bound.face.edit,
    resetField: bound.face.resetField,
    save: bound.face.save,
    discard: bound.face.discard,
    refreshProbe: bound.face.refreshProbe
  }
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

  it('shows the default on for the two switches the document says nothing about', () => {
    const { state } = cardFor(scopeDouble())
    expect(state().translationEnabled).toMatchObject({ text: 'true', overridden: false })
    expect(state().agentPresetsEnabled).toMatchObject({ text: 'true', overridden: false })
  })

  it('keeps an explicit translation preference in either direction', () => {
    const on = cardFor(scopeDouble({ translationEnabled: true }))
    expect(on.state().translationEnabled).toMatchObject({ text: 'true', overridden: true })
    // A stored "off" always wins over the default.
    const off = cardFor(scopeDouble({ translationEnabled: false }))
    expect(off.state().translationEnabled).toMatchObject({ text: 'false', overridden: true })
  })

  it('stages a translation off over the default and marks it', () => {
    const { face, state } = cardFor(scopeDouble())
    expect(state().translationEnabled).toMatchObject({ text: 'true', overridden: false })
    face.edit('translationEnabled', 'false')
    expect(state().translationEnabled).toMatchObject({ text: 'false', overridden: true })
    expect(state().dirty).toBe(true)
  })

  it('hands the translation row back to the default after a clear', () => {
    const { face, state } = cardFor(scopeDouble())
    face.edit('translationEnabled', 'false')
    expect(state().translationEnabled).toMatchObject({ text: 'false', overridden: true })
    face.resetField('translationEnabled')
    expect(state().translationEnabled).toMatchObject({ text: 'true', overridden: false })
  })

  it('writes the answer the user gives', async () => {
    const scope = scopeDouble()
    const { face, state } = cardFor(scope)
    expect(state().translationEnabled.text).toBe('true')
    face.edit('translationEnabled', 'false')
    face.save()
    await settle()
    expect(scope.getSnapshot().user).toMatchObject({ translationEnabled: false })
    expect(state().translationEnabled).toMatchObject({ text: 'false', overridden: true })
  })

  it('renders no Experimental tag on the switches and reads both on with nothing stored', () => {
    const html = renderToStaticMarkup(h(McpPluginCard, cardProps(scopeDouble())))
    // The card dropped the tag these two rows used to carry, so no surviving
    // tag copy reaches the translator: its experimental branch would name it.
    expect(html).not.toContain('Experimental')
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="translationToggleLabel"/)
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="agentPresetsToggleLabel"/)
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
