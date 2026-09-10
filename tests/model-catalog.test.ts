import { describe, expect, it, vi } from 'vitest'
import { readModelCatalog } from '../src/runtime/model-catalog.js'

describe('DSH model directory', () => {
  it('resolves only the requested model and whitelists its reasoning metadata', async () => {
    const resolveModelInfo = vi.fn(async () => ({
      id: 'model',
      name: 'Model',
      secret: 'private',
      reasoning: { efforts: [{ id: 'high', name: 'High', description: 'More reasoning', secret: 'private' }], defaultEffort: 'high', private: 'hidden' }
    }))
    const llm = { listProviders: () => [{ id: 'p' }], listModels: vi.fn(), resolveModelInfo }
    expect(await readModelCatalog({ get: () => llm }, 'p', 'model')).toEqual({
      providers: [{ id: 'p', name: 'p' }],
      models: [{ id: 'model', name: 'Model' }],
      reasoning: { efforts: [{ id: 'high', name: 'High', description: 'More reasoning' }], defaultEffort: 'high' }
    })
    expect(resolveModelInfo).toHaveBeenCalledWith('p', 'model', expect.any(AbortSignal))
    expect(llm.listModels).not.toHaveBeenCalled()
    await expect(readModelCatalog({ get: () => llm }, undefined, 'model')).rejects.toThrow('requires a provider')
    expect(await readModelCatalog({ get: () => ({ ...llm, resolveModelInfo: async () => ({ id: 'plain' }) }) }, 'p', 'plain')).toMatchObject({ reasoning: { efforts: [] } })
  })

  it('cancels a timed-out exact-model metadata request', async () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const llm = {
        listProviders: () => [{ id: 'p' }],
        resolveModelInfo: (_provider: string, _model: string, requestSignal: AbortSignal) => {
          signal = requestSignal
          return new Promise(() => {})
        }
      }
      const assertion = expect(readModelCatalog({ get: () => llm }, 'p', 'm')).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
      expect(signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
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
