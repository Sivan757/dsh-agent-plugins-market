import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ResourceFilterService } from '../packages/market-runtime/src/runtime/host/resource-filter-service.js'
import { ALL_SURFACES_ON } from '../packages/market-contracts/src/contracts/surface-toggles.js'

async function makeService(workspace: string): Promise<ResourceFilterService> {
  const dataRoot = await mkdtemp(join(tmpdir(), 'resource-filter-service-'))
  const changes: number[] = []
  const service = new ResourceFilterService(dataRoot, workspace, {
    onFiltersChanged: () => {
      changes.push(1)
    }
  })
  await service.reload()
  return Object.assign(service, { changes: () => changes.length })
}

describe('ResourceFilterService', () => {
  it('allows everything until an entry is denied, and only that entry', async () => {
    const service = await makeService('/ws/service-alpha')
    expect(service.allowsEntry('mcp', 'mcp:alpha__db')).toBe(true)
    await service.setEntry('mcp', 'mcp:alpha__db', false)
    expect(service.allowsEntry('mcp', 'mcp:alpha__db')).toBe(false)
    // A sibling entry on the same face, and the same id on another face, stay on.
    expect(service.allowsEntry('mcp', 'mcp:beta__api')).toBe(true)
    expect(service.allowsEntry('skills', 'mcp:alpha__db')).toBe(true)
  })

  it('removes the deny row when an entry turns back on', async () => {
    const service = await makeService('/ws/service-beta')
    await service.setEntry('skills', 'skills:dsh-doc', false)
    await service.setEntry('skills', 'skills:ponytail', false)
    expect(service.currentFilters().offEntries.skills).toHaveLength(2)
    await service.setEntry('skills', 'skills:dsh-doc', true)
    expect(service.currentFilters().offEntries.skills).toEqual(['skills:ponytail'])
    // The last re-enable drops the face key entirely.
    await service.setEntry('skills', 'skills:ponytail', true)
    expect(service.currentFilters().offEntries.skills).toBeUndefined()
  })

  it('runs the refresh hook once per write', async () => {
    const service = await makeService('/ws/service-gamma')
    await service.setEntry('lsp', 'lsp:direct/json', false)
    await service.setEntry('lsp', 'lsp:direct/json', false)
    expect((service as unknown as { changes: () => number }).changes()).toBe(2)
  })

  it('reloads the persisted state for the same workspace', async () => {
    const first = await makeService('/ws/service-delta')
    await first.setEntry('mcp', 'mcp:alpha__db', false)
    // A second service over the same data root sees the same deny set.
    const dataRootOf = (service: ResourceFilterService): string => (service as unknown as { dataRoot: string }).dataRoot
    const second = new ResourceFilterService(dataRootOf(first), '/ws/service-delta', { onFiltersChanged: () => {} })
    await second.reload()
    expect(second.allowsEntry('mcp', 'mcp:alpha__db')).toBe(false)
  })

  it('applies a favorite snapshot as one coherent write', async () => {
    const service = await makeService('/ws/service-epsilon')
    await service.applyFilters({ ...ALL_SURFACES_ON, lsp: false }, { mcp: ['mcp:alpha__db'] })
    expect(service.currentFilters()).toEqual({
      toggles: { ...ALL_SURFACES_ON, lsp: false },
      offEntries: { mcp: ['mcp:alpha__db'] }
    })
  })
})
