// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { LspStatusEntry } from '../src/contracts/lsp-status.js'
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

async function mount(entry: LspStatusEntry = base): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(h(LspDetailModal, { entry, t, onClose: vi.fn() })))
}

const button = (text: string): HTMLButtonElement | undefined => [...document.querySelectorAll('button')].find(node => node.textContent === text)

it('leads with the sentence for the failure and discloses the recorded diagnostic', async () => {
  await mount({ ...base, code: 'mount-failed', reason: 'mount failed: spawn typescript-language-server ENOENT', causes: ['Error: spawn ENOENT'] })
  expect(document.body.textContent).toContain('failureGuideCommandMissing')
  expect(document.body.textContent).not.toContain('spawn typescript-language-server ENOENT')
  await act(async () => button('failureDetailToggle')!.click())
  expect(document.body.textContent).toContain('mount failed: spawn typescript-language-server ENOENT')
  expect(document.body.textContent).toContain('Error: spawn ENOENT')
})

it('reports a missing capability package as the component to reinstall', async () => {
  await mount({ ...base, state: 'host-missing', code: 'host-missing', reason: 'the @deepseek-ai/dsh-lsp-stdio package is not installed in this profile' })
  expect(document.body.textContent).toContain('failureGuideMissingPackage')
})

it('reports nothing when the row carries no reason', async () => {
  await mount({ ...base, state: 'mounted' })
  expect(document.body.textContent).not.toContain('lspReasonLabel')
  expect(button('failureDetailToggle')).toBeUndefined()
})
