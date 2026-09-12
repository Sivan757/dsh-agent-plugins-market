// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubTranslate as t } from './helpers/translate.js'
import { parse } from 'yaml'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const api = vi.hoisted(() => ({ fetchModelCatalog: vi.fn(), fetchUserPanel: vi.fn(), createUserPanelEntry: vi.fn(), updateUserPanelEntry: vi.fn(), deleteUserPanelEntry: vi.fn() }))
vi.mock('../src/client/api.js', () => api)
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({
  ...(await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()),
  Button: (props: Record<string, unknown>) => h('button', props),
  Input: (props: Record<string, unknown>) => h('input', props),
  Modal: ({ children, footer, title }: { children: React.ReactNode; footer: React.ReactNode; title: string }) =>
    h('section', { role: 'dialog' }, h('h2', null, title), children, footer)
}))
import { UserPanelSurface } from '../src/client/ui/UserPanelSurface.js'
let root: Root
let host: HTMLDivElement
const plugin = {
  id: 'plugin:suite:reviewer',
  name: 'reviewer',
  description: 'Review implementation',
  origin: 'plugin',
  suiteName: 'Review suite',
  metadata: { model: 'provider/model', tools: ['Read'] },
  rawText: '---\nmodel: provider/model\ntools: [Read]\n---\nReview code',
  content: 'Review code',
  path: '/plugins/reviewer.md',
  disabled: false
}
const user = { ...plugin, id: 'user:reviewer', origin: 'user', path: '/user/reviewer.md' }
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(text))
  expect(button, text).toBeDefined()
  await act(async () => button!.click())
}
/** Mount the panel into a fresh host; both cases start from a blank document. */
async function mountPanel() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(h(UserPanelSurface, { t, kind: 'agents' })))
}
afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  vi.clearAllMocks()
})

describe('unified Markdown resource panel', () => {
  it('loads provider models on demand and saves the selected pair into the original frontmatter', async () => {
    api.fetchUserPanel.mockResolvedValue([user])
    const providers = [
      { id: 'provider', name: 'Provider' },
      { id: 'second', name: 'Second' }
    ]
    api.fetchModelCatalog.mockImplementation(async (provider?: string) => ({
      providers,
      models: provider === 'second' ? [{ id: 'model-b', name: 'Model B' }] : [{ id: 'model', name: 'Model' }]
    }))
    api.updateUserPanelEntry.mockResolvedValue(undefined)
    await mountPanel()
    expect(api.fetchModelCatalog).not.toHaveBeenCalled()
    await click('reviewer')
    const select = async (index: number, value: string) => {
      await act(async () => {
        const input = host.querySelectorAll('select')[index]
        input.value = value
        input.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }
    await select(0, 'second')
    expect(api.fetchModelCatalog).toHaveBeenLastCalledWith('second', expect.any(AbortSignal))
    await click('panelSave')
    expect(api.updateUserPanelEntry).not.toHaveBeenCalled()
    await select(1, 'model-b')
    await click('panelSave')
    expect(api.updateUserPanelEntry).toHaveBeenCalledWith('agents', user.id, expect.stringContaining('provider: second'))
    const raw = api.updateUserPanelEntry.mock.calls[0][2] as string
    expect(raw).toContain('model: model-b')
    const frontmatter: unknown = parse(raw.split('---\n')[1])
    expect(frontmatter).toHaveProperty('tools', ['Read'])
    expect(raw).toContain('Review code')
  })

  it('shows plugin and user entries, filters source, and updates duplicate names by stable id', async () => {
    api.fetchUserPanel.mockResolvedValue([plugin, user])
    api.fetchModelCatalog.mockResolvedValue({ providers: [{ id: 'provider', name: 'Provider' }], models: [{ id: 'model', name: 'Model' }] })
    api.updateUserPanelEntry.mockResolvedValue(undefined)
    await mountPanel()
    expect(host.textContent).toContain('workspaceTabPersonas')
    expect(host.textContent).toContain('personasPanelDescription')
    expect(host.querySelectorAll('input').length).toBeGreaterThan(0)
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="list"]')!.click())
    await click('panelSourcePlugin')
    expect(host.textContent).toContain('/plugins/reviewer.md')
    expect(host.textContent).not.toContain('/user/reviewer.md')
    await click('reviewer')
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('personaRuntimeConfig')
    expect([...host.querySelectorAll('select')].map(select => select.value)).toEqual(['provider', 'model', ''])
    await click('panelSave')
    expect(api.updateUserPanelEntry).toHaveBeenCalledWith('agents', plugin.id, plugin.rawText)
    await act(async () => root.render(h(UserPanelSurface, { t, kind: 'skills' })))
    expect(host.textContent).toContain('/user/reviewer.md')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
})
