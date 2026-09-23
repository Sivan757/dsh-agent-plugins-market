/**
 * Tests for the market plugin card's staged form: what it renders before the
 * host serves the namespace, how a staged edit differs from a committed one,
 * that resetting hands a field back to the plugin, and that a write the host
 * did not accept is reported instead of looking saved.
 */
import { describe, expect, it } from 'vitest'
import { MARKET_SETTINGS_DEFAULTS, type MarketSettings } from '../src/contracts/settings.js'
import { MarketPluginCardController } from '../src/client/plugin-card-controller.js'

/** A settings scope double: the host's mirror, with writes applied on demand. */
function scopeDouble(initial: Partial<MarketSettings> = {}, options: { writable?: boolean; ready?: boolean } = {}) {
  let value: MarketSettings = { ...MARKET_SETTINGS_DEFAULTS, ...initial }
  let user: Record<string, unknown> = { ...initial }
  let writable = options.writable ?? true
  const ready = options.ready ?? true
  const listeners = new Set<() => void>()
  /** Set by a test to make the next writes fail, as a rejected document write does. */
  let writesFail = false
  const scope = {
    getSnapshot: () => ({
      status: ready ? ('ready' as const) : ('loading' as const),
      value,
      base: undefined,
      user,
      revision: 1,
      writable,
      mode: 'host' as const
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: async (field: string, next: unknown): Promise<boolean> => {
      if (writesFail) throw new Error('write rejected')
      user = { ...user, [field]: next }
      value = { ...value, [field]: next }
      for (const listener of listeners) listener()
      return true
    },
    unset: async (field: string): Promise<boolean> => {
      if (writesFail) throw new Error('write rejected')
      const next = { ...user }
      delete next[field]
      user = next
      value = { ...value, [field]: MARKET_SETTINGS_DEFAULTS[field as keyof MarketSettings] }
      for (const listener of listeners) listener()
      return true
    },
    mutate: async () => true,
    setWritable: (next: boolean) => {
      writable = next
    },
    setWritesFail: (next: boolean) => {
      writesFail = next
    }
  }
  return scope
}

function controllerFor(scope: ReturnType<typeof scopeDouble>) {
  return controllerWith(scope, true)
}

/** A controller whose probe reports the host MCP client as present or missing. */
function controllerWith(scope: ReturnType<typeof scopeDouble>, hostClientAvailable: boolean) {
  const controller = new MarketPluginCardController(scope, async () => ({
    backend: 'builtin' as const,
    hostClient: { available: hostClientAvailable },
    downloadRegion: { setting: 'auto' as const, effective: 'global' as const }
  }))
  return { controller, face: controller.inject(), state: () => controller.inject().hooks.marketCard.getSnapshot() }
}

/** Let the controller's fire-and-forget save settle. */
const settle = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('market plugin card form', () => {
  it('renders nothing until the host serves the namespace', () => {
    const scope = scopeDouble({}, { ready: false })
    const { state } = controllerFor(scope)
    expect(state().available).toBe(false)
  })

  it('reads a stored section through the contract defaults and marks overrides', () => {
    const scope = scopeDouble({ scanProjectLayouts: true })
    const { state } = controllerFor(scope)
    const snapshot = state()
    expect(snapshot.scanProjectLayouts).toEqual({ value: true, overridden: true, staged: false })
    // A field the document says nothing about shows the declared default.
    expect(snapshot.mcpEnhanced).toEqual({ value: MARKET_SETTINGS_DEFAULTS.mcpEnhanced, overridden: false, staged: false })
  })

  it('keeps a staged edit out of the document until the save, then commits it', async () => {
    const scope = scopeDouble()
    const { face, state } = controllerFor(scope)
    face.toggle('scanProjectLayouts')
    expect(state().scanProjectLayouts).toEqual({ value: true, overridden: true, staged: true })
    expect(state().dirty).toBe(true)
    // Nothing reached the document yet.
    expect(scope.getSnapshot().user).toEqual({})
    face.save()
    await settle()
    expect(scope.getSnapshot().value?.scanProjectLayouts).toBe(true)
  })

  it('drops staged edits on discard', () => {
    const scope = scopeDouble()
    const { face, state } = controllerFor(scope)
    face.toggle('feedbackEnabled')
    expect(state().dirty).toBe(true)
    face.discard()
    expect(state().dirty).toBe(false)
    expect(state().feedbackEnabled.value).toBe(MARKET_SETTINGS_DEFAULTS.feedbackEnabled)
  })

  it('hands an overridden field back to the plugin on reset', async () => {
    const scope = scopeDouble({ scanProjectLayouts: true })
    const { face, state } = controllerFor(scope)
    face.resetField('scanProjectLayouts')
    face.save()
    await settle()
    expect(scope.getSnapshot().user).toEqual({})
    expect(state().scanProjectLayouts.overridden).toBe(false)
  })

  it('reports a write the host refused instead of looking saved', async () => {
    const scope = scopeDouble()
    const { face, state } = controllerFor(scope)
    scope.setWritesFail(true)
    face.toggle('autoUpdateSources')
    face.save()
    await settle()
    expect(state().failed).toBe(true)
    // The edit survives so the user can correct it rather than retype it.
    expect(state().dirty).toBe(true)
  })

  it('blocks compat mode when the host MCP client is missing', async () => {
    const { controller, face, state } = controllerWith(scopeDouble(), false)
    await controller.loadProbe()
    face.toggle('mcpEnhanced')
    expect(state().invalid).toBe(true)
  })

  it('refuses edits while the document is read-only', () => {
    const scope = scopeDouble({}, { writable: false })
    const { face, state } = controllerFor(scope)
    face.toggle('mcpEnhanced')
    expect(state().dirty).toBe(false)
  })
})
