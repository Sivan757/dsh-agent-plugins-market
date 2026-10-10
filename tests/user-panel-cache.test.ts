// @vitest-environment jsdom
/**
 * The user panels' client-side row cache.
 *
 * A panel is remounted on every tab switch, so the difference between "instant"
 * and "a spinner on every visit" is whether the last read's rows survive the
 * unmount. These tests drive the surface through that sequence and through the
 * edits that must never be undone by what the cache still holds.
 */
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubTranslate as t } from './helpers/translate.js'
import type { UserPanelKind } from '../packages/market-contracts/src/contracts/market.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const api = vi.hoisted(() => ({
  fetchModelCatalog: vi.fn(),
  readUserPanel: vi.fn(),
  fetchUserPanelEntry: vi.fn(),
  createUserPanelEntry: vi.fn(),
  updateUserPanelEntry: vi.fn(),
  deleteUserPanelEntry: vi.fn()
}))
vi.mock('../packages/market-ui/src/api.js', () => api)
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({
  ...(await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()),
  Button: (props: Record<string, unknown>) => h('button', props),
  Input: ({ icon: _icon, ...props }: Record<string, unknown>) => h('input', props),
  Modal: ({ children, footer, title }: { children: React.ReactNode; footer: React.ReactNode; title: string }) =>
    h('section', { role: 'dialog' }, h('h2', null, title), children, footer)
}))
import { UserPanelSurface } from '../packages/market-ui/src/ui/UserPanelSurface.js'

let root: Root | undefined
let host: HTMLDivElement | undefined

/** One panel row, shaped as the list route ships it (no document text). */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user:alpha-skill',
    name: 'alpha-skill',
    description: 'Alpha description',
    origin: 'user',
    metadata: {},
    path: '/user/skills/alpha-skill/SKILL.md',
    disabled: false,
    ...overrides
  }
}

/** A read under the test's own control, so "still loading" is a state and not a race. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => {
    resolve = settle
  })
  return { promise, resolve }
}

function settle(entries: Array<Record<string, unknown>>): { entries: Array<Record<string, unknown>>; translationPending: number } {
  return { entries, translationPending: 0 }
}

async function render(kind: UserPanelKind = 'skills'): Promise<void> {
  const element = document.createElement('div')
  document.body.append(element)
  const mounted = createRoot(element)
  host = element
  root = mounted
  await act(async () => mounted.render(h(UserPanelSurface, { t, kind })))
}

async function unmount(): Promise<void> {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
}

/** Visit the panel once so the next mount has rows to paint. */
async function visit(entries: Array<Record<string, unknown>>, kind: UserPanelKind = 'skills'): Promise<void> {
  api.readUserPanel.mockResolvedValueOnce(settle(entries))
  await render(kind)
  await unmount()
}

function switchButton(): HTMLButtonElement {
  const found = host?.querySelector<HTMLButtonElement>('button[role="switch"]')
  if (found === null || found === undefined) throw new Error('expected the entry enable switch')
  return found
}

async function click(text: string): Promise<void> {
  const button = [...(host?.querySelectorAll('button') ?? [])].find(item => item.textContent?.includes(text) || item.getAttribute('aria-label') === text)
  expect(button, text).toBeDefined()
  await act(async () => button!.click())
}

afterEach(async () => {
  if (root !== undefined) await unmount()
  vi.clearAllMocks()
})

describe('user panel row cache', () => {
  // First on purpose: a fresh module registry is what "never visited" means.
  it('shows the loading state only while a first visit has nothing to paint', async () => {
    const first = deferred<ReturnType<typeof settle>>()
    api.readUserPanel.mockReturnValueOnce(first.promise)
    await render()
    expect(host!.textContent).toContain('loading')
    expect(api.readUserPanel).toHaveBeenCalledWith('skills', false)

    await act(async () => first.resolve(settle([entry()])))
    expect(host!.textContent).toContain('alpha-skill')
    expect(host!.textContent).not.toContain('loading')
  })

  it('paints the previous rows on a revisit and revalidates behind them', async () => {
    await visit([entry()])
    const revalidate = deferred<ReturnType<typeof settle>>()
    api.readUserPanel.mockReturnValueOnce(revalidate.promise)
    await render()

    // The rows are on screen with no spinner while the read is still in flight.
    expect(host!.textContent).toContain('alpha-skill')
    expect(host!.textContent).not.toContain('loading')
    expect(api.readUserPanel).toHaveBeenLastCalledWith('skills', false)

    await act(async () => revalidate.resolve(settle([entry({ id: 'user:beta-skill', name: 'beta-skill', path: '/user/skills/beta-skill/SKILL.md' })])))
    expect(host!.textContent).toContain('beta-skill')
    expect(host!.textContent).not.toContain('alpha-skill')
    expect(host!.textContent).not.toContain('loading')
  })

  it('keeps the cached rows on screen when the revalidation fails', async () => {
    await visit([entry()])
    api.readUserPanel.mockRejectedValueOnce(new Error('offline'))
    await render()
    expect(host!.textContent).toContain('alpha-skill')
    expect(host!.textContent).not.toContain('loading')
  })

  it('never paints a pre-edit row after the edit the panel itself made', async () => {
    await visit([entry()])
    api.fetchUserPanelEntry.mockResolvedValue({ ...entry(), rawText: '---\nname: alpha-skill\ndescription: Alpha description\n---\nBody' })
    api.updateUserPanelEntry.mockResolvedValue(undefined)
    // The mount reads the enabled row; the toggle's own re-read answers with the
    // entry the write left behind.
    api.readUserPanel.mockResolvedValueOnce(settle([entry()])).mockResolvedValueOnce(settle([entry({ disabled: true })]))
    await render()
    expect(switchButton().getAttribute('aria-checked')).toBe('true')

    await act(async () => switchButton().click())
    expect(api.updateUserPanelEntry).toHaveBeenCalledWith('skills', 'user:alpha-skill', expect.stringContaining('disable-model-invocation: true'))
    expect(switchButton().getAttribute('aria-checked')).toBe('false')

    // Revisit: the row the edit produced is what the cache hands the next mount,
    // even though its own read has not answered yet.
    await unmount()
    const revisit = deferred<ReturnType<typeof settle>>()
    api.readUserPanel.mockReturnValueOnce(revisit.promise)
    await render()
    expect(switchButton().getAttribute('aria-checked')).toBe('false')
    await act(async () => revisit.resolve(settle([entry({ disabled: true })])))
    expect(switchButton().getAttribute('aria-checked')).toBe('false')
  })

  it("keeps the editor's own save in the cache", async () => {
    await visit([entry({ id: 'user:note-skill', name: 'note-skill' })])
    api.fetchUserPanelEntry.mockResolvedValue({
      ...entry({ id: 'user:note-skill', name: 'note-skill' }),
      rawText: '---\nname: note-skill\ndescription: Before the save\n---\nBody'
    })
    api.updateUserPanelEntry.mockResolvedValue(undefined)
    api.readUserPanel
      .mockResolvedValueOnce(settle([entry({ id: 'user:note-skill', name: 'note-skill' })]))
      .mockResolvedValueOnce(settle([entry({ id: 'user:note-skill', name: 'note-skill', description: 'After the save' })]))
    await render()
    await click('panelEditTitle')
    await click('panelSave')
    expect(api.updateUserPanelEntry).toHaveBeenCalled()

    await unmount()
    const revisit = deferred<ReturnType<typeof settle>>()
    api.readUserPanel.mockReturnValueOnce(revisit.promise)
    await render()
    // The saved description is what the cache paints, before any read lands.
    expect(host!.textContent).toContain('After the save')
    expect(host!.textContent).not.toContain('Before the save')
  })

  it('lets Refresh bypass the cache, and keeps a superseded read out of it', async () => {
    await visit([entry({ name: 'cached-skill' })])
    const stale = deferred<ReturnType<typeof settle>>()
    api.readUserPanel.mockReturnValueOnce(stale.promise)
    await render()
    expect(host!.textContent).toContain('cached-skill')

    // Refresh is the user asking for the tree as it stands: its own read, and
    // the host's row cache bypassed.
    api.readUserPanel.mockResolvedValueOnce(settle([entry({ name: 'fresh-skill' })]))
    await click('refresh')
    expect(api.readUserPanel).toHaveBeenLastCalledWith('skills', true)
    expect(host!.textContent).toContain('fresh-skill')

    // The read that started before Refresh lands last and carries older rows;
    // it must not become what the next visit paints.
    await act(async () => stale.resolve(settle([entry({ name: 'stale-skill' })])))
    await unmount()
    const revisit = deferred<ReturnType<typeof settle>>()
    api.readUserPanel.mockReturnValueOnce(revisit.promise)
    await render()
    expect(host!.textContent).toContain('fresh-skill')
    expect(host!.textContent).not.toContain('stale-skill')
  })
})
