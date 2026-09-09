// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerConfigEditor } from '../src/client/ui/ServerConfigEditor.js'
import { MarkdownDocument } from '../src/client/ui/MarkdownDocument.js'
import type { Translate } from '../src/client/index.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const t: Translate = key => key
let root: Root | undefined
let host: HTMLDivElement
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
})

function Harness({ initial }: { initial: string }) {
  const [text, setText] = useState(initial)
  const [valid, setValid] = useState(false)
  return h(
    'div',
    null,
    h(ServerConfigEditor, { kind: 'mcp', text, onChange: setText, t, onValidityChange: setValid }),
    h('output', { 'data-value': true }, text),
    h('output', { 'data-valid': true }, String(valid))
  )
}

async function mount(initial: Record<string, unknown>) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(Harness, { initial: JSON.stringify(initial) })))
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)
  expect(button).toBeDefined()
  await act(async () => button!.click())
}
async function change(label: string, value: string) {
  const input = host.querySelector(`[aria-label="${label}"]`)!
  expect(input).not.toBeNull()
  await act(async () => Simulate.change(input, { target: { value } } as never))
}
const value = () => JSON.parse(host.querySelector('[data-value]')!.textContent!) as Record<string, unknown>

describe('shared resource detail editors', () => {
  it('renders Markdown as markup and metadata as a definition list without rendering HTML injection', () => {
    const markup = renderToStaticMarkup(
      h(MarkdownDocument, { t, text: '---\nname: reviewer\ntools: [Read, Grep]\nmetadata:\n  priority: 2\n---\n# Review\n\n**Carefully**\n\n<script>alert(1)</script>' })
    )
    expect(markup).toContain('<dl')
    expect(markup).toContain('priority')
    expect(markup).toContain('Read')
    expect(markup).toContain('<strong>Carefully</strong>')
    expect(markup).not.toContain('<script>')
    expect(renderToStaticMarkup(h(MarkdownDocument, { t, text: '---\na: [\n---\nbody' }))).toContain('role="alert"')
  })

  it('preserves fields in form/JSON roundtrips and retains invalid JSON for correction', async () => {
    await mount({ type: 'stdio', command: 'node', args: ['arg with spaces'], env: { TOKEN: '${TOKEN}' }, custom: { nested: [true, 2] } })
    expect(host.querySelector('[data-valid]')!.textContent).toBe('true')
    await change('detailCommand', 'python')
    await click('detailJson')
    expect(value()).toMatchObject({ command: 'python', args: ['arg with spaces'], custom: { nested: [true, 2] } })
    await change('detailJson', '{invalid')
    expect(host.querySelector('[data-valid]')!.textContent).toBe('false')
    await click('detailForm')
    expect(host.textContent).toContain('detailUseJson')
    await click('detailJson')
    await change('detailJson', JSON.stringify({ type: 'sse', url: 'https://example.test/mcp', headers: { Authorization: '[redacted]' } }))
    await click('detailForm')
    expect((host.querySelector('[aria-label="detailUrl"]') as HTMLInputElement).value).toBe('https://example.test/mcp')
    expect(value().headers).toEqual({ Authorization: '[redacted]' })
  })

  it('requires unique keys, blocks saving incomplete rows and retains exact argument values', async () => {
    await mount({ type: 'stdio', command: 'node', env: { A: 'a' }, args: [] })
    await click('panelAdd detailEnv')
    expect(host.querySelector('[data-valid]')!.textContent).toBe('false')
    await change('detailEnv detailKey 2', 'A')
    expect(host.textContent).toContain('detailUniqueKeys')
    await change('detailEnv detailKey 2', 'B')
    await change('detailEnv detailValue 2', 'value: with spaces')
    expect(value().env).toEqual({ A: 'a', B: 'value: with spaces' })
    await click('panelAdd detailArgs')
    await change('detailArgs detailValue 1', '--flag=space value')
    expect(value().args).toEqual(['--flag=space value'])
    expect(host.querySelector('[data-valid]')!.textContent).toBe('true')
  })
})
