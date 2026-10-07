// @vitest-environment jsdom
/**
 * The detail modal reads a document when a reader opens its row — the same way
 * on all three document surfaces.
 *
 * The regression this guards: commands and agents used to arrive inside the
 * detail payload, sliced at 64 KiB with nothing said about the cut, so a large
 * command rendered as a document that stopped mid-sentence. Now no surface's
 * body is in the payload at all, and the read that replaces it is whole.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Translate } from '../src/client/index.js'

const api = vi.hoisted(() => ({
  fetchSuiteDetail: vi.fn(),
  fetchSuiteDocument: vi.fn(),
  fetchSuiteDocumentTranslation: vi.fn()
}))
vi.mock('../src/client/api.js', () => api)

import { SuiteDetailModal } from '../src/client/features/market/SuiteDetail.js'

const t: Translate = key => String(key)

/** The tail of a document well past the old 64 KiB payload cap. */
const BIG_TAIL = 'TAIL-ONLY-IN-THE-WHOLE-DOCUMENT'
const BIG_COMMAND = `---\ndescription: A big command\n---\n${'y'.repeat(80 * 1024)}\n${BIG_TAIL}\n`

/** One suite detail payload: three document rows, and no body anywhere. */
const DETAIL = {
  sourceId: 'active',
  suiteId: 'v1-suite',
  name: 'Fixture Suite',
  version: '1.2.3',
  description: null,
  author: null,
  keywords: [],
  updatedAt: null,
  layout: 'agent-plugin-v1',
  dimension: 'user',
  root: '/tmp/v1-suite',
  remoteUrl: null,
  installed: false,
  enabled: false,
  surfaceToggles: null,
  skills: [{ name: 'greet', description: 'Greet the user', path: '/tmp/v1-suite/skills/greet/SKILL.md' }],
  mcpServers: [],
  hooks: { count: 0, entries: [] },
  commands: [{ name: 'big', description: 'A big command' }],
  agents: [{ name: 'reviewer', description: 'Review code changes' }],
  lsp: { servers: [], raw: [] },
  errors: [],
  mcpErrors: []
}

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.clearAllMocks()
})

/** Mount the detail dialog and flush its payload read. */
async function mount(): Promise<void> {
  const element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
  api.fetchSuiteDetail.mockResolvedValue(DETAIL)
  await act(async () => {
    root?.render(h(SuiteDetailModal, { t, sourceId: 'active', suiteId: 'v1-suite', onClose: () => {}, showOriginal: false }))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

/** The row band carrying this name. */
function band(name: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(candidate => (candidate.textContent ?? '').startsWith(name))
  if (found === undefined) throw new Error(`no disclosure band for "${name}"`)
  return found
}

/** The open row's body: the document, and under it whatever the row adds. */
function rowBody(name: string): HTMLElement {
  const body = band(name).parentElement?.children[1]
  if (!(body instanceof HTMLElement)) throw new Error(`the row carrying "${name}" is not open`)
  return body
}

/** Open (or close) one row the way a reader does, and let its own read settle. */
async function click(name: string): Promise<void> {
  await act(async () => {
    band(name).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

describe('market detail documents are read on expand', () => {
  it('reads nothing on mount, then shows a command longer than the old cap whole', async () => {
    await mount()
    // Nothing is read for a document nobody opened, and no body came with the payload.
    expect(api.fetchSuiteDocument).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain(BIG_TAIL)

    api.fetchSuiteDocument.mockResolvedValue({ name: 'big', content: BIG_COMMAND })
    await click('big')
    expect(api.fetchSuiteDocument).toHaveBeenCalledTimes(1)
    expect(api.fetchSuiteDocument).toHaveBeenCalledWith('active', 'v1-suite', 'commands', 'big', undefined)
    // The payload carried no body, so this text can only be the read's — and the
    // read is the whole document, tail included, with no cut marker in sight.
    expect(rowBody('big').textContent).toContain(BIG_TAIL)
    expect(rowBody('big').textContent).not.toContain('truncated')
  })

  it('gives skills, commands, and agents the same lazy read, loading line, and error path', async () => {
    await mount()
    const pending: Array<(value: { name: string; content: string }) => void> = []
    api.fetchSuiteDocument.mockImplementation(
      () =>
        new Promise(resolve => {
          pending.push(resolve)
        })
    )

    // A skill reads by its own kind and name, and shows its loading line until
    // the read lands.
    await click('greet')
    expect(api.fetchSuiteDocument).toHaveBeenLastCalledWith('active', 'v1-suite', 'skills', 'greet', undefined)
    expect(rowBody('greet').textContent).toContain('loading')
    await act(async () => pending.shift()?.({ name: 'greet', content: '# Greet\n\nRun the script.' }))
    expect(rowBody('greet').textContent).toContain('Run the script.')

    // The other two take exactly that path, each naming its own document.
    await click('big')
    expect(api.fetchSuiteDocument).toHaveBeenLastCalledWith('active', 'v1-suite', 'commands', 'big', undefined)
    expect(rowBody('big').textContent).toContain('loading')
    await act(async () => pending.shift()?.({ name: 'big', content: BIG_COMMAND }))
    expect(rowBody('big').textContent).toContain(BIG_TAIL)

    await click('reviewer')
    expect(api.fetchSuiteDocument).toHaveBeenLastCalledWith('active', 'v1-suite', 'agents', 'reviewer', undefined)
    await act(async () => pending.shift()?.({ name: 'reviewer', content: 'Review carefully.' }))
    expect(rowBody('reviewer').textContent).toContain('Review carefully.')

    // A read that fails writes the same failure into whichever row asked for it.
    await click('reviewer')
    api.fetchSuiteDocument.mockRejectedValueOnce(new Error('document unreadable'))
    await click('reviewer')
    expect(rowBody('reviewer').textContent).toContain('document unreadable')

    // Reopening a row reads again rather than reusing whatever it showed before.
    await click('reviewer')
    await click('reviewer')
    expect(api.fetchSuiteDocument).toHaveBeenLastCalledWith('active', 'v1-suite', 'agents', 'reviewer', undefined)
    expect(api.fetchSuiteDocument).toHaveBeenCalledTimes(5)
  })
})
