// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { McpStatusEntry } from '../src/contracts/mcp-status.js'
import { stubTranslate as t } from './helpers/translate.js'

const apiMock = vi.hoisted(() => ({ setMcpServerTool: vi.fn(async () => {}) }))
vi.mock('../src/client/api.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/client/api.js')>()),
  setMcpServerTool: apiMock.setMcpServerTool
}))

vi.mock('../src/client/ui/ServerConfigDetail.js', () => ({
  ServerConfigDetail: ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => h('button', { onClick: () => onDirtyChange(true) }, 'edit-config')
}))
import { McpDetailModal } from '../src/client/McpStatusPanel.js'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot>
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.replaceChildren()
  vi.clearAllMocks()
})
const base: McpStatusEntry = { id: 'service', name: 'service', kind: 'plugin', state: 'failed', transport: 'streamable-http', tools: [], canReauthorize: true }
async function mount(entry = base, backend: 'builtin' | 'host' = 'builtin') {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const retry = vi.fn(async () => ({ ...entry, state: 'connected' as const }))
  const authorize = vi.fn(async () => ({ ...entry, state: 'failed' as const, reason: 'still offline' }))
  await act(async () => root.render(h(McpDetailModal, { entry, t, backend, onClose: vi.fn(), onRetry: retry, onReauthorize: authorize, onRefresh: retry })))
  return { retry, authorize }
}
const button = (text: string) => [...document.querySelectorAll('button')].find(node => node.textContent === text)!
it('has no enable switch, confirms destructive authorization and reports actual failure', async () => {
  const { authorize } = await mount()
  expect(document.querySelector('[role="switch"]')).toBeNull()
  expect(button('mcpRetryConnection')).toBeDefined()
  await act(async () => button('mcpReauthorize').click())
  expect(authorize).not.toHaveBeenCalled()
  await act(async () => button('mcpConfirmReauth').click())
  expect(authorize).toHaveBeenCalledWith('service', 'service')
  expect(document.body.textContent).toContain('still offline')
  expect(document.body.textContent).not.toContain('mcpRetrySuccess')
})
it('prevents connection actions from using stale saved configuration', async () => {
  await mount()
  await act(async () => button('edit-config').click())
  expect(button('mcpRetryConnection').disabled).toBe(true)
  expect(button('mcpReauthorize').disabled).toBe(true)
  expect(document.body.textContent).toContain('mcpSaveFirst')
})
it('shows close but no connection actions for external servers', async () => {
  await mount({ ...base, kind: 'direct', canReauthorize: false })
  expect(button('mcpClose')).toBeDefined()
  expect(button('mcpRetryConnection')).toBeUndefined()
  expect(button('mcpReauthorize')).toBeUndefined()
})
it('says that a remote server authorizes without declaring it', async () => {
  await mount({ ...base, oauthDefault: true })
  expect(document.body.textContent).toContain('mcpOauthDefault')
  await act(async () => root.unmount())
  await mount({ ...base, transport: 'stdio' })
  expect(document.body.textContent).not.toContain('mcpOauthDefault')
})

/** One declared server whose tool list carries all three checkbox states. */
const toolEntry: McpStatusEntry = {
  ...base,
  state: 'connected',
  suiteId: 'demo',
  serverKey: 'service',
  tools: [
    { name: 'alpha', description: 'first' },
    { name: 'delta', description: 'fourth' }
  ],
  suiteEnabledTools: ['alpha', 'beta', 'delta'],
  suiteDisabledTools: ['epsilon'],
  userDisabledTools: ['delta'],
  advertisedTools: true
}

const checkbox = (name: string): HTMLInputElement => document.body.querySelector<HTMLInputElement>(`input[aria-label="mcpAllowTool ${name}"]`)!

it('lists registered, suite and user tools with a checkbox per name', async () => {
  await mount(toolEntry)
  // beta is only in the suite allow-list and epsilon only in its deny list, so
  // the stored lists are what keep a non-registered tool on screen.
  expect([...document.body.querySelectorAll('input[type="checkbox"]')].map(node => node.getAttribute('aria-label'))).toEqual([
    'mcpAllowTool alpha',
    'mcpAllowTool beta',
    'mcpAllowTool delta',
    'mcpAllowTool epsilon'
  ])
  expect(checkbox('alpha').checked).toBe(true)
  expect(checkbox('alpha').disabled).toBe(false)
  // A tool the user turned off stays selectable so it can come back on.
  expect(checkbox('delta').checked).toBe(false)
  expect(checkbox('delta').disabled).toBe(false)
  // A tool the suite limits is unchecked and fixed.
  expect(checkbox('epsilon').checked).toBe(false)
  expect(checkbox('epsilon').disabled).toBe(true)
  expect(checkbox('beta').checked).toBe(true)
  expect(document.body.textContent).toContain('mcpToolSuiteLimited')
})

it('allows a rejected tool again and refreshes the row', async () => {
  const { retry } = await mount(toolEntry)
  await act(async () => {
    checkbox('delta').click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  expect(apiMock.setMcpServerTool).toHaveBeenCalledWith('demo', 'service', 'delta', true)
  expect(retry).toHaveBeenCalledWith('service')
})

it('reports a failed tool change in place', async () => {
  apiMock.setMcpServerTool.mockRejectedValueOnce(new Error('backend refused'))
  await mount(toolEntry)
  await act(async () => {
    checkbox('alpha').click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  expect(document.body.textContent).toContain('backend refused')
})

it('disables every checkbox and names the reason on the host compatibility backend', async () => {
  await mount(toolEntry, 'host')
  expect(checkbox('alpha').disabled).toBe(true)
  expect(document.body.textContent).toContain('mcpHostToolsUnsupported')
})

it('leaves a foreign mount read-only', async () => {
  await mount({ ...toolEntry, state: 'foreign' })
  expect(document.body.querySelector('input[type="checkbox"]')).toBeNull()
  expect(document.body.textContent).toContain('alpha')
})
