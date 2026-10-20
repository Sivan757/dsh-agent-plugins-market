// @vitest-environment jsdom

globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const statusPayload = vi.hoisted(() => ({
  entries: [
    {
      id: 'plugin:demo/service',
      name: 'demo__service',
      kind: 'plugin' as const,
      state: 'needs-credentials' as const,
      source: 'Demo Suite',
      suiteId: 'demo',
      serverKey: 'service',
      transport: 'stdio',
      endpoint: 'node server.js',
      config: { env: { API_TOKEN: '[redacted]' } },
      tools: [],
      reason: 'missing credential reference API_TOKEN',
      credentialRefs: ['API_TOKEN']
    }
  ],
  observedAt: '',
  totals: { all: 1, connected: 0, degraded: 0, failed: 0, needsCredentials: 1, orphaned: 0, disabled: 0, foreign: 0 },
  directObservationOnly: true
}))

const connectedPayload = vi.hoisted(() => ({
  entries: [
    {
      id: 'plugin:demo/service',
      name: 'demo__service',
      kind: 'plugin' as const,
      state: 'connected' as const,
      source: 'Demo Suite',
      suiteId: 'demo',
      serverKey: 'service',
      transport: 'stdio',
      endpoint: 'node server.js',
      tools: [],
      advertisedTools: true
    }
  ],
  observedAt: '',
  totals: { all: 1, connected: 1, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
  directObservationOnly: true
}))

/** Reconnect only appears for a genuine mount failure, so the retry test needs one. */
const failedPayload = vi.hoisted(() => ({
  entries: [
    {
      id: 'plugin:demo/service',
      name: 'demo__service',
      kind: 'plugin' as const,
      state: 'failed' as const,
      code: 'mount-failed' as const,
      source: 'Demo Suite',
      suiteId: 'demo',
      serverKey: 'service',
      transport: 'stdio',
      endpoint: 'node server.js',
      reason: 'connection refused',
      tools: []
    }
  ],
  observedAt: '',
  totals: { all: 1, connected: 0, degraded: 0, failed: 1, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
  directObservationOnly: true
}))

/** A switched-off row a session preset keeps mounted: the band shows its own sentence. */
const presetDemandPayload = vi.hoisted(() => ({
  entries: [
    {
      id: 'plugin:demo/service',
      name: 'demo__service',
      kind: 'plugin' as const,
      state: 'disabled' as const,
      code: 'preset-demand' as const,
      source: 'Demo Suite',
      suiteId: 'demo',
      serverKey: 'service',
      transport: 'stdio',
      endpoint: 'node server.js',
      reason: 'this service is selected by the active session preset, which keeps it mounted; the panel switch cannot unmount it while that preset is active',
      tools: []
    }
  ],
  observedAt: '',
  totals: { all: 1, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 1, foreign: 0 },
  directObservationOnly: true
}))

/** A user-owned declaration: the one kind of row the panel may delete. */
const directPayload = vi.hoisted(() => ({
  entries: [
    {
      id: 'direct:kuboard',
      name: 'kuboard',
      kind: 'direct' as const,
      managed: true,
      state: 'connected' as const,
      suiteId: '@user-mcp/user-mcp',
      serverKey: 'kuboard',
      transport: 'streamable-http',
      endpoint: 'https://example.test/mcp',
      tools: []
    }
  ],
  observedAt: '',
  totals: { all: 1, connected: 1, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
  directObservationOnly: true
}))

/** A switched-off row: the band edge and the card both read neutral here. */
const disabledPayload = vi.hoisted(() => ({
  entries: [
    {
      id: 'plugin:demo/service',
      name: 'demo__service',
      kind: 'plugin' as const,
      state: 'disabled' as const,
      code: 'disabled-override' as const,
      source: 'Demo Suite',
      suiteId: 'demo',
      serverKey: 'service',
      transport: 'stdio',
      endpoint: 'node server.js',
      reason: 'switched off through this plugin',
      tools: []
    }
  ],
  observedAt: '',
  totals: { all: 1, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 1, foreign: 0 },
  directObservationOnly: true
}))

vi.mock('../../../packages/market-ui/src/api.js', () => ({
  fetchMcpStatus: vi.fn().mockResolvedValue(statusPayload),
  fetchServerConfig: vi.fn().mockResolvedValue({ kind: 'mcp', id: 'direct-observation', editable: false, config: {} }),
  // The create form reads its template from this route; without it the mock
  // module has no such export and the dialog throws before it can render.
  fetchServerConfigDefaults: vi.fn().mockResolvedValue({ kind: 'mcp', id: '', key: '', editable: true, config: {} }),
  saveServerConfig: vi.fn(),
  fetchSuiteDetail: vi.fn(),
  fetchSuiteDocument: vi.fn(),
  postAction: vi.fn(),
  retryMcpMounts: vi.fn(),
  removeMcpServer: vi.fn()
}))

import { McpStatusPanel } from '../../../packages/market-ui/src/features/mcp/StatusPanel.js'
import type { CredentialApi } from '../../../packages/market-ui/src/credentials.js'
import type { Translate } from '../../../packages/market-ui/src/index.js'

const t: Translate = key => String(key)

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.clearAllMocks()
})

async function mountPanel(credentials?: CredentialApi): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(h(McpStatusPanel, { t, credentials }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  return host
}

describe('MCP status actions', () => {
  it('keeps credentials out of the report and reads them for the editor', async () => {
    const describeCredentials = vi.fn().mockResolvedValue({ result: { ok: true, value: { credentials: { API_TOKEN: { configured: false, writable: true } } } } })
    const credentials: CredentialApi = {
      describe: describeCredentials,
      set: vi.fn().mockResolvedValue({ result: { ok: true, value: {} } }),
      unset: vi.fn().mockResolvedValue({ result: { ok: true, value: {} } })
    }
    const el = await mountPanel(credentials)

    // The card is a lean identity line: it renders no credential control, and
    // the panel asks the credentials service nothing yet.
    expect(el.querySelector('input[type="password"]')).toBeNull()
    expect(describeCredentials).not.toHaveBeenCalled()
    const card = el.querySelector('[data-resource-surface="mcp"]')
    expect(card?.textContent).toContain('service')
    // The identity line shows the display name; the raw server name is the
    // card's hover hint, which the host tooltip renders only on hover.
    expect(card?.textContent).toContain('demo')

    // The report reports: its dialog carries no credential block at all.
    await act(async () => {
      card!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    // The dialog's title names the service; no subtitle repeats that it is one.
    expect(document.body.textContent).not.toContain('mcpServiceDetail')
    expect(document.body.textContent).not.toContain('mcpCredentialTitle')
    expect(describeCredentials).not.toHaveBeenCalled()

    // The editor is where a secret is read and written: it mounts the block for
    // the references the document spends.
    const api = await import('../../../packages/market-ui/src/api.js')
    vi.mocked(api.fetchServerConfig).mockResolvedValue({
      kind: 'mcp',
      id: 'service',
      key: 'service',
      editable: true,
      backend: 'builtin',
      config: { type: 'streamable-http', url: 'https://example.test/mcp', headers: { Authorization: '${API_TOKEN}' } }
    })
    const edit = document.querySelector<HTMLButtonElement>('[aria-label="panelEdit service"]')
    expect(edit).not.toBeNull()
    await act(async () => {
      edit!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.body.textContent).toContain('mcpCredentialTitle')
    expect(describeCredentials).toHaveBeenCalledWith({ refs: ['API_TOKEN'] })
  })

  it('offers retry in the status band and echoes the outcome in place', async () => {
    const api = await import('../../../packages/market-ui/src/api.js')
    vi.mocked(api.fetchMcpStatus).mockResolvedValueOnce(failedPayload)
    const el = await mountPanel()

    const card = el.querySelector('[data-resource-surface="mcp"]')
    await act(async () => {
      card!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const retry = [...document.body.querySelectorAll('button')].find(button => button.textContent?.includes('mcpRetryConnection'))
    expect(retry).toBeDefined()

    // A failed retry echoes the action failure in place, and the button stays
    // available because the entry is still failed.
    vi.mocked(api.retryMcpMounts).mockRejectedValueOnce(new Error('boom'))
    await act(async () => {
      retry!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.body.textContent).toContain('actionFail')

    // A successful retry echoes success; the entry turns connected, so the
    // reconnect action is no longer offered.
    vi.mocked(api.retryMcpMounts).mockResolvedValueOnce()
    vi.mocked(api.fetchMcpStatus).mockResolvedValueOnce(connectedPayload)
    await act(async () => {
      retry!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(api.retryMcpMounts).toHaveBeenCalled()
    expect(document.body.textContent).toContain('mcpRetrySuccess')
    expect([...document.body.querySelectorAll('button')].some(button => button.textContent?.includes('mcpRetryConnection'))).toBe(false)
  })

  it('opens the new-service dialog as one short form', async () => {
    await mountPanel()
    const add = document.querySelector<HTMLButtonElement>('[aria-label="panelAdd"]')
    expect(add).not.toBeNull()
    await act(async () => {
      add!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    // No template or paste shortcuts: the form is the only entry, and the JSON
    // view inside the editor carries everything the form has no field for.
    expect(document.body.textContent).toContain('mcpAddTitle')
    expect(document.body.textContent).not.toContain('mcpStarterTemplates')
    expect(document.body.textContent).not.toContain('mcpStarterPaste')
    expect(document.body.textContent).toContain('mcpServerName')
  })

  it('opens the editor from the card', async () => {
    await mountPanel()
    const edit = document.querySelector<HTMLButtonElement>('[aria-label="panelEdit service"]')
    expect(edit).not.toBeNull()
    await act(async () => {
      edit!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.body.textContent).toContain('mcpEditTitle')
  })

  it('localizes the preset-demand reason instead of echoing it in English', async () => {
    const api = await import('../../../packages/market-ui/src/api.js')
    vi.mocked(api.fetchMcpStatus).mockResolvedValueOnce(presetDemandPayload)
    const el = await mountPanel()
    await act(async () => {
      el.querySelector('[data-resource-surface="mcp"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    // The band's lead is the classified sentence; the runtime's own words stay
    // behind the disclosure, so a Chinese panel never shows the English reason.
    expect(document.querySelector('[data-status-band]')?.textContent).toContain('failureGuidePresetDemand')
    expect(document.querySelector('[data-status-band]')?.textContent).not.toContain('selected by the active session preset')
  })

  it('reads the same state colour on the card edge and in the detail band', async () => {
    const api = await import('../../../packages/market-ui/src/api.js')
    vi.mocked(api.fetchMcpStatus).mockResolvedValueOnce(failedPayload)
    const failed = await mountPanel()
    const failedCard = failed.querySelector('[data-resource-surface="mcp"]')
    expect(failedCard?.getAttribute('data-resource-state')).toBe('error')
    await act(async () => {
      failedCard!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.querySelector('[data-status-band]')?.getAttribute('data-band-tone')).toBe('error')
    await act(async () => root?.unmount())
    document.body.replaceChildren()
    vi.clearAllMocks()

    vi.mocked(api.fetchMcpStatus).mockResolvedValueOnce(disabledPayload)
    const disabled = await mountPanel()
    const disabledCard = disabled.querySelector('[data-resource-surface="mcp"]')
    expect(disabledCard?.getAttribute('data-resource-state')).toBe('disabled')
    await act(async () => {
      disabledCard!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.querySelector('[data-status-band]')?.getAttribute('data-band-tone')).toBe('neutral')
  })
})

/** The delete path: only the user's own declaration, always confirmed, then re-read. */
describe('MCP delete actions', () => {
  const byText = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll('button')].find(node => node.textContent === label)
  async function openCard(el: HTMLDivElement): Promise<void> {
    await act(async () => {
      el.querySelector('[data-resource-surface="mcp"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }
  async function mountDirect(): Promise<HTMLDivElement> {
    const api = await import('../../../packages/market-ui/src/api.js')
    vi.mocked(api.fetchMcpStatus).mockResolvedValueOnce(directPayload)
    return mountPanel()
  }

  it('offers the card delete only for a user-owned declaration', async () => {
    // A suite declares its servers in its own `mcp.json`, so its card offers the
    // editor but never a delete.
    const pluginPanel = await mountPanel()
    expect(pluginPanel.querySelector('[aria-label="panelEdit service"]')).not.toBeNull()
    expect(pluginPanel.querySelector('[aria-label^="mcpDelete"]')).toBeNull()
    await act(async () => root?.unmount())
    document.body.replaceChildren()

    const direct = await mountDirect()
    expect(direct.querySelector('[aria-label="mcpDelete kuboard"]')).not.toBeNull()
  })

  it('confirms a card delete, then removes the declaration and re-reads the list', async () => {
    const api = await import('../../../packages/market-ui/src/api.js')
    const el = await mountDirect()
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="mcpDelete kuboard"]')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    // The card opens the shared danger confirmation rather than deleting on one
    // click, and that is not the detail dialog.
    expect(document.body.textContent).toContain('mcpDeleteTitle')
    expect(document.body.textContent).not.toContain('overviewSection')
    expect(api.removeMcpServer).not.toHaveBeenCalled()
    const reads = vi.mocked(api.fetchMcpStatus).mock.calls.length
    await act(async () => {
      byText('mcpDeleteConfirm')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(api.removeMcpServer).toHaveBeenCalledWith('@user-mcp/user-mcp', 'kuboard')
    expect(vi.mocked(api.fetchMcpStatus).mock.calls.length).toBeGreaterThan(reads)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the detail dialog free of a delete action', async () => {
    // Deleting belongs to the card's action row: the detail dialog reports the
    // service and offers recovery, so a destructive button in its footer would
    // sit beside the read-only facts it describes.
    const el = await mountDirect()
    await openCard(el)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(byText('mcpDelete')).toBeUndefined()
  })

  it('reports a failed delete in the panel without dropping the row', async () => {
    const api = await import('../../../packages/market-ui/src/api.js')
    const el = await mountDirect()
    const reads = vi.mocked(api.fetchMcpStatus).mock.calls.length
    vi.mocked(api.removeMcpServer).mockRejectedValueOnce(new Error('cannot remove kuboard'))
    await act(async () => {
      el.querySelector<HTMLButtonElement>('[aria-label="mcpDelete kuboard"]')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => {
      byText('mcpDeleteConfirm')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    // The failure is the panel's one error line, and nothing is re-read: the
    // declaration is still there, so the next refresh reports it as it stands.
    expect(document.body.textContent).toContain('cannot remove kuboard')
    expect(vi.mocked(api.fetchMcpStatus).mock.calls.length).toBe(reads)
  })
})
