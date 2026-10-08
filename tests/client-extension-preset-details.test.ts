// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ExtensionDetailView } from '../packages/market-ui/src/workspace/ExtensionResourceDetail.js'
import { McpDetailModal } from '../packages/market-ui/src/features/mcp/McpDetailModal.js'
import type { ExtensionResource } from '../packages/market-contracts/src/contracts/extension-presets.js'
import type { McpStatusEntry } from '../packages/market-contracts/src/contracts/mcp-status.js'
import type { LspStatusEntry } from '../packages/market-contracts/src/contracts/lsp-status.js'
import * as api from '../packages/market-ui/src/api.js'
vi.mock('../packages/market-ui/src/api.js', async original => ({
  ...(await original<typeof import('../packages/market-ui/src/api.js')>()),
  fetchMcpStatus: vi.fn(),
  fetchLspStatus: vi.fn(),
  setMcpServerTool: vi.fn(),
  retryMcpMounts: vi.fn(),
  reauthorizeMcpServer: vi.fn()
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot>
const mcp: McpStatusEntry = {
  id: 'service',
  name: 'service',
  suiteId: 'suite',
  serverKey: 'service',
  kind: 'plugin',
  state: 'failed',
  transport: 'streamable-http',
  canReauthorize: true,
  tools: [{ name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }]
}
const lsp: LspStatusEntry = {
  id: 'typescript',
  serverKey: 'typescript',
  suiteId: 'suite',
  suiteName: 'Suite',
  sourceId: 'source',
  kind: 'plugin',
  command: 'typescript-language-server',
  args: ['--stdio'],
  extensions: { '.ts': 'typescript' },
  state: 'mounted'
}
const row = (kind: 'mcp' | 'lsp', entryId: string): ExtensionResource => ({
  id: kind + ':' + entryId,
  face: kind,
  name: entryId,
  source: 'source',
  available: true,
  detail: { kind, entryId }
})
const t = (key: string) => key
async function render(resource: ExtensionResource) {
  if (!root) {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }
  await act(async () => root.render(h(ExtensionDetailView, { resource, t, onClose: vi.fn() })))
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined!
  document.body.replaceChildren()
  vi.resetAllMocks()
})
it('shows complete MCP tools without global filter, retry or auth mutations', async () => {
  vi.mocked(api.fetchMcpStatus).mockResolvedValue({ entries: [mcp], backend: 'builtin' } as Awaited<ReturnType<typeof api.fetchMcpStatus>>)
  await render(row('mcp', mcp.id))
  expect(document.body.textContent).toContain('read_file')
  expect(document.querySelector('input[type="checkbox"]')).toBeNull()
  expect(document.body.textContent).not.toContain('mcpRetryConnection')
  expect(document.body.textContent).not.toContain('mcpReauthorize')
  const tool = [...document.querySelectorAll('button')].find(button => button.textContent === 'read_file')!
  await act(async () => tool.click())
  expect(document.body.textContent).toContain('path')
  expect(api.setMcpServerTool).not.toHaveBeenCalled()
  expect(api.retryMcpMounts).not.toHaveBeenCalled()
  expect(api.reauthorizeMcpServer).not.toHaveBeenCalled()
})
it('suppresses pending auth confirmation when changed to read-only', async () => {
  await render(row('lsp', lsp.id))
  const retry = vi.fn(async () => mcp),
    auth = vi.fn(async () => mcp)
  const props = { entry: mcp, backend: 'builtin' as const, t, onClose: vi.fn(), onRetry: retry, onReauthorize: auth, onRefresh: retry }
  await act(async () => root.render(h(McpDetailModal, props)))
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'mcpReauthorize')!.click())
  expect(document.body.textContent).toContain('mcpConfirmReauth')
  await act(async () => root.render(h(McpDetailModal, { ...props, readOnly: true })))
  expect(document.body.textContent).not.toContain('mcpConfirmReauth')
  expect(retry).not.toHaveBeenCalled()
  expect(auth).not.toHaveBeenCalled()
})
it('opens a single Hook declaration with its full command and diagnostic', async () => {
  const command = 'node -e "' + 'a'.repeat(200) + '"'
  await render({
    id: 'hooks:source/suite/SessionStart/0',
    face: 'hooks',
    name: command,
    source: 'Suite',
    available: true,
    detail: {
      kind: 'hook',
      sourceId: 'source',
      suiteId: 'suite',
      event: 'SessionStart',
      hookIndex: 0,
      provenance: 'Suite',
      command,
      matcher: 'startup|resume',
      timeoutSec: 12,
      support: 'supported',
      diagnostic: 'fixture diagnostic'
    }
  })
  expect(document.querySelector('pre')?.textContent).toBe(command)
  expect(document.body.textContent).toContain('SessionStart')
  expect(document.body.textContent).toContain('startup|resume')
  expect(document.body.textContent).toContain('fixture diagnostic')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('hookDetailTimeout')
  expect(document.querySelector('input')).toBeNull()
  expect(api.fetchMcpStatus).not.toHaveBeenCalled()
  expect(api.fetchLspStatus).not.toHaveBeenCalled()
})
it('uses the full LSP detail rather than navigating to settings', async () => {
  vi.mocked(api.fetchLspStatus).mockResolvedValue({ entries: [lsp] } as Awaited<ReturnType<typeof api.fetchLspStatus>>)
  await render({ ...row('lsp', lsp.id), detail: { kind: 'lsp', entryId: lsp.id, sessionId: 'project-session' } })
  expect(api.fetchLspStatus).toHaveBeenCalledWith(false, 'project-session')
  expect(document.body.textContent).toContain('typescript-language-server --stdio')
  expect(document.body.textContent).toContain('.ts')
  expect(document.body.textContent).not.toContain('epPanel')
})
it('ignores late success from a previously selected resource', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof api.fetchMcpStatus>>) => void
  vi.mocked(api.fetchMcpStatus).mockReturnValue(
    new Promise(done => {
      resolve = done
    })
  )
  vi.mocked(api.fetchLspStatus).mockResolvedValue({ entries: [lsp] } as Awaited<ReturnType<typeof api.fetchLspStatus>>)
  await render(row('mcp', mcp.id))
  await render(row('lsp', lsp.id))
  await act(async () => resolve({ entries: [mcp] } as Awaited<ReturnType<typeof api.fetchMcpStatus>>))
  expect(document.body.textContent).toContain('typescript-language-server')
  expect(document.body.textContent).not.toContain('read_file')
})
