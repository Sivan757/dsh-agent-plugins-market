// @vitest-environment jsdom
/** The expanded document defaults to bilingual reading and retains three explicit modes. */
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

/** Locale probes: the control's own rule reads the active language from this key. */
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

/** The open row's body: the authored document, and the control that swaps it. */
function rowBody(text: string): HTMLElement {
  const body = button(text).parentElement?.children[1]
  if (!(body instanceof HTMLElement)) throw new Error(`the row carrying "${text}" is not open`)
  return body
}

describe('market detail document translation', () => {
  it('keeps the expanded document open across global off/on and a target change', async () => {
    translationEnabled(true)
    api.fetchSuiteDocumentTranslation.mockResolvedValue({ text: '译文', bilingualText: '原文\n\n译文', pending: 0 })
    await mount(chinese)
    await open('deploy')
    await act(async () => {
      unbind?.()
      translationEnabled(false)
    })
    expect(rowBody('deploy').textContent).toContain('Deploy the v1 fixture suite.')
    await act(async () => {
      unbind?.()
      translationEnabled(true)
    })
    expect(rowBody('deploy').textContent).toContain('译文')
    await act(async () => root!.render(h(SuiteDetailModal, { t: english, sourceId: 'active', suiteId: 'v1-suite', onClose: () => {}, showOriginal: false })))
    expect(rowBody('deploy').querySelector('[role="tablist"]')).not.toBeNull()
    expect(api.fetchSuiteDocument).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['greet', 'skills'],
    ['deploy', 'commands'],
    ['reviewer', 'agents']
  ])('loads only the expanded %s document and translation', async (name, kind) => {
    translationEnabled(true)
    api.fetchSuiteDocumentTranslation.mockResolvedValue({ text: 'Translated document', bilingualText: 'Authored document\n\nTranslated document', pending: 0 })
    await mount(chinese)
    expect(api.fetchSuiteDocument).not.toHaveBeenCalled()
    expect(api.fetchSuiteDocumentTranslation).not.toHaveBeenCalled()
    await open(name)
    expect(api.fetchSuiteDocument).toHaveBeenCalledWith('active', 'v1-suite', kind, name, undefined)
    expect(api.fetchSuiteDocumentTranslation).toHaveBeenCalledWith('active', 'v1-suite', kind, name, undefined)
    const body = rowBody(name)
    expect(body.querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(body.textContent).toContain('Authored document')
    expect(body.textContent).toContain('Translated document')
    const tab = [...body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(item => item.textContent === 'translationViewOriginal')!
    await act(async () => tab.click())
    expect(body.textContent).not.toContain('Translated document')
    expect(api.fetchSuiteDocumentTranslation).toHaveBeenCalledTimes(1)
  })
  it('does not translate when globally disabled', async () => {
    translationEnabled(false)
    await mount(chinese)
    await open('deploy')
    expect(rowBody('deploy').textContent).toContain('Deploy the v1 fixture suite.')
    expect(rowBody('deploy').querySelector('[role="tablist"]')).toBeNull()
    expect(api.fetchSuiteDocumentTranslation).not.toHaveBeenCalled()
  })
  it('supports an explicitly enabled English interface', async () => {
    translationEnabled(true)
    api.fetchSuiteDocumentTranslation.mockResolvedValue({ text: 'Translated document', bilingualText: 'Translated document', pending: 0 })
    await mount(english)
    await open('deploy')
    expect(rowBody('deploy').querySelector('[role="tablist"]')).not.toBeNull()
    expect(api.fetchSuiteDocumentTranslation).toHaveBeenCalledTimes(1)
  })
})
