// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { LspStatusEntry } from '../../../../packages/market-contracts/src/contracts/lsp-status.js'
import type { Translate } from '../../../../packages/market-ui/src/index.js'
import { zh } from '../../../../packages/market-ui/src/locales.js'
import { stubTranslate as t } from '../../../market-ui/test/helpers/translate.js'

vi.mock('../../../../packages/market-ui/src/api.js', () => ({
  fetchLspStatus: vi.fn(),
  addLspServer: vi.fn(),
  migrateLspSeam: vi.fn(),
  restartLspServers: vi.fn(),
  fetchServerConfig: vi.fn(),
  saveServerConfig: vi.fn()
}))
import { LspDetailModal } from '../../../../packages/market-ui/src/features/lsp/LspStatusPanel.js'
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

async function mount(entry: LspStatusEntry = base, translate: Translate = t, onRestart?: (entry: LspStatusEntry) => Promise<LspStatusEntry>): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(h(LspDetailModal, { entry, t: translate, onClose: vi.fn(), ...(onRestart === undefined ? {} : { onRestart }) })))
}

/** The band's one recovery action, found by the label it renders. */
const restartButton = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-status-band] button')].find(node => node.textContent?.includes('lspRestart'))

/** The host disclosure row is a `role="button"` div when the whole row expands. */
const disclosure = (text: string): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>('[data-disclosure-row]')].find(node => node.textContent === text)
const band = (): HTMLElement => document.querySelector<HTMLElement>('[data-status-band]')!

it('shows the last call an lsp provider answered, so a mounted server that stopped answering says why', async () => {
  // The shared stub returns keys; this case reads the interpolated sentence too.
  const interpolate = ((key: string, params?: Record<string, string>) => (params === undefined ? key : [key, ...Object.values(params)].join(' '))) as Translate
  await mount(
    {
      ...base,
      state: 'mounted',
      observation: { at: 1_700_000_000_000, ok: false, error: 'language server exited with code 1' }
    },
    interpolate
  )
  const text = document.body.textContent ?? ''
  expect(text).toContain('lspLastCall')
  expect(text).toContain('lspLastCallFailed')
  expect(text).toContain('language server exited with code 1')
})

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

it('offers a restart on a row whose process may have died and echoes what it did', async () => {
  // The seam reports no death, so a mounted row is exactly the one the user
  // needs this action for: nothing else re-verifies that mount.
  const attempted: LspStatusEntry[] = []
  const onRestart = async (entry: LspStatusEntry): Promise<LspStatusEntry> => {
    attempted.push(entry)
    return { ...entry, state: 'mounted' }
  }
  await mount({ ...base, state: 'mounted' }, t, onRestart)
  expect(restartButton()).toBeDefined()
  await act(async () => restartButton()!.click())
  expect(attempted).toHaveLength(1)
  expect(document.body.textContent).toContain('lspRestartDone')
})

it('reports a row that is still failing after the restart', async () => {
  await mount({ ...base, state: 'failed', code: 'mount-failed', reason: 'mount failed: spawn ENOENT' }, t, async entry => entry)
  await act(async () => restartButton()!.click())
  expect(document.body.textContent).toContain('lspRestartFailed')
})

it('withholds the restart where the repair is a different action', async () => {
  await mount({ ...base, state: 'conflict', reason: 'seam conflict' }, t, async entry => entry)
  expect(restartButton()).toBeUndefined()
  await act(async () => root.unmount())
  await mount({ ...base, state: 'host-missing', code: 'host-missing', reason: 'the package is not installed' }, t, async entry => entry)
  expect(restartButton()).toBeUndefined()
})

it('hides the restart on a read-only surface', async () => {
  await mount({ ...base, state: 'mounted' })
  expect(restartButton()).toBeUndefined()
})
