/**
 * The client-banner post-processor is the one place the plugin's build writes
 * a JavaScript file whose content depends on a stylesheet. Two properties
 * matter and neither is visible in the shipped bundle: the emitted file must
 * stay parseable whatever the CSS contains, and the stylesheet must arrive in
 * the page byte for byte.
 *
 * The script is driven as a subprocess against a fixture checkout — the same
 * way `pnpm run build:client` runs it.
 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../scripts/normalize-client-banner.mjs', import.meta.url))

/**
 * A stylesheet carrying every shape that could end a string literal or a
 * script block: quotes, backslashes, a closing script tag, a line separator
 * that is legal in CSS and illegal inside a JavaScript string, and non-ASCII.
 */
const HOSTILE_CSS = `.a{content:"</script><script>alert(1)</script>"}
.b{content:"back\\slash and 'single' and \\"double\\""}
.c{background:url("data:image/svg+xml;utf8,<svg/>")}
.d::after{content:"line\u2028separator\u2029and 中文"}
.e{--empty:""}
`

/** One throwaway checkout: package.json plus the bundle tsdown would emit. */
async function fixture(bundle: string, css: string | undefined): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'client-banner-'))
  await mkdir(join(root, 'client'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'dsh-agent-plugins-market' }), 'utf8')
  await writeFile(join(root, 'client', 'client.js'), bundle, 'utf8')
  if (css !== undefined) await writeFile(join(root, 'client', 'style.css'), css, 'utf8')
  return root
}

function run(root: string): string {
  // stderr is captured rather than inherited: the refusal case asserts on the
  // child's own message, and nothing should print into the suite's output.
  execFileSync(process.execPath, [SCRIPT, root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return readFileSync(join(root, 'client', 'client.js'), 'utf8')
}

/**
 * Run the emitted injection the way the page does: as a module evaluated in a
 * scope that has `document`, `atob` and `TextDecoder`. Returns what the style
 * element received and the id it was tagged with.
 */
async function injectedStyle(root: string, emitted: string): Promise<{ id: string; text: string }> {
  const start = emitted.indexOf('(function(){')
  const end = emitted.indexOf('}})();', start)
  if (start === -1 || end === -1) throw new Error('expected the bundle to open with a style injection')
  const file = join(root, 'client', 'injection-check.mjs')
  await writeFile(file, emitted.slice(start, end + '}})();'.length), 'utf8')

  const captured: { id?: string; text?: string } = {}
  const stub = {
    createElement: () => ({
      setAttribute: (name: string, value: string) => {
        if (name === 'data-dsh-client') captured.id = value
      },
      set textContent(value: string) {
        captured.text = value
      }
    }),
    head: { appendChild: () => {} }
  }
  const scope = globalThis as unknown as Record<string, unknown>
  const previous = scope['document']
  scope['document'] = stub
  try {
    await import(pathToFileURL(file).href)
  } finally {
    scope['document'] = previous
  }
  return { id: captured.id ?? '', text: captured.text ?? '' }
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('client banner normalization', () => {
  it('replaces the stylesheet import with an injection the page can parse', async () => {
    const root = await fixture("import './style.css';\nexports.answer = 42;\n", HOSTILE_CSS)
    roots.push(root)
    const emitted = run(root)

    expect(emitted).not.toContain("import './style.css'")
    expect(emitted.startsWith('window.__ModuleLoader__.load({ id: "dsh-agent-plugins-market", factory: (require) => {')).toBe(true)
    expect(emitted).toContain('exports.answer = 42;')
    // The stylesheet is consumed, not left for a loader that cannot fetch it.
    expect(existsSync(join(root, 'client', 'style.css'))).toBe(false)
    // What is written has to parse as JavaScript, whatever the CSS held.
    execFileSync(process.execPath, ['--check', join(root, 'client', 'client.js')])
  })

  it('delivers the stylesheet exactly, including characters that would end a literal', async () => {
    const root = await fixture("import './style.css';\n", HOSTILE_CSS)
    roots.push(root)
    const delivered = await injectedStyle(root, run(root))
    expect(delivered.id).toBe('dsh-agent-plugins-market')
    expect(delivered.text).toBe(HOSTILE_CSS)
  })

  it('injects the stylesheet ahead of a bundle that never imported it', async () => {
    const root = await fixture('exports.answer = 42;\n', '.x{color:red}\n')
    roots.push(root)
    const emitted = run(root)
    expect(emitted.indexOf('(function(){')).toBeLessThan(emitted.indexOf('exports.answer'))
    expect((await injectedStyle(root, emitted)).text).toBe('.x{color:red}\n')
  })

  it('leaves a bundle without an emitted stylesheet untouched apart from the wrapper', async () => {
    const root = await fixture('exports.answer = 42;\n', undefined)
    roots.push(root)
    const emitted = run(root)
    expect(emitted).not.toContain('createElement("style")')
    expect(emitted).toContain('exports.answer = 42;')
  })

  it('refuses a package name that is not a plain module id', async () => {
    const root = await fixture('exports.answer = 42;\n', undefined)
    roots.push(root)
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bad"name' }), 'utf8')
    let refusal: { stderr?: string } | undefined
    try {
      run(root)
    } catch (error) {
      refusal = error as { stderr?: string }
    }
    expect(refusal?.stderr).toMatch(/not a plain module id/)
  })

  it('keeps the emitted bundle free of the stylesheet text itself', async () => {
    // The payload is base64, so a scan of the file cannot find CSS syntax that
    // would confuse a naive consumer — and the shape proves the encoding held.
    const root = await fixture("import './style.css';\n", '.probe{color:red}\n')
    roots.push(root)
    const emitted = run(root)
    expect(emitted).not.toContain('.probe{color:red}')
    expect(emitted).toContain(Buffer.from('.probe{color:red}\n', 'utf8').toString('base64'))
  })
})
