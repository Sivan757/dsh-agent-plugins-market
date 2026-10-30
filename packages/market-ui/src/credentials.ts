import { withBusyOperation } from './ui/busy-operation.js'

/** Which credential call failed; also the key the panel localizes its fallback by. */
export type CredentialErrorCode = 'lookup' | 'save' | 'removal'

/**
 * A credential call the host refused.
 *
 * The host's own message is kept verbatim — it names the missing scope or the
 * rejected reference — while the plugin's fallback sentence is localized at the
 * surface, so a Chinese panel never shows `credential save failed`.
 */
export class CredentialError extends Error {
  readonly code: CredentialErrorCode
  constructor(code: CredentialErrorCode, message: string) {
    super(message)
    this.name = 'CredentialError'
    this.code = code
  }
}
/** Browser-safe structural subset of the Host credentials wire. */

export interface CredentialView {
  configured: boolean
  source?: string
  writable: boolean
}

export interface CredentialApi {
  describe(payload: { refs: string[] }): Promise<unknown>
  set(payload: { ref: string; value: string }): Promise<unknown>
  unset(payload: { ref: string }): Promise<unknown>
}

interface CredentialDescribeResponse {
  result?: {
    ok?: boolean
    value?: { credentials?: Record<string, CredentialView> }
    error?: { message?: string }
  }
}

interface CredentialMutationResponse {
  result?: { ok?: boolean; error?: { message?: string } }
}

/** Read one value-free credential view; secret values never enter the browser state. */
export async function describeCredential(api: CredentialApi | undefined, ref: string): Promise<CredentialView | undefined> {
  if (api === undefined) return undefined
  const response = (await api.describe({ refs: [ref] })) as CredentialDescribeResponse
  if (response.result?.ok !== true) throw new CredentialError('lookup', response.result?.error?.message ?? 'credential lookup failed')
  return response.result.value?.credentials?.[ref]
}

export async function setCredential(api: CredentialApi, ref: string, value: string): Promise<void> {
  return withBusyOperation(async () => {
    const response = (await api.set({ ref, value })) as CredentialMutationResponse
    if (response.result?.ok !== true) throw new CredentialError('save', response.result?.error?.message ?? 'credential save failed')
  })
}

export async function unsetCredential(api: CredentialApi, ref: string): Promise<void> {
  return withBusyOperation(async () => {
    const response = (await api.unset({ ref })) as CredentialMutationResponse
    if (response.result?.ok !== true) throw new CredentialError('removal', response.result?.error?.message ?? 'credential removal failed')
  })
}

/** Current Host remote service; methods return unwrapped RPC results. */
export interface CredentialRemote {
  describe(refs: string[]): Promise<{ ok: boolean; value?: Record<string, CredentialView>; error?: { message?: string } }>
  set(ref: string, value: string): Promise<unknown>
  unset(ref: string): Promise<unknown>
}

/** Adapt the current Host service to the credential editor's wire contract. */
export function credentialApi(remote: CredentialRemote): CredentialApi {
  return {
    describe: async ({ refs }) => {
      const result = await remote.describe(refs)
      return { result: result.ok ? { ok: true, value: { credentials: result.value } } : result }
    },
    set: async ({ ref, value }) => ({ result: await remote.set(ref, value) }),
    unset: async ({ ref }) => ({ result: await remote.unset(ref) })
  }
}
