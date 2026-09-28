// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { LspStatusEntry } from '../src/contracts/lsp-status.js'
import type { Translate } from '../src/client/index.js'
import { zh } from '../src/client/locales.js'
import { stubTranslate as t } from './helpers/translate.js'

vi.mock('../src/client/api.js', () => ({
  fetchLspStatus: vi.fn(),
  addLspServer: vi.fn(),
  migrateLspSeam: vi.fn(),
  fetchServerConfig: vi.fn(),
  saveServerConfig: vi.fn()
}))
import { LspDetailModal } from '../src/client/features/lsp/LspStatusPanel.js'
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot>

afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.replaceChildren()
  vi.clearAllMocks()
})

const base: LspStatusEntry = {
  id: 'src/ts/typescript',
  serverKey: 'typescript',
  suiteId: 'src/ts',
  suiteName: 'TS Suite',
  sourceId: 'src',
  kind: 'plugin',
  command: 'typescript-language-server',
  args: ['--stdio'],
  extensions: { '.ts': 'typescript' },
  state: 'failed'
}

async function mount(entry: LspStatusEntry = base, translate: Translate = t): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(h(LspDetailModal, { entry, t: translate, onClose: vi.fn() })))
}

/** The host disclosure row is a `role="button"` div when the whole row expands. */
const disclosure = (text: string): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>('[data-disclosure-row]')].find(node => node.textContent === text)
const band = (): HTMLElement => document.querySelector<HTMLElement>('[data-status-band]')!

it('leads the band with the sentence for the failure and discloses the recorded diagnostic', async () => {
  await mount({ ...base, code: 'mount-failed', reason: 'mount failed: spawn typescript-language-server ENOENT', causes: ['Error: spawn ENOENT'] })
  expect(band().textContent).toContain('failureGuideCommandMissing')
  expect(band().textContent).not.toContain('spawn typescript-language-server ENOENT')
  await act(async () => disclosure('failureDetailToggle')!.click())
  expect(document.body.textContent).toContain('mount failed: spawn typescript-language-server ENOENT')
  expect(document.body.textContent).toContain('Error: spawn ENOENT')
})

it('titles the dialog with the readable server key', async () => {
  await mount()
  // The heading is the server key, never the suite name or a mount identity.
  expect(document.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('typescript')
})

it('marks the band edge with the same state the card uses', async () => {
  await mount({ ...base, state: 'conflict', reason: 'seam conflict' })
  expect(band().getAttribute('data-band-tone')).toBe('error')
  await act(async () => root.unmount())
  await mount({ ...base, state: 'mounted' })
  expect(band().getAttribute('data-band-tone')).toBe('success')
})

it('reports a missing capability package as the component to reinstall', async () => {
  await mount({ ...base, state: 'host-missing', code: 'host-missing', reason: 'the @deepseek-ai/dsh-lsp-stdio package is not installed in this profile' })
  expect(band().textContent).toContain('failureGuideMissingPackage')
})

it('reads in the interface language, with the recorded diagnostic only in the disclosure', async () => {
  // The real dictionary, not the key-echoing stub: this is the text a reader sees.
  const zhTranslate: Translate = key => zh[key]
  await mount({ ...base, code: 'mount-failed', reason: 'mount failed: spawn typescript-language-server ENOENT', causes: ['Error: spawn ENOENT'] }, zhTranslate)
  expect(band().textContent).toContain(zh.failureGuideCommandMissing)
  expect(document.body.textContent).not.toContain('spawn typescript-language-server ENOENT')
  await act(async () => disclosure(zh.failureDetailToggle)!.click())
  expect(document.body.textContent).toContain('spawn typescript-language-server ENOENT')
})

it('reports nothing when the row carries no reason', async () => {
  await mount({ ...base, state: 'mounted' })
  expect(disclosure('failureDetailToggle')).toBeUndefined()
})
