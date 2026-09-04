import { describe, expect, it } from 'vitest'
import { RuntimeReconciler } from '../src/runtime/reconciler.js'

describe('RuntimeReconciler', () => {
  it('fans an empty enabled snapshot through all surfaces and disposes cleanly', async () => {
    const context = { logger: { warn: () => {} } }
    const reconciler = new RuntimeReconciler(context as never, '/tmp/dsh-agent-plugins-runtime-data')

    await expect(reconciler.reconcile([])).resolves.toEqual({ mcp: [], commands: [], hooks: [], lsp: [], errors: [] })
    await expect(reconciler.dispose()).resolves.toBeUndefined()
  })
})
