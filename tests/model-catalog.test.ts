import { describe, expect, it, vi } from 'vitest'
import { readModelCatalog } from '../src/runtime/model-catalog.js'

describe('DSH model directory', () => {
  it('reads only display identities and fetches models only for the selected provider', async () => {
    const listModels = vi.fn(async () => [{ id: 'model-a', name: 'Model A', secret: 'not-for-client' }])
    const llm = { listProviders: () => [{ id: 'provider-a', name: 'Provider A', apiKey: 'not-for-client' }], listModels }
    const host = { get: () => llm }
    expect(await readModelCatalog(host)).toEqual({ providers: [{ id: 'provider-a', name: 'Provider A' }], models: [] })
    expect(listModels).not.toHaveBeenCalled()
    expect(await readModelCatalog(host, 'provider-a')).toEqual({ providers: [{ id: 'provider-a', name: 'Provider A' }], models: [{ id: 'model-a', name: 'Model A' }] })
    expect(listModels).toHaveBeenCalledWith('provider-a')
    await expect(readModelCatalog(host, 'unknown')).rejects.toThrow('unavailable')
    expect(listModels).toHaveBeenCalledTimes(1)
    await expect(readModelCatalog({})).rejects.toThrow('unavailable')
  })

  it('bounds waits for a stalled provider', async () => {
    vi.useFakeTimers()
    try {
      const result = readModelCatalog({ get: () => ({ listProviders: () => [{ id: 'slow' }], listModels: () => new Promise(() => {}) }) }, 'slow')
      const assertion = expect(result).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
