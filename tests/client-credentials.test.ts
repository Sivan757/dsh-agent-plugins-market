import { describe, expect, it } from 'vitest'
import { describeCredential, setCredential, unsetCredential } from '../src/client/credentials.js'

describe('client credentials adapter', () => {
  it('projects only the value-free credential view', async () => {
    const calls: Array<{ ref: string }> = []
    const api = {
      describe: async (payload: { refs: string[] }) => {
        calls.push({ ref: payload.refs[0]! })
        return { result: { ok: true, value: { credentials: { API_TOKEN: { configured: true, source: 'file', writable: true } } } } }
      },
      set: async () => ({}),
      unset: async () => ({})
    }

    await expect(describeCredential(api, 'API_TOKEN')).resolves.toEqual({ configured: true, source: 'file', writable: true })
    expect(calls).toEqual([{ ref: 'API_TOKEN' }])
  })

  it('rejects failed credential mutations instead of reporting a false success', async () => {
    const api = {
      describe: async () => ({ result: { ok: true, value: { credentials: {} } } }),
      set: async () => ({ result: { ok: false, error: { message: 'read-only credential' } } }),
      unset: async () => ({ result: { ok: false, error: { message: 'read-only credential' } } })
    }

    await expect(setCredential(api, 'API_TOKEN', 'secret')).rejects.toThrow('read-only credential')
    await expect(unsetCredential(api, 'API_TOKEN')).rejects.toThrow('read-only credential')
  })
})
