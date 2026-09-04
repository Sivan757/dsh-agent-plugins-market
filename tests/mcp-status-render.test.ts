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
  totals: { all: 1, connected: 0, degraded: 0, failed: 0, needsCredentials: 1, orphaned: 0, disabled: 0 },
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
  totals: { all: 1, connected: 1, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0 },
  directObservationOnly: true
}))

vi.mock('../src/client/api.js', () => ({
  fetchMcpStatus: vi.fn().mockResolvedValue(statusPayload),
  fetchSuiteDetail: vi.fn(),
  fetchSkillContent: vi.fn(),
  postAction: vi.fn(),
  retryMcpMounts: vi.fn()
}))

import { McpStatusPanel } from '../src/client/McpStatusPanel.js'
import type { CredentialApi } from '../src/client/credentials.js'
import type { Translate } from '../src/client/index.js'

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
  it('exposes a credential action inside the detail dialog instead of on the card', async () => {
    const credentials: CredentialApi = {
      describe: vi.fn().mockResolvedValue({ result: { ok: true, value: { credentials: { API_TOKEN: { configured: false, writable: true } } } } }),
      set: vi.fn().mockResolvedValue({ result: { ok: true, value: {} } }),
      unset: vi.fn().mockResolvedValue({ result: { ok: true, value: {} } })
    }
    const el = await mountPanel(credentials)

    // The card is a lean identity line now: no inline actions. Opening the
    // detail dialog is the one interaction a card offers.
    const card = [...el.querySelectorAll('[role="button"]')].find(node => node.textContent?.includes('demo__service'))
    expect(card).toBeDefined()
    await act(async () => {
      card!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.body.textContent).toContain('mcpServiceDetail')

    // The editor is embedded in the dialog itself (no intermediate toggle).
    expect(document.body.textContent).toContain('mcpCredentialTitle')
    expect(document.body.querySelector('input[type="password"]')).not.toBeNull()
    expect(credentials.describe).toHaveBeenCalledWith({ refs: ['API_TOKEN'] })
  })

  it('offers retry in the dialog footer and echoes the outcome in place', async () => {
    const api = await import('../src/client/api.js')
    const el = await mountPanel()

    const card = [...el.querySelectorAll('[role="button"]')].find(node => node.textContent?.includes('demo__service'))
    await act(async () => {
      card!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const retry = [...document.body.querySelectorAll('button')].find(button => button.textContent?.includes('mcpRetry'))
    expect(retry).toBeDefined()

    vi.mocked(api.retryMcpMounts).mockResolvedValueOnce()
    vi.mocked(api.fetchMcpStatus).mockResolvedValueOnce(connectedPayload)
    await act(async () => {
      retry!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(api.retryMcpMounts).toHaveBeenCalled()
    expect(document.body.textContent).toContain('mcpRetrySuccess')

    // A failed retry echoes failure instead.
    vi.mocked(api.retryMcpMounts).mockRejectedValueOnce(new Error('boom'))
    await act(async () => {
      retry!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.body.textContent).toContain('mcpRetryFailure')
  })
})
