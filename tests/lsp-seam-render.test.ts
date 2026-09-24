// @vitest-environment jsdom

globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/**
 * A conflict payload with the profile layer behind it. `fetchLspStatus` is
 * re-read by the panel's own poll, so the mock returns the seam until the
 * migration resolves and then reports a clean inventory.
 */
const conflicted = vi.hoisted(() => ({
  entries: [
    {
      id: 'src/ts/typescript',
      serverKey: 'typescript',
      suiteId: 'src/ts',
      suiteName: 'TS Suite',
      sourceId: 'src',
      kind: 'plugin' as const,
      command: 'typescript-language-server',
      args: ['--stdio'],
      extensions: { '.ts': 'typescript' },
      state: 'conflict' as const,
      reason: 'the profile already registers its own @deepseek-ai/dsh-lsp'
    }
  ],
  observedAt: '',
  totals: { all: 1, mounted: 0, failed: 0, blocked: 1, disabled: 0 },
  hostMissing: false,
  legacySeam: {
    profile: 'web',
    patchPath: '/home/u/.dsh/profiles/web/cordis.patch.yml',
    rows: [
      { id: 'lsp', name: '@deepseek-ai/dsh-lsp' },
      { id: 'tool-lsp', name: '@deepseek-ai/dsh-tool-lsp' }
    ],
    otherProfiles: ['rescue'],
    restartRequired: false,
    summary: 'profile "web" still inserts the LSP layer from /home/u/.dsh/profiles/web/cordis.patch.yml'
  }
}))

const clean = vi.hoisted(() => ({ entries: [], observedAt: '', totals: { all: 0, mounted: 0, failed: 0, blocked: 0, disabled: 0 }, hostMissing: false }))

vi.mock('../src/client/api.js', () => ({
  fetchLspStatus: vi.fn().mockResolvedValue(conflicted),
  addLspServer: vi.fn(),
  migrateLspSeam: vi.fn().mockResolvedValue({
    profile: 'web',
    patchPath: '/home/u/.dsh/profiles/web/cordis.patch.yml',
    backupPath: '/home/u/.dsh/profiles/web/cordis.patch.yml.bak-lsp-seam-20260913-163005',
    restartRequired: false
  }),
  fetchServerConfig: vi.fn(),
  saveServerConfig: vi.fn()
}))

import { LspStatusPanel } from '../src/client/features/lsp/LspStatusPanel.js'
import type { Translate } from '../src/client/index.js'

const t: Translate = key => String(key)

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.clearAllMocks()
})

async function mountPanel(): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(h(LspStatusPanel, { t }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  return host
}

describe('LSP legacy seam banner', () => {
  it('names the profile and the file, and removes exactly that profile', async () => {
    const api = await import('../src/client/api.js')
    const el = await mountPanel()

    // The banner is the upgrade repair, and it is verifiable by hand: the
    // panel shows the file the action will edit.
    expect(el.textContent).toContain('lspSeamTitle')
    expect(el.textContent).toContain('/home/u/.dsh/profiles/web/cordis.patch.yml')
    // Other profiles keep their layer; the copy says so rather than implying a sweep.
    expect(el.textContent).toContain('rescue')

    const button = [...el.querySelectorAll('button')].find(node => node.textContent === 'lspSeamRemove')
    expect(button).toBeDefined()
    vi.mocked(api.fetchLspStatus).mockResolvedValue(clean)
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(api.migrateLspSeam).toHaveBeenCalledWith('web')
    // The confirmation carries the backup path so the edit stays reversible.
    expect(el.textContent).toContain('lspSeamDone')
    expect(el.textContent).toContain('cordis.patch.yml.bak-lsp-seam-20260913-163005')
  })

  it('renders no banner when the host reports no legacy layer', async () => {
    const api = await import('../src/client/api.js')
    vi.mocked(api.fetchLspStatus).mockResolvedValue(clean)
    const el = await mountPanel()
    expect(el.textContent).not.toContain('lspSeamTitle')
  })
})

describe('LSP card actions', () => {
  it('opens the editor from the card and leaves the report without one', async () => {
    const api = await import('../src/client/api.js')
    vi.mocked(api.fetchLspStatus).mockResolvedValue({ ...conflicted, legacySeam: undefined })
    vi.mocked(api.fetchServerConfig).mockResolvedValue({
      kind: 'lsp',
      id: 'plugin:typescript-lsp/typescript',
      key: 'typescript',
      editable: true,
      config: { command: 'typescript-language-server', args: ['--stdio'] }
    })
    const el = await mountPanel()
    const edit = el.querySelector<HTMLButtonElement>('[aria-label="panelEdit typescript"]')
    expect(edit).not.toBeNull()

    // The report itself carries no edit entry.
    const card = [...el.querySelectorAll('[role="button"]')].find(node => (node.textContent ?? '').startsWith('typescript'))
    await act(async () => {
      card!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.body.textContent).not.toContain('serviceConfigLabel')

    await act(async () => {
      edit!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(document.body.textContent).toContain('lspEditTitle')
  })
})
