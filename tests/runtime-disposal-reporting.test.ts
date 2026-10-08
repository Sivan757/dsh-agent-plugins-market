import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeReconciler } from '../packages/market-runtime/src/runtime/core/reconciler.js'
import { McpMountRegistry } from '../packages/market-mcp/src/runtime/mcp/mcp-mounts.js'
import { LspMountRegistry } from '../packages/market-lsp/src/runtime/lsp/lsp-mounts.js'
import { createRuntimeMounts } from '../packages/market-bundle/src/runtime-adapters.js'

afterEach(() => vi.restoreAllMocks())

it('attempts every adapter teardown and reports failure after all have settled', async () => {
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const mcp = vi.spyOn(McpMountRegistry.prototype, 'disposeAll').mockRejectedValue(new Error('unmount failed'))
  const lsp = vi.spyOn(LspMountRegistry.prototype, 'disposeAll').mockImplementation(async () => {
    await held
  })
  const context = { logger: { warn: vi.fn() } }
  const runtime = new RuntimeReconciler(context as never, '/unused/disposal-test', createRuntimeMounts(context as never, '/unused/disposal-test'))
  const disposal = runtime.dispose()
  let settled = false
  const observed = disposal.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  try {
    await vi.waitFor(() => expect(lsp).toHaveBeenCalledOnce())
    expect(mcp).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    expect(runtime.dispose()).toBe(disposal)
  } finally {
    release()
  }
  await expect(disposal).rejects.toThrow('runtime disposal failed: unmount failed')
  await observed
  expect(settled).toBe(true)
})
