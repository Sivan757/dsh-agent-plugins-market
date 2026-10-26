import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ResourceFilterService } from '../../../../packages/market-runtime/src/runtime/host/resource-filter-service.js'
import { loadResourceFilters } from '../../../../packages/market-runtime/src/application/state/workspace-policy.js'
import { ALL_SURFACES_ON } from '../../../../packages/market-contracts/src/contracts/surface-toggles.js'
import { resolveSwitchSettleMs, SWITCH_SETTLE_MS } from '../../../../packages/market-catalog/src/index.js'

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

    // The pass is never cancelled by the bound: it still settles, and awaiting
    // it is the fact, not a microtask-order guess.
    released()
    await pass
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
describe('resolveSwitchSettleMs', () => {
  it('keeps the default when nothing is configured', () => {
    expect(resolveSwitchSettleMs(undefined)).toBe(SWITCH_SETTLE_MS)
  })

  it('accepts zero, which means answer at once', () => {
    expect(resolveSwitchSettleMs(0)).toBe(0)
  })

  it('fails loud on a value that is not a usable number of milliseconds', () => {
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => resolveSwitchSettleMs(value)).toThrow('switchSettleMs must be a finite number of milliseconds that is zero or greater')
  })

  it('answers at once when a zero budget is in force, and still stores the choice', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'resource-filter-budget-'))
    const workspace = '/ws/budget-zero'
    const reports: string[] = []
    let settled = false
    const service = new ResourceFilterService(
      dataRoot,
      workspace,
      {
        onFiltersChanged: async () => {
          await new Promise(resolve => setTimeout(resolve, 50))
          settled = true
        },
        onPipelineReport: message => reports.push(message)
      },
      resolveSwitchSettleMs(0)
    )
    await service.reload()

    const started = performance.now()
    const answered = await service.setSurface('lsp', false)
    const waitedMs = performance.now() - started

    expect(waitedMs).toBeLessThan(45)
    expect(answered).toEqual({ ...ALL_SURFACES_ON, lsp: false })
    expect(settled).toBe(false)
    expect((await loadResourceFilters(dataRoot, workspace)).toggles.lsp).toBe(false)
    // The pipeline keeps running; a zero budget only stops the waiting.
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(settled).toBe(true)
    // A zero budget never reports an overrun: waiting was never promised.
    expect(reports).toEqual([])
  })
})
