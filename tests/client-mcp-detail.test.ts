// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { McpStatusEntry } from '../src/contracts/mcp-status.js'
import type { Translate } from '../src/client/index.js'
import { zh } from '../src/client/locales.js'
import { stubTranslate as t } from './helpers/translate.js'

const apiMock = vi.hoisted(() => ({ setMcpServerTool: vi.fn(async () => {}), setMcpServerEnabled: vi.fn(async () => {}) }))
vi.mock('../src/client/api.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/client/api.js')>()),
  setMcpServerTool: apiMock.setMcpServerTool,
  setMcpServerEnabled: apiMock.setMcpServerEnabled
}))

vi.mock('../src/client/ui/ServerConfigDetail.js', () => ({
  ServerConfigDetail: ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => h('button', { onClick: () => onDirtyChange(true) }, 'edit-config')
}))
import { McpDetailModal } from '../src/client/features/mcp/McpDetailModal.js'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot>
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.replaceChildren()
  vi.clearAllMocks()
})
const base: McpStatusEntry = { id: 'service', name: 'service', kind: 'plugin', state: 'failed', transport: 'streamable-http', tools: [], canReauthorize: true }
async function mount(entry = base, backend: 'builtin' | 'host' = 'builtin', translate: Translate = t) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const retry = vi.fn(async () => ({ ...entry, state: 'connected' as const }))
  const authorize = vi.fn(async () => ({ ...entry, state: 'failed' as const, reason: 'still offline' }))
  await act(async () => root.render(h(McpDetailModal, { entry, t: translate, backend, onClose: vi.fn(), onRetry: retry, onReauthorize: authorize, onRefresh: retry })))
  return { retry, authorize }
}
const button = (text: string) => [...document.querySelectorAll('button')].find(node => node.textContent === text)!
/** The host disclosure row is a `role="button"` div when the whole row expands. */
const disclosure = (text: string): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>('[data-disclosure-row]')].find(node => node.textContent === text)
const band = (): HTMLElement => document.querySelector<HTMLElement>('[data-status-band]')!

it('has no enable switch, confirms destructive authorization and reports actual failure', async () => {
  const { authorize } = await mount()
  expect(document.querySelector('[role="switch"]')).toBeNull()
  expect(button('mcpRetryConnection')).toBeDefined()
  await act(async () => button('mcpReauthorize').click())
  expect(authorize).not.toHaveBeenCalled()
  await act(async () => button('mcpConfirmReauth').click())
  expect(authorize).toHaveBeenCalledWith('service', 'service')
  // The echo rides inside the status band and says what the operation did; the
  // reason itself belongs to the band's reason line, so the sentence the
  // operation returns never repeats it.
  expect(band().textContent).toContain('mcpStillUnavailable')
  expect(document.body.textContent).not.toContain('still offline')
  expect(document.body.textContent).not.toContain('mcpRetrySuccess')
})
it('reports without an editing entry of its own', async () => {
  await mount({ ...base, suiteId: 'demo', serverKey: 'web' })
  // Editing is the card's action; the detail dialog stays a reading surface.
  expect([...document.body.querySelectorAll('button')].some(node => node.textContent === 'panelEdit')).toBe(false)
  expect(document.body.querySelector('input')).toBeNull()
})
it('keeps the enable switch out of the detail dialog and the service configuration out of the report', async () => {
  await mount({ ...base, suiteId: 'demo', serverKey: 'web' })
  expect(document.querySelectorAll('[role="switch"]').length).toBe(0)
  const headings = [...document.querySelectorAll('h4')].map(node => node.textContent ?? '')
  expect(headings.some(value => value.startsWith('mcpTools'))).toBe(true)
  expect(headings.includes('serviceConfigLabel')).toBe(false)
})
it('titles a plugin row with its readable server key and shows the mount name in the overview', async () => {
  await mount({ ...base, suiteId: 'demo', serverKey: 'chrome-devtools', name: 'chrome-devtools__chrome-devtools' })
  // The heading is the declaration key a reader recognizes; the runtime's full
  // mount identity moves to its own overview row.
  expect(document.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('chrome-devtools')
  expect([...document.querySelectorAll('dt')].some(node => node.textContent === 'mcpMountNameLabel')).toBe(true)
  expect(document.body.textContent).toContain('chrome-devtools__chrome-devtools')
})
it('leaves out the mount-name row when the declaration mounts under its own key', async () => {
  // A user's own mcp.json owns the top-level namespace, so its mount name and
  // server key are the same string and there is nothing extra to name.
  await mount({ ...base, suiteId: '@user-mcp/user-mcp', serverKey: 'kuboard', name: 'kuboard' })
  expect([...document.querySelectorAll('dt')].some(node => node.textContent === 'mcpMountNameLabel')).toBe(false)
})
it('titles a direct row with its own name', async () => {
  await mount({ ...base, kind: 'direct', name: 'my-server', canReauthorize: false })
  expect(document.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('my-server')
})
it('reveals a tool’s parameters from its own row', async () => {
  await mount({
    ...base,
    state: 'connected',
    tools: [
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string', description: 'File to read' } }, required: ['path'] }
      }
    ]
  })
  expect(document.body.textContent).not.toContain('File to read')
  const name = [...document.body.querySelectorAll('button')].find(node => node.textContent === 'read_file')
  expect(name).toBeDefined()
  await act(async () => {
    name!.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  expect(document.body.textContent).toContain('File to read')
  expect(document.body.textContent).toContain('mcpToolParamRequired')
})
it('leads the band with the next thing to check and keeps the recorded diagnostic behind its disclosure', async () => {
  await mount({
    ...base,
    state: 'failed',
    code: 'mount-failed',
    reason: 'mount failed: mcp-client(service): initial connection or tool synchronization failed',
    causes: ['spawn npx ENOENT']
  })
  // The wrapper sentence names no cause, so the sentence for the cause the
  // chain reveals leads the band.
  expect(band().textContent).toContain('failureGuideCommandMissing')
  expect(band().textContent).not.toContain('spawn npx ENOENT')
  expect(document.body.textContent).not.toContain('initial connection or tool synchronization failed')
  await act(async () => disclosure('failureDetailToggle')!.click())
  expect(document.body.textContent).toContain('spawn npx ENOENT')
  expect(document.body.textContent).toContain('initial connection or tool synchronization failed')
})

it('marks the band edge with the same state the card uses', async () => {
  await mount({ ...base, state: 'failed' })
  expect(band().getAttribute('data-band-tone')).toBe('error')
  await act(async () => root.unmount())
  await mount({ ...base, state: 'disabled' })
  expect(band().getAttribute('data-band-tone')).toBe('neutral')
  await act(async () => root.unmount())
  await mount({ ...base, state: 'connected' })
  expect(band().getAttribute('data-band-tone')).toBe('success')
})
it('keeps a reason without a recognizable shape as the line the band shows', async () => {
  await mount({ ...base, state: 'disabled', reason: 'modified by override' })
  expect(band().textContent).toContain('modified by override')
  // Nothing is classified, so there is no sentence to invent and no second
  // copy of the line to disclose.
  expect(disclosure('failureDetailToggle')).toBeUndefined()
})

it('reads in the interface language, with the recorded diagnostic only in the disclosure', async () => {
  // The real dictionary, not the key-echoing stub: this is the text a reader sees.
  const zhTranslate: Translate = key => zh[key]
  await mount(
    {
      ...base,
      code: 'mount-failed',
      reason: 'mount failed: mcp-client(service): initial connection or tool synchronization failed',
      causes: ['spawn npx ENOENT']
    },
    'builtin',
    zhTranslate
  )
  expect(band().textContent).toContain(zh.failureGuideCommandMissing)
  expect(document.body.textContent).not.toContain('initial connection or tool synchronization failed')
  await act(async () => disclosure(zh.failureDetailToggle)!.click())
  expect(document.body.textContent).toContain('initial connection or tool synchronization failed')
  expect(document.body.textContent).toContain('spawn npx ENOENT')
})
it('shows no footer actions for external servers', async () => {
  await mount({ ...base, kind: 'direct', canReauthorize: false })
  expect(button('mcpClose')).toBeUndefined()
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

it('reads an empty tool list on a failed mount as unreachable, not as a server with no tools', async () => {
  await mount({ ...base, state: 'failed', code: 'mount-failed', reason: 'connection refused' })
  expect(document.body.textContent).toContain('mcpToolsUnreachable')
  expect(document.body.textContent).not.toContain('mcpNoTools')
})
