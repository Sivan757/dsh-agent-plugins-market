// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { CredentialError, describeCredential, setCredential, unsetCredential } from '../../../packages/market-ui/src/credentials.js'
import { clientErrorMessage } from '../../../packages/market-ui/src/ui/error-message.js'

describe('client credentials adapter', () => {
  it('projects only the value-free credential view', async () => {
    const calls: Array<{ ref: string }> = []
    const api = {
      describe: async (payload: { refs: string[] }) => {
        const [ref] = payload.refs
        if (ref === undefined) throw new Error('expected describeCredential to send one credential ref')
        calls.push({ ref })
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

  it('answers its own fallback in the panel language and keeps a host reason verbatim', () => {
    // The host's sentence names the scope it refused; only the plugin's own
    // fallback is something a reader should see translated.
    const t = (key: string): string => 'zh:' + key
    expect(clientErrorMessage(t, new CredentialError('lookup', 'credential lookup failed'))).toBe('zh:credentialLookupFailed')
    expect(clientErrorMessage(t, new CredentialError('save', 'credential save failed'))).toBe('zh:credentialSaveFailed')
    expect(clientErrorMessage(t, new CredentialError('removal', 'credential removal failed'))).toBe('zh:credentialRemovalFailed')
    expect(clientErrorMessage(t, new CredentialError('save', 'scope credentials:write was denied'))).toBe('scope credentials:write was denied')
  })
})
