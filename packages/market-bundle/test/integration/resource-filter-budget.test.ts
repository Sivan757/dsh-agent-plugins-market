import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ResourceFilterService } from '../../../../packages/market-runtime/src/runtime/host/resource-filter-service.js'
import { loadResourceFilters } from '../../../../packages/market-runtime/src/application/state/workspace-policy.js'
import { ALL_SURFACES_ON } from '../../../../packages/market-contracts/src/contracts/surface-toggles.js'
import { SWITCH_SETTLE_MS } from '../../../../packages/market-catalog/src/index.js'

describe('ResourceFilterService switch budget', () => {
  it('answers once the write lands when the pass is slower than the budget, and reports the overrun', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'resource-filter-budget-'))
    const workspace = '/ws/budget-alpha'
    const reports: string[] = []
    let released!: () => void
    const pass = new Promise<void>(resolve => {
      released = resolve
    })
    const service = new ResourceFilterService(dataRoot, workspace, {
      onFiltersChanged: () => pass,
      onPipelineReport: message => reports.push(message)
    })
    await service.reload()

    const started = performance.now()
    const answered = await service.setSurface('mcp', false)
    const waitedMs = performance.now() - started

    // The answer came from the budget, not from the pass.
    expect(waitedMs).toBeLessThan(SWITCH_SETTLE_MS + 800)
    expect(answered).toEqual({ ...ALL_SURFACES_ON, mcp: false })
    expect(reports).toEqual([expect.stringContaining('still running after ' + String(SWITCH_SETTLE_MS) + 'ms')])

    // The write is durable before the answer, so a fresh read sees the switch off.
    expect((await loadResourceFilters(dataRoot, workspace)).toggles.mcp).toBe(false)

    // The pass is never cancelled by the bound.
    let settled = false
    void pass.then(() => {
      settled = true
    })
    released()
    await Promise.resolve()
    expect(settled).toBe(true)
  })

  it('keeps reporting a pass that fails inside the budget to the caller', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'resource-filter-budget-'))
    const reports: string[] = []
    const service = new ResourceFilterService(dataRoot, '/ws/budget-beta', {
      onFiltersChanged: () => {
        throw new Error('mount pass exploded')
      },
      onPipelineReport: message => reports.push(message)
    })
    await service.reload()

    await expect(service.setSurface('lsp', false)).rejects.toThrow('mount pass exploded')
    expect(reports).toEqual([])
    // The stored switch is not rolled back by a pipeline failure.
    expect((await loadResourceFilters(dataRoot, '/ws/budget-beta')).toggles.lsp).toBe(false)
  })

  it('reports a pass that fails after the switch answered', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'resource-filter-budget-'))
    const reports: string[] = []
    let fail!: (error: Error) => void
    const pass = new Promise<void>((_resolve, reject) => {
      fail = reject
    })
    pass.catch(() => undefined)
    const service = new ResourceFilterService(dataRoot, '/ws/budget-delta', {
      onFiltersChanged: () => pass,
      onPipelineReport: message => reports.push(message)
    })
    await service.reload()

    await service.setSurface('mcp', false)
    expect(reports).toEqual([expect.stringContaining('still running after')])

    fail(new Error('mount pass exploded late'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(reports).toEqual([expect.stringContaining('still running after'), expect.stringContaining('mount pass exploded late')])
  })

  it('waits for a pass that settles inside the budget', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'resource-filter-budget-'))
    const order: string[] = []
    const service = new ResourceFilterService(dataRoot, '/ws/budget-gamma', {
      onFiltersChanged: async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
        order.push('pass settled')
      },
      onPipelineReport: message => order.push('reported: ' + message)
    })
    await service.reload()

    await service.setSurface('skills', false)
    order.push('switch answered')

    expect(order).toEqual(['pass settled', 'switch answered'])
  })
})
