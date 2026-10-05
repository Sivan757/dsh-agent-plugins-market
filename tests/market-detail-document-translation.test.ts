// @vitest-environment jsdom
/**
 * The market detail page's three document surfaces carry the same collapsible
 * translation section the user-panel detail page has: it reads nothing until a
 * reader opens it, it reads the document the row names, and it renders nothing
 * at all where no translation would be shown.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { bindTranslationEnabled } from '../src/client/ui/translation-enabled.js'
import type { Translate } from '../src/client/index.js'

const api = vi.hoisted(() => ({
  fetchSuiteDetail: vi.fn(),
  fetchSuiteDocument: vi.fn(),
  fetchSuiteDocumentTranslation: vi.fn()
}))
vi.mock('../src/client/api.js', () => api)

import { SuiteDetailModal } from '../src/client/features/market/SuiteDetail.js'

/** Locale probes: the section's own rule reads the active language from this key. */
const chinese: Translate = key => (key === 'localeProbeLang' ? '中文' : String(key))
const english: Translate = key => (key === 'localeProbeLang' ? 'English' : String(key))

/**
 * The authored text each surface's document resolves to, keyed `kind/name`.
 * The payload below names the documents; these are what the lazy read returns.
 */
const DOCUMENTS: Record<string, string> = {
  'skills/greet': '---\nname: greet\n---\n# Greet\n\nRun the script.',
  'commands/deploy': '---\ndescription: Deploy the fixture\n---\nDeploy the v1 fixture suite.',
  'agents/reviewer': '---\ndescription: Review code changes\n---\nReview carefully.'
}

/** One suite detail payload with a document on each of the three surfaces; no bodies. */
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
  commands: [{ name: 'deploy', description: 'Deploy the fixture' }],
  agents: [{ name: 'reviewer', description: 'Review code changes' }],
  lsp: { servers: [], raw: [] },
  errors: [],
  mcpErrors: []
}

let root: Root | undefined
let unbind: (() => void) | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  unbind?.()
  unbind = undefined
  vi.clearAllMocks()
})

/** Bind the shared translation preference the section subscribes to. */
function translationEnabled(value: boolean): void {
  unbind = bindTranslationEnabled({ getSnapshot: () => ({ value: { translationEnabled: value } }), subscribe: () => () => {} })
}

/** Mount the detail dialog and flush its detail read. */
async function mount(t: Translate): Promise<void> {
  const element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
  api.fetchSuiteDetail.mockResolvedValue(DETAIL)
  api.fetchSuiteDocument.mockImplementation(async (_sourceId: string, _suiteId: string, kind: string, name: string) => ({
    name,
    content: DOCUMENTS[`${kind}/${name}`] ?? ''
  }))
  await act(async () => {
    root?.render(h(SuiteDetailModal, { t, sourceId: 'active', suiteId: 'v1-suite', onClose: () => {}, showOriginal: false }))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

/** The disclosure button whose band carries this text. */
function button(text: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(candidate => (candidate.textContent ?? '').includes(text))
  if (found === undefined) throw new Error(`no disclosure button carrying "${text}"`)
  return found
}

/** Open one row the way a reader does, and let its own read land. */
async function open(text: string): Promise<void> {
  await act(async () => {
    button(text).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

/** The open row's body: the document, and under it whatever the row adds. */
function rowBody(text: string): HTMLElement {
  const body = button(text).parentElement?.children[1]
  if (!(body instanceof HTMLElement)) throw new Error(`the row carrying "${text}" is not open`)
  return body
}

describe('market detail document translation', () => {
  it('reads nothing on mount, and only the opened document once its section is opened', async () => {
    translationEnabled(true)
    await mount(chinese)
    // Nothing is read for a document nobody opened.
    expect(api.fetchSuiteDocument).not.toHaveBeenCalled()
    expect(api.fetchSuiteDocumentTranslation).not.toHaveBeenCalled()

    // Opening a command row is what reads its document — and the section is
    // still closed, so nothing behind it was fetched either.
    await open('deploy')
    expect(api.fetchSuiteDocument).toHaveBeenCalledWith('active', 'v1-suite', 'commands', 'deploy')
    expect(document.body.textContent).toContain('Deploy the v1 fixture suite.')
    expect(document.body.textContent).toContain('translationDocToggle')
    expect(api.fetchSuiteDocumentTranslation).not.toHaveBeenCalled()

    // The section is where the read happens, and it names the document only.
    api.fetchSuiteDocumentTranslation.mockResolvedValue({ text: '# 译文\n\n命令正文。', pending: 0 })
    await open('translationDocToggle')
    expect(api.fetchSuiteDocumentTranslation).toHaveBeenCalledTimes(1)
    expect(api.fetchSuiteDocumentTranslation).toHaveBeenCalledWith('active', 'v1-suite', 'commands', 'deploy')
    expect(document.body.textContent).toContain('命令正文。')
  })

  it('gives skills, commands, and agents the same section, each naming its own document', async () => {
    translationEnabled(true)
    api.fetchSuiteDocumentTranslation.mockResolvedValue({ text: '# 问候', pending: 0 })
    await mount(chinese)

    // A skill's document arrives through the same read the other two take, so
    // the section appears once that read lands — and the translation is still
    // unread.
    await open('greet')
    expect(api.fetchSuiteDocument).toHaveBeenCalledWith('active', 'v1-suite', 'skills', 'greet')
    expect(api.fetchSuiteDocumentTranslation).not.toHaveBeenCalled()
    await open('translationDocToggle')
    expect(api.fetchSuiteDocumentTranslation).toHaveBeenLastCalledWith('active', 'v1-suite', 'skills', 'greet')

    // Commands and agents take the same path, and their translation re-reads
    // the file rather than trusting anything the page already holds.
    await open('deploy')
    expect(api.fetchSuiteDocument).toHaveBeenCalledWith('active', 'v1-suite', 'commands', 'deploy')
    await open('translationDocToggle')
    expect(api.fetchSuiteDocumentTranslation).toHaveBeenLastCalledWith('active', 'v1-suite', 'commands', 'deploy')

    await open('reviewer')
    expect(api.fetchSuiteDocument).toHaveBeenCalledWith('active', 'v1-suite', 'agents', 'reviewer')
    await open('translationDocToggle')
    expect(api.fetchSuiteDocumentTranslation).toHaveBeenLastCalledWith('active', 'v1-suite', 'agents', 'reviewer')
    expect(api.fetchSuiteDocumentTranslation).toHaveBeenCalledTimes(3)
  })

  it('renders no section and reads nothing while translation is off', async () => {
    translationEnabled(false)
    await mount(chinese)
    await open('deploy')
    // The document itself is untouched; only the section is absent.
    expect(document.body.textContent).toContain('Deploy the v1 fixture suite.')
    expect(document.body.textContent).not.toContain('translationDocToggle')
    expect(api.fetchSuiteDocumentTranslation).not.toHaveBeenCalled()
  })

  it('renders no section under the language the documents are already authored in', async () => {
    translationEnabled(true)
    await mount(english)
    await open('deploy')
    expect(document.body.textContent).toContain('Deploy the v1 fixture suite.')
    expect(document.body.textContent).not.toContain('translationDocToggle')
    expect(api.fetchSuiteDocumentTranslation).not.toHaveBeenCalled()
  })

  it('leaves the authored document exactly as it renders without the section', async () => {
    // The same row body with the section switched off and on: the document is
    // the same node either way, and the section only appends behind it.
    translationEnabled(false)
    await mount(chinese)
    await open('deploy')
    const off = rowBody('deploy')
    expect(off.children).toHaveLength(1)
    const documentHtml = off.children[0]?.outerHTML
    await act(async () => root?.unmount())
    root = undefined

    translationEnabled(true)
    await mount(chinese)
    await open('deploy')
    const on = rowBody('deploy')
    expect(on.children).toHaveLength(2)
    expect(on.children[0]?.outerHTML).toBe(documentHtml)
  })
})
