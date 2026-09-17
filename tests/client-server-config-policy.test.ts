// @vitest-environment jsdom
import { act, createElement as h, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerConfigPayload, ServerPolicyPayload } from '../src/contracts/market.js'
import { ServerConfigEditor } from '../src/client/ui/ServerConfigEditor.js'
import type { ServerPolicyDraft } from '../src/client/ui/server-form.js'
import { typeInto } from './helpers/dom-events.js'
import { stubTranslate as t } from './helpers/translate.js'

vi.mock('../src/client/api.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/client/api.js')>()),
  fetchServerConfig: vi.fn(),
  saveServerConfig: vi.fn(async () => {})
}))

import { McpConfigModal } from '../src/client/McpStatusPanel.js'
import * as api from '../src/client/api.js'
import type { McpStatusEntry } from '../src/contracts/mcp-status.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let host: HTMLDivElement
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  vi.clearAllMocks()
})

/** One policy view: the suite declares a tool-call timeout, the user sets what the arguments say. */
function policyOf(toolCall: number | null, startup: number | null): ServerPolicyPayload {
  return {
    toolCallTimeout: { user: toolCall, suite: 30_000, effective: toolCall ?? 30_000, source: toolCall === null ? 'suite' : 'user' },
    startupTimeout: { user: startup, suite: null, effective: startup ?? 10_000, source: startup === null ? 'default' : 'user' }
  }
}

const POLICY = policyOf(null, null)

async function render(node: ReactElement): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(node))
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const input = (label: string): HTMLInputElement => document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
const find = (label: string): HTMLElement | null => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
const button = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll('button')].find(node => node.textContent?.includes(label))
const clearTimeoutButton = (): HTMLButtonElement | undefined => [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === 'mcpTimeoutClearLabel')

/** The open disclosure's body: the group's second child is the expanded content. */
const disclosureBody = (): HTMLElement => {
  const group = button('mcpAdvanced')!.parentElement!
  const body = group.children[1]
  if (!(body instanceof HTMLElement)) throw new Error('the advanced disclosure is not open')
  return body
}

/** The editor's advanced section, driven by the document and the policy props the dialog supplies. */
function EditorHarness({
  backend = 'builtin' as const,
  kind = 'mcp' as const,
  config = { type: 'stdio', command: 'node' }
}: {
  backend?: 'builtin' | 'host'
  kind?: 'mcp' | 'lsp'
  config?: Record<string, unknown>
}): ReactElement {
  const [valid, setValid] = useState(false)
  const [draft, setDraft] = useState<ServerPolicyDraft>({ toolCallTimeoutMs: '', startupTimeoutMs: '' })
  return h(
    'div',
    null,
    h(ServerConfigEditor, {
      kind,
      text: JSON.stringify(config),
      onChange: () => {},
      t,
      backend,
      policy: POLICY,
      policyDraft: draft,
      onPolicyDraftChange: setDraft,
      onValidityChange: setValid
    }),
    h('output', { 'data-valid': true }, String(valid)),
    h('output', { 'data-draft': true }, JSON.stringify(draft))
  )
}

describe('MCP advanced settings', () => {
  it('keeps the section collapsed until it is opened, showing each effective value as a placeholder', async () => {
    await render(h(EditorHarness, {}))
    const disclosure = button('mcpAdvanced')
    expect(disclosure?.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('[aria-label="mcpToolCallTimeout"]')).toBeNull()

    await act(async () => disclosure!.click())
    expect(button('mcpAdvanced')?.getAttribute('aria-expanded')).toBe('true')
    expect(input('mcpToolCallTimeout').placeholder).toBe('30000')
    expect(input('mcpStartupTimeout').placeholder).toBe('10000')
    expect(host.textContent).toContain('mcpTimeoutInherit · mcpTimeoutFromSuite')
    expect(host.textContent).toContain('mcpTimeoutInherit · mcpTimeoutFromDefault')
  })

  it('moves the stdio working directory into the disclosure', async () => {
    await render(h(EditorHarness, {}))
    // The required and credential inputs stay in the main form.
    expect(find('detailCommand')).not.toBeNull()
    expect(host.textContent).toContain('detailArgs')
    expect(host.textContent).toContain('detailEnv')
    // The optional input waits behind the disclosure.
    expect(find('detailCwd')).toBeNull()

    await act(async () => button('mcpAdvanced')!.click())
    const cwd = find('detailCwd')
    expect(cwd).not.toBeNull()
    expect(disclosureBody().contains(cwd)).toBe(true)
    expect(disclosureBody().contains(input('mcpToolCallTimeout'))).toBe(true)
    expect(disclosureBody().contains(input('mcpStartupTimeout'))).toBe(true)
  })

  it('states that a remote server negotiates OAuth itself instead of offering a switch', async () => {
    await render(h(EditorHarness, { config: { type: 'streamable-http', url: 'https://example.test/mcp' } }))
    expect(find('detailUrl')).not.toBeNull()
    expect(host.textContent).not.toContain('mcpOauthAuto')

    await act(async () => button('mcpAdvanced')!.click())
    expect(find('detailCwd')).toBeNull()
    expect(disclosureBody().textContent).toContain('mcpOauthAuto')
    expect(disclosureBody().contains(input('mcpToolCallTimeout'))).toBe(true)
    expect(disclosureBody().contains(input('mcpStartupTimeout'))).toBe(true)
  })

  it('reports an out-of-range timeout as invalid and holds the value otherwise', async () => {
    await render(h(EditorHarness, {}))
    await act(async () => button('mcpAdvanced')!.click())
    await act(async () => typeInto(input('mcpToolCallTimeout'), '0'))
    // The field is text, so the rejected text stays readable instead of being
    // sanitized away into an empty (inheriting) value.
    expect(input('mcpToolCallTimeout').value).toBe('0')
    expect(host.querySelector('[data-valid]')!.textContent).toBe('false')
    expect(host.textContent).toContain('mcpTimeoutInvalid')
    expect(host.textContent).not.toContain('mcpTimeoutUserSet')

    await act(async () => typeInto(input('mcpToolCallTimeout'), '120000'))
    expect(host.querySelector('[data-valid]')!.textContent).toBe('true')
    expect(host.textContent).toContain('mcpTimeoutUserSet')
    const draft = JSON.parse(host.querySelector('[data-draft]')!.textContent ?? '') as ServerPolicyDraft
    expect(draft.toolCallTimeoutMs).toBe('120000')
  })

  it('keeps text it cannot parse in the field and reports it as invalid', async () => {
    await render(h(EditorHarness, {}))
    await act(async () => button('mcpAdvanced')!.click())
    await act(async () => typeInto(input('mcpToolCallTimeout'), 'soon'))
    expect(input('mcpToolCallTimeout').value).toBe('soon')
    expect(host.querySelector('[data-valid]')!.textContent).toBe('false')
    expect(host.textContent).toContain('mcpTimeoutInvalid')
    const draft = JSON.parse(host.querySelector('[data-draft]')!.textContent ?? '') as ServerPolicyDraft
    expect(draft.toolCallTimeoutMs).toBe('soon')
  })

  it('disables the startup timeout and names the reason on the host compatibility backend', async () => {
    await render(h(EditorHarness, { backend: 'host' }))
    await act(async () => button('mcpAdvanced')!.click())
    expect(input('mcpStartupTimeout').disabled).toBe(true)
    expect(input('mcpToolCallTimeout').disabled).toBe(false)
    expect(host.textContent).toContain('mcpHostStartupUnsupported')
    // Nothing is stored, so there is nothing to clear.
    expect(clearTimeoutButton()).toBeUndefined()
  })

  it('keeps the section out of an LSP editor', async () => {
    await render(h(EditorHarness, { kind: 'lsp' }))
    expect(button('mcpAdvanced')).toBeUndefined()
  })
})

describe('ServerConfigDetail policy', () => {
  const ENTRY: McpStatusEntry = {
    id: 'plugin:demo/service',
    name: 'demo__service',
    kind: 'plugin',
    state: 'connected',
    transport: 'stdio',
    suiteId: 'demo',
    serverKey: 'service',
    tools: [],
    advertisedTools: true
  }
  const payload = (backend: 'builtin' | 'host', policy: ServerPolicyPayload = POLICY): ServerConfigPayload => ({
    kind: 'mcp',
    id: ENTRY.id,
    editable: true,
    config: { type: 'stdio', command: 'node' },
    backend,
    policy
  })

  /**
   * The editor dialog on its own, which is how the panel opens it: the card's
   * edit action mounts this dialog, so these tests do the same.
   */
  async function renderDialog(backend: 'builtin' | 'host' = 'builtin', responses: ServerConfigPayload[] = []): Promise<void> {
    const fetchMock = vi.mocked(api.fetchServerConfig)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(payload(backend))
    for (const response of responses) fetchMock.mockResolvedValueOnce(response)
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(h(McpConfigModal, { entry: ENTRY, t, onClose: () => {}, onSaved: () => {} })))
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }

  /** Open the advanced section and save, waiting for the read-back that follows. */
  async function save(): Promise<void> {
    await act(async () => {
      button('save')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }

  it('places a rejected save reason on the field the API named', async () => {
    await renderDialog()
    // The save button only runs on a changed document.
    await act(async () => typeInto(input('detailCommand'), 'node --flag'))
    vi.mocked(api.saveServerConfig).mockRejectedValueOnce(
      Object.assign(new Error('invalid MCP configuration: env.API_TOKEN must be string'), { fields: [{ field: 'env.API_TOKEN', message: 'must be string' }] })
    )
    await save()
    expect(document.body.textContent).toContain('must be string')
  })

  it('sends only the timeout that changed', async () => {
    await renderDialog()
    await act(async () => button('mcpAdvanced')!.click())
    await act(async () => typeInto(input('mcpToolCallTimeout'), '120000'))
    expect(button('save')?.disabled).toBe(false)
    await save()
    expect(api.saveServerConfig).toHaveBeenCalledWith('mcp', 'plugin:demo/service', { type: 'stdio', command: 'node' }, { toolCallTimeoutMs: 120_000 })
  })

  it('clears a timeout back to inheritance when its field is emptied', async () => {
    await renderDialog('builtin', [payload('builtin', policyOf(120_000, null))])
    await act(async () => button('mcpAdvanced')!.click())
    await act(async () => typeInto(input('mcpToolCallTimeout'), ''))
    await save()
    expect(api.saveServerConfig).toHaveBeenCalledWith('mcp', 'plugin:demo/service', { type: 'stdio', command: 'node' }, { toolCallTimeoutMs: null })
  })

  it('keeps unparsable text in the field, blocks the save, and saves nothing', async () => {
    await renderDialog()
    await act(async () => button('mcpAdvanced')!.click())
    await act(async () => typeInto(input('mcpStartupTimeout'), 'soon'))
    // The text stays as typed: it never becomes an empty value that a save
    // would send as `null`.
    expect(input('mcpStartupTimeout').value).toBe('soon')
    expect(document.body.textContent).toContain('mcpTimeoutInvalid')
    const saveButton = button('save')
    expect(saveButton?.disabled).toBe(true)
    await act(async () => {
      saveButton!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(api.saveServerConfig).not.toHaveBeenCalled()
  })

  it('leaves a stored startup timeout out of a tool-call-only save on the host backend', async () => {
    await renderDialog('host', [payload('host', policyOf(null, 30_000))])
    await act(async () => button('mcpAdvanced')!.click())
    await act(async () => typeInto(input('mcpToolCallTimeout'), '120000'))
    await save()
    expect(api.saveServerConfig).toHaveBeenCalledWith('mcp', 'plugin:demo/service', { type: 'stdio', command: 'node' }, { toolCallTimeoutMs: 120_000 })
  })

  it('clears a stored startup timeout on the host backend without switching backends', async () => {
    await renderDialog('host', [payload('host', policyOf(null, 30_000))])
    await act(async () => button('mcpAdvanced')!.click())
    expect(input('mcpStartupTimeout').disabled).toBe(true)
    expect(input('mcpStartupTimeout').value).toBe('30000')
    const clear = clearTimeoutButton()
    expect(clear).toBeDefined()
    await act(async () => clear!.click())
    expect(input('mcpStartupTimeout').value).toBe('')
    expect(button('save')?.disabled).toBe(false)
    await save()
    expect(api.saveServerConfig).toHaveBeenCalledWith('mcp', 'plugin:demo/service', { type: 'stdio', command: 'node' }, { startupTimeoutMs: null })
  })

  it('refreshes the policy view and the placeholders after a successful save', async () => {
    await renderDialog('builtin', [payload('builtin'), payload('builtin', policyOf(120_000, null))])
    await act(async () => button('mcpAdvanced')!.click())
    await act(async () => typeInto(input('mcpToolCallTimeout'), '120000'))
    await save()
    expect(api.fetchServerConfig).toHaveBeenCalledTimes(2)
    expect(input('mcpToolCallTimeout').value).toBe('120000')
    expect(input('mcpToolCallTimeout').placeholder).toBe('120000')
    expect(document.body.textContent).toContain('mcpTimeoutUserSet')
    expect(document.body.textContent).not.toContain('mcpTimeoutInherit · mcpTimeoutFromSuite')
  })
})
