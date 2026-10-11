import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { createSessionExtensions } from '../packages/market-bundle/src/session-extension.js'
import { createRuntimeMounts } from '../packages/market-bundle/src/runtime-adapters.js'
import { Catalog } from '../packages/market-bundle/src/application/catalog.js'
import { RuntimeReconciler, bindHostLocale, createPanelResources, createUserPanelStores } from '../packages/market-runtime/src/index.js'

it('keeps construction inert and callers safe before the required host services exist', async () => {
  const ctx = new Context()
  const dataRoot = '/unused/session-extension-composition/data'
  const runtime = new RuntimeReconciler(ctx, dataRoot, createRuntimeMounts(ctx, dataRoot))
  const inject = vi.spyOn(ctx, 'inject')
  const catalog = new Catalog({
    onChanged: async () => {},
    userRoot: '/unused/session-extension-composition',
    dataRoot,
    agentsRoot: '/unused/session-extension-composition/agents'
  })
  const panels = createUserPanelStores(catalog.agentsRoot)
  const resources = createPanelResources(catalog, panels)
  const readUserDeclarations = vi.fn(async () => [])
  const invalidateDefaultSkills = vi.fn()
  try {
    const sessions = createSessionExtensions({ ctx, dataRoot, agentsRoot: catalog.agentsRoot, runtime, hostLocale: { t: bindHostLocale(undefined) } })
    expect(inject).not.toHaveBeenCalled()
    expect(sessions.session()).toBeUndefined()
    expect(sessions.commandRegistrations()).toEqual([])
    // No mounted source and no calling session means "unknown", not "no roles":
    // an incomplete observation cannot replace a published catalog.
    expect(await sessions.roles()).toEqual({ entries: [], complete: false })
    expect(sessions.refresh()).toBeUndefined()
    sessions.invalidate(invalidateDefaultSkills)
    expect(invalidateDefaultSkills).toHaveBeenCalledOnce()

    sessions.mount({ catalog, panels, resources, readUserDeclarations })
    expect(inject).toHaveBeenCalledWith(['agents', 'sessions', 'sessionQuery', 'tools'], expect.any(Function))
    expect(readUserDeclarations).not.toHaveBeenCalled()
    expect(sessions.session()).toBeUndefined()
    expect(await sessions.roles()).toEqual({ entries: [], complete: false })
    await ctx.fiber.dispose()
    expect(sessions.commandRegistrations()).toEqual([])
    expect(sessions.refresh()).toBeUndefined()
  } finally {
    inject.mockRestore()
    catalog.dispose()
    await runtime.dispose()
    await ctx.fiber.dispose()
  }
})
