// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpAddModal } from '../src/client/features/mcp/McpAddModal.js'
import { ServerConfigModal } from '../src/client/ui/ServerConfigModal.js'
import { composeServerDocument } from '../src/client/ui/server-form.js'
import type { ServerConfigPayload } from '../src/contracts/market.js'
import { typeInto } from './helpers/dom-events.js'
import { stubTranslate as t } from './helpers/translate.js'

vi.mock('../src/client/api.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/client/api.js')>()),
  fetchServerConfigDefaults: vi.fn(async () => DEFAULTS),
  fetchServerConfig: vi.fn(async () => ({ ...DEFAULTS, id: 'direct:service', key: 'service', config: { type: 'stdio', command: 'node' } })),
  addLspServer: vi.fn(async () => {}),
  addMcpServer: vi.fn(async () => {}),
  saveServerConfig: vi.fn(async () => {})
}))

import * as api from '../src/client/api.js'

const DEFAULTS: ServerConfigPayload = {
  kind: 'mcp',
  id: '',
  key: '',
  editable: true,
  config: { type: 'stdio', command: '' },
  backend: 'builtin',
  policy: {
    toolCallTimeout: { user: null, suite: null, effective: 60000, source: 'default' },
    startupTimeout: { user: null, suite: null, effective: 10000, source: 'default' },
    deniedTools: { user: null, suite: null, effective: [] },
    auth: { user: null, suite: null, effective: true }
  }
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  vi.clearAllMocks()
})

const input = (label: string): HTMLInputElement => document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
const button = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll('button')].find(node => node.textContent?.includes(label))

async function renderCreate(node: ReactElement = h(McpAddModal, { t, onClose: () => {}, onSaved: () => {} })): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(node))
}

describe('service editor create and edit parity', () => {
  it('offers and saves MCP timeouts in the same create request as the definition', async () => {
    await renderCreate()
    await act(async () => typeInto(input('mcpServerName'), 'service'))
    await act(async () => typeInto(input('detailCommand'), 'node'))
    await act(async () => button('mcpAdvanced')!.click())
    expect(input('mcpToolCallTimeout')).not.toBeNull()
    expect(input('mcpStartupTimeout')).not.toBeNull()
    await act(async () => typeInto(input('mcpToolCallTimeout'), '120000'))
    await act(async () => typeInto(input('mcpStartupTimeout'), '30000'))
    await act(async () => button('editorCreate')!.click())
    expect(api.addMcpServer).toHaveBeenCalledWith('service', { type: 'stdio', command: 'node' }, { toolCallTimeoutMs: 120000, startupTimeoutMs: 30000 })
    expect(api.saveServerConfig).not.toHaveBeenCalled()
  })

  it('keeps policy and definition together across JSON mode and name changes', async () => {
    await renderCreate()
    await act(async () => typeInto(input('detailCommand'), 'node'))
    await act(async () => button('mcpAdvanced')!.click())
    await act(async () => typeInto(input('mcpToolCallTimeout'), '120000'))
    await act(async () => button('detailJson')!.click())
    expect(JSON.parse(input('detailJson').value)).toEqual(JSON.parse(composeServerDocument('my-mcp-server', { type: 'stdio', command: 'node' }, { toolCallTimeoutMs: 120000 })))
    await act(async () => typeInto(input('mcpServerName'), 'renamed'))
    expect(JSON.parse(input('detailJson').value)).toEqual(JSON.parse(composeServerDocument('renamed', { type: 'stdio', command: 'node' }, { toolCallTimeoutMs: 120000 })))
    await act(async () => typeInto(input('detailJson'), composeServerDocument('renamed', { type: 'sse', url: 'https://example.test/mcp' }, { startupTimeoutMs: 25000 })))
    await act(async () => button('editorCreate')!.click())
    expect(api.addMcpServer).toHaveBeenCalledWith('renamed', { type: 'sse', url: 'https://example.test/mcp' }, { startupTimeoutMs: 25000 })
  })

  it('keeps invalid JSON intact and disables name changes until repaired', async () => {
    await renderCreate()
    await act(async () => button('detailJson')!.click())
    await act(async () => typeInto(input('detailJson'), '{broken'))
    expect(input('mcpServerName').disabled).toBe(true)
    expect(input('detailJson').value).toBe('{broken')
    expect(button('editorCreate')?.disabled).toBe(true)
    expect(api.addMcpServer).not.toHaveBeenCalled()
  })

  it('preserves JSON with a renamed key and blocks name rewriting until repaired', async () => {
    await renderCreate()
    await act(async () => button('detailJson')!.click())
    const renamed = composeServerDocument('custom', { type: 'stdio', command: 'node' }, { startupTimeoutMs: 25000 })
    await act(async () => typeInto(input('detailJson'), renamed))
    expect(input('mcpServerName').disabled).toBe(true)
    expect(input('detailJson').value).toBe(renamed)
    expect(button('editorCreate')?.disabled).toBe(true)
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('rejects extra service keys without discarding their configuration', async () => {
    await renderCreate()
    await act(async () => button('detailJson')!.click())
    const multiple = JSON.stringify({ mcpServers: { 'my-mcp-server': { type: 'stdio', command: 'node' }, extra: { type: 'stdio', command: 'other' } } })
    await act(async () => typeInto(input('detailJson'), multiple))
    expect(input('mcpServerName').disabled).toBe(true)
    expect(input('detailJson').value).toBe(multiple)
    expect(button('editorCreate')?.disabled).toBe(true)
  })

  it('preserves the full draft when a create request is rejected', async () => {
    const onSaved = vi.fn()
    vi.mocked(api.addMcpServer).mockRejectedValueOnce(new Error('already exists'))
    await renderCreate(h(McpAddModal, { t, onClose: () => {}, onSaved }))
    await act(async () => typeInto(input('mcpServerName'), 'service'))
    await act(async () => typeInto(input('detailCommand'), 'node'))
    await act(async () => button('mcpAdvanced')!.click())
    await act(async () => typeInto(input('mcpToolCallTimeout'), '120000'))
    await act(async () => button('editorCreate')!.click())
    expect(onSaved).not.toHaveBeenCalled()
    expect(input('mcpServerName').value).toBe('service')
    expect(input('detailCommand').value).toBe('node')
    expect(input('mcpToolCallTimeout').value).toBe('120000')
    expect(document.body.textContent).toContain('already exists')
    await act(async () => button('detailJson')!.click())
    expect(JSON.parse(input('detailJson').value)).toEqual(JSON.parse(composeServerDocument('service', { type: 'stdio', command: 'node' }, { toolCallTimeoutMs: 120000 })))
  })

  it('refuses invalid creation timeouts and preserves the draft', async () => {
    await renderCreate()
    await act(async () => typeInto(input('detailCommand'), 'node'))
    await act(async () => button('mcpAdvanced')!.click())
    await act(async () => typeInto(input('mcpToolCallTimeout'), 'soon'))
    expect(input('mcpToolCallTimeout').value).toBe('soon')
    expect(button('editorCreate')?.disabled).toBe(true)
    expect(api.addMcpServer).not.toHaveBeenCalled()
  })

  it('uses host backend constraints and defaults before creation', async () => {
    vi.mocked(api.fetchServerConfigDefaults).mockResolvedValueOnce({ ...DEFAULTS, backend: 'host' })
    await renderCreate()
    expect(api.fetchServerConfigDefaults).toHaveBeenCalledWith('mcp')
    await act(async () => button('mcpAdvanced')!.click())
    expect(input('mcpToolCallTimeout').placeholder).toBe('60000')
    expect(input('mcpStartupTimeout').disabled).toBe(true)
    expect(document.body.textContent).toContain('mcpHostStartupUnsupported')
  })

  it('does not offer a save when loading backend defaults fails', async () => {
    vi.mocked(api.fetchServerConfigDefaults).mockRejectedValueOnce(new Error('defaults unavailable'))
    await renderCreate()
    expect(document.body.textContent).toContain('defaults unavailable')
    expect(button('editorCreate')).toBeUndefined()
    expect(api.addMcpServer).not.toHaveBeenCalled()
  })

  it('creates an LSP definition through the shared shell without MCP policy fields', async () => {
    await renderCreate(h(ServerConfigModal, { kind: 'lsp', t, onClose: () => {}, onSaved: () => {} }))
    await act(async () => typeInto(input('lspServerName'), 'typescript'))
    await act(async () => button('detailJson')!.click())
    const config = { command: 'typescript-language-server', args: ['--stdio'], extensionToLanguage: { '.ts': 'typescript' } }
    await act(async () => typeInto(input('detailJson'), JSON.stringify(config)))
    await act(async () => button('editorCreate')!.click())
    expect(api.addLspServer).toHaveBeenCalledWith('typescript', config)
    expect(api.fetchServerConfigDefaults).not.toHaveBeenCalled()
    expect(api.addMcpServer).not.toHaveBeenCalled()
  })

  it.each(['mcp', 'lsp'] as const)('uses matching create and edit fields for %s', async kind => {
    const config = kind === 'mcp' ? { type: 'stdio', command: 'node' } : { command: 'language-server', extensionToLanguage: { '.ts': 'typescript' } }
    await renderCreate(h(ServerConfigModal, { kind, t, onClose: () => {}, onSaved: () => {} }))
    if (kind === 'mcp') await act(async () => button('mcpAdvanced')!.click())
    const fieldNames = (): string[] =>
      [...document.querySelectorAll('input[aria-label]')].map(node => node.getAttribute('aria-label')!).filter(name => !name.startsWith('detailExtensions'))
    const createFields = fieldNames()
    vi.mocked(api.fetchServerConfig).mockResolvedValueOnce({ ...DEFAULTS, kind, id: 'direct:service', key: 'service', config })
    await act(async () => root!.render(h(ServerConfigModal, { kind, id: 'direct:service', t, onClose: () => {}, onSaved: () => {} })))
    if (kind === 'mcp') await act(async () => button('mcpAdvanced')!.click())
    expect(fieldNames()).toEqual(createFields)
    expect(input(kind === 'mcp' ? 'mcpServerName' : 'lspServerName').readOnly).toBe(true)
    expect(input(kind === 'mcp' ? 'mcpServerName' : 'lspServerName').value).toBe('service')
    expect(button('save')).toBeDefined()
    expect(button('cancel')).toBeDefined()
  })
})
