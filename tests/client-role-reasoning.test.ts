// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoleMetadataFields } from '../src/client/features/personas/RoleMetadataFields.js'
import { readRoleFields } from '../src/client/features/personas/frontmatter.js'
import { parseAgentRole } from '../src/runtime/agent-role-router.js'
import type { Translate } from '../src/client/index.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const t: Translate = key => key
let root: Root | undefined
let host: HTMLDivElement
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  vi.unstubAllGlobals()
})

function Editor({ initial, disabled = false }: { initial: string; disabled?: boolean }) {
  const [text, setText] = useState(initial)
  return h('div', null, h(RoleMetadataFields, { text, onChange: setText, t, disabled }), h('output', null, text))
}

async function mount(text: string, exact: (model: string, signal: AbortSignal) => Promise<object>, disabled = false) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: { signal: AbortSignal }) => {
      const query = new URL(url, 'http://localhost').searchParams
      const data = query.has('model')
        ? await exact(query.get('model')!, options.signal)
        : {
            providers: [{ id: 'p', name: 'Provider' }],
            models: query.has('provider')
              ? [
                  { id: 'a', name: 'A' },
                  { id: 'b', name: 'B' }
                ]
              : []
          }
      return { ok: true, json: async () => data }
    })
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(Editor, { initial: text, disabled })))
}

function select(label: string): HTMLSelectElement {
  return host.querySelector(`select[aria-label="${label}"]`)!
}
function value() {
  return host.querySelector('output')!.textContent!
}
async function change(label: string, value: string) {
  await act(async () => Simulate.change(select(label), { target: { value } } as never))
}
const metadata = {
  reasoning: {
    efforts: [
      { id: 'low', name: 'Low' },
      { id: 'high', name: 'High' }
    ],
    defaultEffort: 'low'
  }
}

describe('role reasoning effort selector', () => {
  it('loads exact-model options, preserves saved aliases and saves the value consumed by subagent_run', async () => {
    await mount('---\nprovider: p\nmodel: a\nreasoningEffort: high\nmetadata: {tier: 2}\n---\nRole body', async () => metadata)
    expect([...select('personaReasoningEffort').options].map(option => option.value)).toEqual(['', 'low', 'high'])
    expect(select('personaReasoningEffort').value).toBe('high')
    await change('personaReasoningEffort', 'low')
    expect(value()).toContain('reasoning_effort: low')
    expect(value()).not.toContain('reasoningEffort:')
    expect(value()).toContain('metadata: { tier: 2 }')
    expect(parseAgentRole(value())).toMatchObject({ provider: 'p', model: 'a', reasoningEffort: 'low', content: 'Role body' })
    await change('personaReasoningEffort', '')
    expect(parseAgentRole(value()).reasoningEffort).toBeUndefined()
  })

  it('clears effort on model/provider changes and ignores late responses from the previous route', async () => {
    let release!: (value: object) => void
    let oldSignal: AbortSignal | undefined
    await mount('---\nprovider: p\nmodel: a\nreasoning_effort: high\n---\nRole', (model, signal) =>
      model === 'a'
        ? new Promise(resolve => {
            release = resolve
            oldSignal = signal
          })
        : Promise.resolve({ reasoning: { efforts: [{ id: 'medium', name: 'Medium' }] } })
    )
    expect(select('personaReasoningEffort').disabled).toBe(true)
    await change('personaModel', 'b')
    expect(readRoleFields(value()).reasoningEffort).toBe('')
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => release(metadata))
    expect([...select('personaReasoningEffort').options].map(option => option.value)).toEqual(['', 'medium'])
    await change('personaReasoningEffort', 'medium')
    await change('personaProvider', '')
    expect(readRoleFields(value())).toMatchObject({ provider: '', model: 'inherit', reasoningEffort: '' })
    expect([...select('personaReasoningEffort').options].map(option => option.value)).toEqual([''])
  })

  it('retains unavailable values, permits clearing them and offers retry after an error', async () => {
    let failed = true
    await mount('---\nprovider: p\nmodel: a\nreasoning_effort: legacy\n---\nRole', async () => {
      if (failed) throw new Error('offline')
      return metadata
    })
    expect(select('personaReasoningEffort').value).toBe('legacy')
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    failed = false
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    expect(select('personaReasoningEffort').selectedOptions[0]!.textContent).toContain('personaUnavailable')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    await change('personaReasoningEffort', '')
    expect(readRoleFields(value()).reasoningEffort).toBe('')
  })

  it('does not invent levels for a model without reasoning metadata and honors read-only state', async () => {
    await mount('---\nprovider: p\nmodel: a\n---\nRole', async () => ({}), true)
    expect([...select('personaReasoningEffort').options].map(option => option.value)).toEqual([''])
    expect(select('personaReasoningEffort').closest('fieldset')!.disabled).toBe(true)
  })

  it('warns about a stored route the executor would ignore and offers no tools control', async () => {
    const warn = () => host.querySelector('[role="status"]')?.textContent ?? ''
    // Exact pair: nothing to warn about, and the dead tools field is gone.
    await mount('---\nprovider: p\nmodel: a\ntools: [Read, Grep]\n---\nRole', async () => metadata)
    expect(warn()).toBe('')
    expect(host.querySelector('input')).toBeNull()
    // A bare model, a qualified string and a lone provider are all ignored at execution.
    await mount('---\nmodel: sonnet\n---\nRole', async () => metadata)
    expect(warn()).toBe('personaRouteIgnored')
    await mount('---\nmodel: p/a\n---\nRole', async () => metadata)
    expect(warn()).toBe('personaRouteIgnored')
    await mount('---\nprovider: p\n---\nRole', async () => metadata)
    expect(warn()).toBe('personaRouteIgnored')
    // Inheritance is a valid declaration, not an ignored one.
    await mount('---\nmodel: inherit\n---\nRole', async () => metadata)
    expect(warn()).toBe('')
  })
})
