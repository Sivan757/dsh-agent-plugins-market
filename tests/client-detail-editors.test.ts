// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerConfigEditor } from '../src/client/ui/ServerConfigEditor.js'
import { parsePastedServer, parsePastedServers, rowsFromPastedText } from '../src/client/ui/server-form.js'
import { MarkdownDocument } from '../src/client/ui/MarkdownDocument.js'
import { typeInto } from './helpers/dom-events.js'
import { stubTranslate as t } from './helpers/translate.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
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
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!
  expect(input).not.toBeNull()
  await act(async () => typeInto(input, value))
}
const value = () => JSON.parse(host.querySelector('[data-value]')!.textContent) as Record<string, unknown>

describe('shared resource detail editors', () => {
  it('offers the advanced disclosure without policy timeouts when no policy props are supplied', async () => {
    await mount({ type: 'stdio', command: 'node' })
    const disclosure = [...host.querySelectorAll('button')].find(node => node.textContent?.includes('mcpAdvanced'))
    expect(disclosure).toBeDefined()
    expect(host.querySelector('[aria-label="detailCwd"]')).toBeNull()
    await act(async () => disclosure!.click())
    expect(host.querySelector('[aria-label="detailCwd"]')).not.toBeNull()
    // The connection input is there; the dialog-owned timeouts are not.
    expect(host.querySelector('[aria-label="mcpToolCallTimeout"]')).toBeNull()
  })
  it('renders Markdown as markup with the frontmatter as authored, without HTML injection', () => {
    const markup = renderToStaticMarkup(
      h(MarkdownDocument, { t, text: '---\nname: reviewer\ntools: [Read, Grep]\nmetadata:\n  priority: 2\n---\n# Review\n\n**Carefully**\n\n<script>alert(1)</script>' })
    )
    expect(markup).toContain('<pre')
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

describe('pasted server definitions', () => {
  it('reads the first mcpServers entry and normalizes its transport', () => {
    const pasted = parsePastedServer(JSON.stringify({ mcpServers: { docs: { type: 'http', url: 'https://example.test/mcp' } } }))
    expect(pasted.name).toBe('docs')
    expect(pasted.config).toEqual({ type: 'streamable-http', url: 'https://example.test/mcp' })
  })

  it('infers the transport from a bare definition and maps httpUrl onto url', () => {
    expect(parsePastedServer(JSON.stringify({ command: 'npx', args: ['-y', 'pkg'] })).config).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'pkg'] })
    expect(parsePastedServer(JSON.stringify({ type: 'local', command: 'uvx' })).config).toEqual({ type: 'stdio', command: 'uvx' })
    expect(parsePastedServer(JSON.stringify({ httpUrl: 'https://example.test/mcp' })).config).toEqual({ type: 'streamable-http', url: 'https://example.test/mcp' })
  })

  it('reads every entry of a pasted map, keeping each name', () => {
    const pasted = parsePastedServers(JSON.stringify({ mcpServers: { alpha: { command: 'npx' }, beta: { type: 'http', url: 'https://example.test/mcp' } } }))
    expect(pasted).toEqual([
      { name: 'alpha', config: { type: 'stdio', command: 'npx' } },
      { name: 'beta', config: { type: 'streamable-http', url: 'https://example.test/mcp' } }
    ])
  })

  it('reads a pasted block into key/value rows, quotes and all', () => {
    expect(rowsFromPastedText('A=1\nB = 2', true)).toEqual([
      ['A', '1'],
      ['B', '2']
    ])
    expect(rowsFromPastedText('"Authorization": "Bearer x"\nX-Api-Key: abc', true)).toEqual([
      ['Authorization', 'Bearer x'],
      ['X-Api-Key', 'abc']
    ])
    expect(rowsFromPastedText('--flag\nvalue with spaces', false)).toEqual([
      ['', '--flag'],
      ['', 'value with spaces']
    ])
    expect(rowsFromPastedText('no separator here', true)).toEqual([])
  })

  it('appends every line of a pasted block to the row editor', async () => {
    await mount({ type: 'streamable-http', url: 'https://example.test/mcp' })
    await click('panelAdd detailHeaders')
    const target = host.querySelector<HTMLInputElement>('[aria-label="detailHeaders detailValue 1"]')
    expect(target).not.toBeNull()
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => '"Authorization": "Bearer x"\nX-Api-Key: abc' } })
    await act(async () => target!.dispatchEvent(event))
    expect(value().headers).toEqual({ Authorization: 'Bearer x', 'X-Api-Key': 'abc' })
  })

  it('rejects a pasted document that carries no server', () => {
    expect(() => parsePastedServer('[]')).toThrow('Configuration must be a JSON object')
    expect(() => parsePastedServer(JSON.stringify({ mcpServers: {} }))).toThrow('mcpServers is empty')
  })
})
