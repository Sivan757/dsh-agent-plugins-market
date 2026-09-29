// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerConfigEditor } from '../src/client/ui/ServerConfigEditor.js'
import { composeServerDocument, rowsFromPastedText } from '../src/client/ui/server-form.js'
import type { CredentialApi } from '../src/client/credentials.js'
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

/** A credentials wire that reports every reference configured and writable. */
const credentialStub: CredentialApi = {
  describe: async ({ refs }) => ({
    result: { ok: true, value: { credentials: Object.fromEntries(refs.map(ref => [ref, { configured: true, source: 'file', writable: true }])) } }
  }),
  set: async () => ({ result: { ok: true } }),
  unset: async () => ({ result: { ok: true } })
}

function Harness({ initial, serverKey = 'service', credentials }: { initial: string; serverKey?: string; credentials?: CredentialApi }) {
  // The editor edits the document the specification seats a service in: the
  // definition under `mcpServers` plus this client's policy namespace. These
  // cases supply the definition and read the definition back. No key is a
  // service being created: its document is the definition itself.
  const [text, setText] = useState(serverKey === '' ? initial : composeServerDocument(serverKey, JSON.parse(initial) as Record<string, unknown>, {}))
  const [valid, setValid] = useState(false)
  return h(
    'div',
    null,
    h(ServerConfigEditor, {
      kind: 'mcp',
      ...(serverKey === '' ? {} : { serverKey }),
      text,
      onChange: setText,
      t,
      onValidityChange: setValid,
      ...(credentials === undefined ? {} : { credentials })
    }),
    h('output', { 'data-value': true }, text),
    h('output', { 'data-valid': true }, String(valid))
  )
}

async function mount(initial: Record<string, unknown>, serverKey = 'service', credentials?: CredentialApi) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(Harness, { initial: JSON.stringify(initial), serverKey, ...(credentials === undefined ? {} : { credentials }) })))
  // A credential block reads its facts on mount; let that read settle.
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
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
const rawValue = () => JSON.parse(host.querySelector('[data-value]')!.textContent) as Record<string, unknown>
const value = () => ((rawValue() as { mcpServers: Record<string, Record<string, unknown>> }).mcpServers ?? {})['service'] ?? {}
/** The advanced disclosure's own row, by its accessible name. */
const advanced = () => [...host.querySelectorAll('button')].find(node => node.textContent?.includes('mcpAdvanced'))
/** The credential group's name band, which folds its rows away. */
const secretBand = () => [...host.querySelectorAll('button')].find(node => node.textContent?.includes('mcpCredentialTitle'))

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
  it('edits a service being created as the definition itself, never under an empty key', async () => {
    // A service that does not exist yet has no declaration key, so its document
    // is the definition: folding it into `mcpServers` under an empty key would
    // hand the create route a wrapper and store a nested document as the service.
    await mount({ type: 'stdio', command: '' }, '')
    await change('detailCommand', 'python')
    expect(rawValue()).toEqual({ type: 'stdio', command: 'python' })
  })

  it('keeps the advanced disclosure in the form view only', async () => {
    // The disclosure is a view over the document's own optional seats, and the
    // JSON view already shows every one of them.
    await mount({ type: 'stdio', command: 'node' })
    expect(advanced()).toBeDefined()
    await click('detailJson')
    expect(advanced()).toBeUndefined()
    await click('detailForm')
    expect(advanced()).toBeDefined()
  })

  it('reads a credential reference as the credential it names', async () => {
    await mount({ type: 'streamable-http', url: 'https://example.test/mcp', headers: { Authorization: '${SERVICE_TOKEN:-}' } })
    // The value cell shows the credential; the document's `${…}` syntax is a
    // detail the JSON view carries.
    const chip = host.querySelector<HTMLButtonElement>('button[aria-label*="SERVICE_TOKEN"]')!
    expect(chip).not.toBeNull()
    expect(chip.title).toBe('${SERVICE_TOKEN:-}')
    expect(host.querySelector('[aria-label="detailHeaders detailValue 1"]')).toBeNull()
    // Activating the chip hands that row back to the text field, raw text and all.
    await act(async () => chip.click())
    expect((host.querySelector('[aria-label="detailHeaders detailValue 1"]') as HTMLInputElement).value).toBe('${SERVICE_TOKEN:-}')
  })

  it('reads a redacted value as a secret instead of an editable string', async () => {
    await mount({ type: 'streamable-http', url: 'https://example.test/mcp', headers: { Authorization: '[redacted]' } })
    // The document holds the literal; the form may not present it as text, so
    // the cell states the secret and the block owns its replacement.
    expect(host.querySelector('[aria-label="detailHeaders detailValue 1"]')).toBeNull()
    expect([...host.querySelectorAll('span')].some(node => node.textContent === 'mcpCredentialHidden')).toBe(true)
  })

  it('lists a literal secret and replaces it in the document', async () => {
    await mount({ type: 'stdio', command: 'node', env: { API_TOKEN: '[redacted]', PLAIN: 'x' } }, 'service', credentialStub)
    // The group states what it holds and stays folded until asked for.
    const band = secretBand()
    expect(band).toBeDefined()
    expect(host.textContent).toContain('mcpCredentialConfiguredCount')
    await act(async () => band!.click())
    // Opening the group brings the seat's line and its control together: one
    // fold per secret, not two.
    expect(host.textContent).toContain('detailEnv API_TOKEN')
    const field = host.querySelector<HTMLInputElement>('#mcp-credential-detailEnv-API_TOKEN')!
    expect(field).not.toBeNull()
    await act(async () => typeInto(field, 's3cret'))
    const replace = [...host.querySelectorAll('button')].find(node => node.textContent === 'mcpCredentialReplace')!
    await act(async () => replace.click())
    expect((value()['env'] as Record<string, string> | undefined)?.['API_TOKEN']).toBe('s3cret')
  })

  it('configures the references the document spends, in the form view only', async () => {
    await mount({ type: 'streamable-http', url: 'https://example.test/mcp', headers: { Authorization: '${SERVICE_TOKEN}' } }, 'service', credentialStub)
    expect(host.textContent).toContain('mcpCredentialTitle')
    // The folded group still states what it holds.
    expect(host.textContent).toContain('mcpCredentialConfiguredCount')
    // The JSON view shows the whole document, so the block stands aside there.
    await click('detailJson')
    expect(host.textContent).not.toContain('mcpCredentialTitle')
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
    await change('detailJson', composeServerDocument('service', { type: 'sse', url: 'https://example.test/mcp', headers: { Authorization: '[redacted]' } }, {}))
    await click('detailForm')
    expect((host.querySelector('[aria-label="detailUrl"]') as HTMLInputElement).value).toBe('https://example.test/mcp')
    expect(value().headers).toEqual({ Authorization: '[redacted]' })
  })

  it('keeps a key the form has no control for across a form edit', async () => {
    await mount({ type: 'stdio', command: 'node', alwaysAllow: ['x'] })
    await change('detailCommand', 'python')
    expect(value()).toMatchObject({ command: 'python', alwaysAllow: ['x'] })
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
})
