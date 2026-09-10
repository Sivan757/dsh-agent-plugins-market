// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { McpStatusEntry } from '../src/contracts/mcp-status.js'
import type { Translate } from '../src/client/index.js'

vi.mock('../src/client/ui/ServerConfigDetail.js', () => ({
  ServerConfigDetail: ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => h('button', { onClick: () => onDirtyChange(true) }, 'edit-config')
}))
import { McpDetailModal } from '../src/client/McpStatusPanel.js'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot>
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.replaceChildren()
})
const t: Translate = key => key
const base: McpStatusEntry = { id: 'service', name: 'service', kind: 'plugin', state: 'failed', transport: 'streamable-http', tools: [], canReauthorize: true }
async function mount(entry = base) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const retry = vi.fn(async () => ({ ...entry, state: 'connected' as const }))
  const authorize = vi.fn(async () => ({ ...entry, state: 'failed' as const, reason: 'still offline' }))
  await act(async () => root.render(h(McpDetailModal, { entry, t, onClose: vi.fn(), onRetry: retry, onReauthorize: authorize, onRefresh: retry })))
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
