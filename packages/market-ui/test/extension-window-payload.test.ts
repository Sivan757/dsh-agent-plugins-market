/**
 * The extension window refuses an answer it cannot render.
 *
 * The regression this pins: `readWindow` decoded the body with
 * `json().catch(() => ({}))` and returned it typed as a payload, so a 200 whose
 * body did not parse — a proxy's HTML page, a truncated response — reached the
 * composer entry as `{}`. The entry then read `data.state.selection` during
 * render and threw `Cannot read properties of undefined (reading 'selection')`,
 * which surfaced as an unhandled error rather than as the failure path the
 * surface already draws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readWindow, writeWindow } from '../src/features/extension-presets/resource.js'

const payload = {
  sessionId: 's',
  workspace: '/workspace',
  started: true,
  busy: false,
  library: { revision: 1, presetId: null, presets: [] },
  state: { revision: 1, selection: { presetId: null, presetName: null, presetRevision: null, modified: false, enabledIds: [] } },
  resources: []
}

/** Answer every request with one status and one body parser. */
function answer(status: number, json: () => Promise<unknown>, ok = status < 400): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status, json }) as Response)
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readWindow', () => {
  it('refuses a 200 whose body does not parse instead of reading as an empty payload', async () => {
    answer(200, () => Promise.reject(new Error('not json')))
    await expect(readWindow('s')).rejects.toThrow('no session state')
  })

  it('refuses a 200 that carries no session state', async () => {
    answer(200, async () => ({
      sessionId: 's',
      library: payload.library,
      resources: []
    }))
    await expect(readWindow('s')).rejects.toThrow('no session state')
  })

  it('passes a complete payload through unchanged', async () => {
    answer(200, async () => payload)
    await expect(readWindow('s')).resolves.toEqual(payload)
  })
})

describe('writeWindow', () => {
  it('refuses an answer whose window carries no session state', async () => {
    answer(200, async () => ({ ok: true, window: { sessionId: 's', library: payload.library } }))
    await expect(writeWindow('update', 's', 1, {})).rejects.toThrow('no session state')
  })
})
