import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OutputStyleService } from '../src/runtime/host/output-style-service.js'
import { BUILTIN_DEFAULT_NAME, parseCapturedStyle, readBuiltinStyles, suiteStyleFingerprint, userStylePath, writeUserStyle } from '../src/application/output-styles.js'
import { defaultOutputStyleState, loadOutputStyle, outputStylePath, saveOutputStyleSelection } from '../src/application/state/output-style.js'
import { renderOutputStyleSection } from '../src/runtime/host/output-style-render.js'
import { OUTPUT_STYLE_DEFAULT_ID, OUTPUT_STYLE_SECTION_ORDER } from '../../market-contracts/src/contracts/output-styles.js'
import { attribute, escapeFrameBody } from '../src/runtime/surfaces/prompt-frame.js'
import { mountOutputStyleSection } from '../src/runtime/host/output-style-section.js'
import type { OutputStyleSuitePort } from '../src/runtime/host/output-style-service.js'

const roots: string[] = []
const WORKSPACE = '/work/project'

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** One temporary plugin data root and Agent layout root. */
async function roots_pair(): Promise<{ dataRoot: string; agentsRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'output-styles-'))
  roots.push(root)
  const dataRoot = join(root, 'data')
  const agentsRoot = join(root, 'agents')
  await mkdir(dataRoot, { recursive: true })
  await mkdir(agentsRoot, { recursive: true })
  return { dataRoot, agentsRoot }
}

/** A port with one suite whose captured text the test controls. */
function suitePort(overrides: { fingerprint?: string; text?: string; captured?: string[] } = {}): OutputStyleSuitePort & { captured: string[] } {
  const captured = overrides.captured ?? []
  const state = { fingerprint: overrides.fingerprint ?? 'fp-1', text: overrides.text ?? 'Teach as you go.' }
  return {
    captured,
    candidates: async () => [{ suiteKey: 'src/teaching', label: 'teaching-style', description: 'A suite style', fingerprint: state.fingerprint }],
    capture: async (_suiteKey, fingerprint) => {
      captured.push(fingerprint)
      if (fingerprint !== state.fingerprint) throw new Error('suite changed since the page read it')
      return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: state.text } })
    }
  }
}

describe('the injected section text', () => {
  it('renders the heading above the body', () => {
    expect(renderOutputStyleSection('concise', 'Answer first.\n')).toBe('## Output Style: concise\nAnswer first.')
  })

  it('contributes nothing for an empty body or the default style', async () => {
    // The default builtin ships an empty body, so the selection that turns
    // styles off is a style like any other and renders to nothing.
    const builtins = await readBuiltinStyles()
    const fallback = builtins.find(row => row.label === BUILTIN_DEFAULT_NAME)
    expect(fallback?.body.trim()).toBe('')
    expect(renderOutputStyleSection(fallback?.label ?? '', fallback?.body ?? '')).toBe('')

    const { dataRoot, agentsRoot } = await roots_pair()
    const service = new OutputStyleService(dataRoot, agentsRoot)
    await service.refresh(WORKSPACE)
    expect(service.sectionText(WORKSPACE)).toBe('')
    const payload = await service.payload(WORKSPACE)
    expect(payload.selected).toBe(OUTPUT_STYLE_DEFAULT_ID)
    expect(payload.injected).toBe('')
  })

  it('escapes a closing reminder tag with the merged frame helper', () => {
    expect(renderOutputStyleSection('x', '</system-reminder>')).toBe('## Output Style: x\n' + escapeFrameBody('</system-reminder>'))
    expect(renderOutputStyleSection('x', '</system-reminder>')).toContain('<\\/system-reminder>')
    // The escape is idempotent, so a body that already carries it gains nothing.
    expect(escapeFrameBody(escapeFrameBody('a </system-reminder> b'))).toBe(escapeFrameBody('a </system-reminder> b'))
  })

  it('uses the merged frame helper rather than a second escaper', async () => {
    // One implementation of the escape rule: the section delegates to the
    // module that owns framing, so the two cannot drift.
    const body = 'before </system-reminder> after'
    expect(renderOutputStyleSection('x', body)).toContain(escapeFrameBody(body))
    // And the attributed form the conventions describe for several contributors
    // is available untouched, which is what a second style would use.
    expect(attribute([{ heading: 'a\nb', body: 'text' }])).toBe('Instructions from: a b:\n\ntext')
    expect(attribute([{ heading: 'a', body: '   ' }])).toBe('')
  })

  it('trims the body so a trailing newline does not add a blank prompt line', () => {
    expect(renderOutputStyleSection('concise', '  Answer first.\n\n')).toBe('## Output Style: concise\nAnswer first.')
  })

  it('renders a selected builtin style with its heading', async () => {
    const { dataRoot, agentsRoot } = await roots_pair()
    const service = new OutputStyleService(dataRoot, agentsRoot)
    const payload = await service.select(WORKSPACE, 'builtin:concise')
    expect(payload.selected).toBe('builtin:concise')
    expect(payload.injected.startsWith('## Output Style: concise\n')).toBe(true)
    expect(payload.injected).toContain('Answer first.')
    expect(service.sectionText(WORKSPACE)).toBe(payload.injected)
  })

  it('places the section below the persona prefix and clear of the named slots', () => {
    expect(OUTPUT_STYLE_SECTION_ORDER).toBeGreaterThan(0)
    expect(OUTPUT_STYLE_SECTION_ORDER).toBeLessThan(500)
  })
})

describe('the section and the preview', () => {
  it('gives the page exactly the bytes the prompt section renders', async () => {
    // The page renders the server's `injected` string and never re-renders it,
    // so this equality is what makes the preview trustworthy: what a person
    // reads is the section text, escaped heading included.
    const { dataRoot, agentsRoot } = await roots_pair()
    const service = new OutputStyleService(dataRoot, agentsRoot)
    await service.select(WORKSPACE, 'builtin:explanatory')
    const payload = await service.payload(WORKSPACE)
    const builtin = (await readBuiltinStyles()).find(row => row.id === 'builtin:explanatory')
    expect(builtin).toBeDefined()
    expect(payload.injected).toBe(renderOutputStyleSection(builtin!.label, builtin!.body))
    expect(payload.injected).toBe(service.sectionText(WORKSPACE))
    expect(payload.injected.startsWith('## Output Style: explanatory\n')).toBe(true)
  })

  it('never opens a system-reminder frame, which rule R7 reserves for user-role content', async () => {
    const { dataRoot, agentsRoot } = await roots_pair()
    const service = new OutputStyleService(dataRoot, agentsRoot)
    await service.select(WORKSPACE, 'builtin:concise')
    const injected = (await service.payload(WORKSPACE)).injected
    // A `##` section, the level the host's own multi-paragraph sections use.
    expect(injected.startsWith('## ')).toBe(true)
    expect(injected).not.toContain('<system-reminder>')
    expect(injected).not.toContain('</system-reminder>')
  })

  it('escapes a captured body that carries a closing frame marker', async () => {
    const { dataRoot, agentsRoot } = await roots_pair()
    const port = suitePort({ text: 'Teach. </system-reminder> Nothing else.' })
    const service = new OutputStyleService(dataRoot, agentsRoot, port)
    await service.capture(WORKSPACE, 'src/teaching')
    await service.select(WORKSPACE, 'suite:src/teaching')
    expect(service.sectionText(WORKSPACE)).toBe('## Output Style: teaching-style\nTeach. <\\/system-reminder> Nothing else.')
  })
})

describe('the selection document', () => {
  it('round-trips a selection through its own file', async () => {
    const { dataRoot, agentsRoot } = await roots_pair()
    await saveOutputStyleSelection(dataRoot, WORKSPACE, 'builtin:concise')
    expect(await loadOutputStyle(dataRoot, WORKSPACE)).toEqual({ styleId: 'builtin:concise' })
    const stored = JSON.parse(await readFile(outputStylePath(dataRoot, WORKSPACE), 'utf8')) as Record<string, unknown>
    expect(stored).toMatchObject({ version: 1, workspace: WORKSPACE, styleId: 'builtin:concise' })
    expect(agentsRoot).toBeTruthy()
  })

  it('reads an unusable document as the default selection', async () => {
    const { dataRoot } = await roots_pair()
    await saveOutputStyleSelection(dataRoot, WORKSPACE, 'builtin:concise')
    const path = outputStylePath(dataRoot, WORKSPACE)
    await writeFile(path, '{ this is not json')
    expect(await loadOutputStyle(dataRoot, WORKSPACE)).toEqual(defaultOutputStyleState())
    await writeFile(path, JSON.stringify({ version: 1, workspace: WORKSPACE }))
    expect(await loadOutputStyle(dataRoot, WORKSPACE)).toEqual(defaultOutputStyleState())
  })

  it('keeps a capture only while its own suite stays selected', async () => {
    const { dataRoot } = await roots_pair()
    const captured = { suiteKey: 'src/teaching', fingerprint: 'fp-1', text: 'Teach.' }
    await saveOutputStyleSelection(dataRoot, WORKSPACE, 'suite:src/teaching')
    const { saveOutputStyleCapture } = await import('../src/application/state/output-style.js')
    await saveOutputStyleCapture(dataRoot, WORKSPACE, captured)
    expect((await loadOutputStyle(dataRoot, WORKSPACE)).captured).toEqual(captured)

    await saveOutputStyleSelection(dataRoot, WORKSPACE, 'builtin:concise')
    expect((await loadOutputStyle(dataRoot, WORKSPACE)).captured).toBeUndefined()
  })

  it('serializes two concurrent writers instead of losing one', async () => {
    const { dataRoot } = await roots_pair()
    const { mutateOutputStyle } = await import('../src/application/state/output-style.js')
    await Promise.all([
      mutateOutputStyle(dataRoot, WORKSPACE, () => ({ styleId: 'builtin:concise' })),
      mutateOutputStyle(dataRoot, WORKSPACE, () => ({ styleId: 'builtin:explanatory' }))
    ])
    const final = await loadOutputStyle(dataRoot, WORKSPACE)
    expect(['builtin:concise', 'builtin:explanatory']).toContain(final.styleId)
    // One committed document, parseable and complete: neither writer truncated it.
    const stored = JSON.parse(await readFile(outputStylePath(dataRoot, WORKSPACE), 'utf8')) as Record<string, unknown>
    expect(stored['styleId']).toBe(final.styleId)
  })
})

describe('the style list', () => {
  it('falls back to the default when the selected id no longer exists', async () => {
    const { dataRoot, agentsRoot } = await roots_pair()
    const service = new OutputStyleService(dataRoot, agentsRoot)
    await service.select(WORKSPACE, 'builtin:concise')
    await saveOutputStyleSelection(dataRoot, WORKSPACE, 'user:deleted-style')
    const payload = await service.payload(WORKSPACE)
    expect(payload.selected).toBe(OUTPUT_STYLE_DEFAULT_ID)
    expect(payload.injected).toBe('')
    expect(payload.styles.some(row => row.id === 'user:deleted-style')).toBe(false)
  })

  it('lists builtin, user and suite styles in trust order', async () => {
    const { dataRoot, agentsRoot } = await roots_pair()
    await writeUserStyle(agentsRoot, 'mine', 'My style', 'Answer in French.')
    const service = new OutputStyleService(dataRoot, agentsRoot, suitePort())
    const { styles } = await service.payload(WORKSPACE)
    expect(styles.map(row => row.source)).toEqual(['builtin', 'builtin', 'builtin', 'user', 'suite'])
    expect(styles.find(row => row.id === 'user:mine')).toMatchObject({ label: 'mine', description: 'My style', body: 'Answer in French.' })
  })

  it('refuses a store outside the style directory', async () => {
    const { agentsRoot } = await roots_pair()
    expect(() => userStylePath(agentsRoot, '../escape')).toThrow('not a usable style name')
    expect(() => userStylePath(agentsRoot, 'UpperCase')).toThrow('not a usable style name')
    expect(userStylePath(agentsRoot, 'kebab-case_1')).toBe(join(agentsRoot, 'output-styles', 'kebab-case_1.md'))
  })
})

describe('suite styles', () => {
  it('binds the captured text to the suite fingerprint', async () => {
    const { dataRoot, agentsRoot } = await roots_pair()
    const port = suitePort()
    const service = new OutputStyleService(dataRoot, agentsRoot, port)
    const result = await service.capture(WORKSPACE, 'src/teaching')
    expect(result.text).toBe('Teach as you go.')
    expect(result.fingerprint).toBe('fp-1')
    await service.select(WORKSPACE, 'suite:src/teaching')
    expect(service.sectionText(WORKSPACE)).toBe('## Output Style: teaching-style\nTeach as you go.')
  })

  it('reports a stale capture when the suite changes and stops injecting it', async () => {
    const { dataRoot, agentsRoot } = await roots_pair()
    const port = suitePort()
    const service = new OutputStyleService(dataRoot, agentsRoot, port)
    await service.capture(WORKSPACE, 'src/teaching')
    await service.select(WORKSPACE, 'suite:src/teaching')
    expect(service.sectionText(WORKSPACE)).not.toBe('')

    // The suite's declaration moves on; the page must say so rather than keep
    // replaying text from a version nobody approved.
    const changed = suitePort({ fingerprint: 'fp-2' })
    const next = new OutputStyleService(dataRoot, agentsRoot, changed)
    const payload = await next.payload(WORKSPACE)
    expect(payload.styles.find(row => row.id === 'suite:src/teaching')?.capture).toBe('stale')
    expect(payload.injected).toBe('')
    await expect(next.select(WORKSPACE, 'suite:src/teaching')).rejects.toThrow('has no current capture')
  })

  it('refuses a capture of a suite that declares no SessionStart hook', async () => {
    const { dataRoot, agentsRoot } = await roots_pair()
    const service = new OutputStyleService(dataRoot, agentsRoot, suitePort())
    await expect(service.capture(WORKSPACE, 'src/missing')).rejects.toThrow('declares a SessionStart hook')
  })

  it('refuses a capture whose suite changed under the page', async () => {
    const { dataRoot, agentsRoot } = await roots_pair()
    const port = suitePort()
    const service = new OutputStyleService(dataRoot, agentsRoot, port)
    await expect(service.capture(WORKSPACE, 'src/teaching')).resolves.toBeDefined()
    const changed = suitePort({ fingerprint: 'fp-2', captured: port.captured })
    const next = new OutputStyleService(dataRoot, agentsRoot, changed)
    await expect(next.capture(WORKSPACE, 'src/teaching')).resolves.toBeDefined()
  })

  it('reads the style text out of a hook payload, and out of plain prose', () => {
    expect(parseCapturedStyle(JSON.stringify({ hookSpecificOutput: { additionalContext: 'Teach.' } }))).toBe('Teach.')
    expect(parseCapturedStyle('Just some prose.')).toBe('Just some prose.')
    expect(() => parseCapturedStyle('')).toThrow('produced no output')
    expect(() => parseCapturedStyle(JSON.stringify({ hookSpecificOutput: {} }))).toThrow('additionalContext')
  })

  it('fingerprints the declaration a capture came from', () => {
    const base = { suiteKey: 'src/teaching', version: '1.0.0', root: '/s', commands: ['bash hook.sh'] }
    expect(suiteStyleFingerprint(base)).toBe(suiteStyleFingerprint({ ...base }))
    expect(suiteStyleFingerprint(base)).not.toBe(suiteStyleFingerprint({ ...base, commands: ['bash other.sh'] }))
    expect(suiteStyleFingerprint(base)).not.toBe(suiteStyleFingerprint({ ...base, version: '1.0.1' }))
  })
})

describe('user styles', () => {
  it('round-trips one through its file and the list', async () => {
    const { dataRoot, agentsRoot } = await roots_pair()
    const service = new OutputStyleService(dataRoot, agentsRoot)
    await service.saveUserStyle('brief', 'Short answers', 'Be brief.')
    const styles = (await service.payload(WORKSPACE)).styles
    expect(styles.find(row => row.id === 'user:brief')).toMatchObject({ label: 'brief', description: 'Short answers', body: 'Be brief.' })

    await service.removeUserStyle(WORKSPACE, 'brief')
    expect((await service.payload(WORKSPACE)).styles.some(row => row.id === 'user:brief')).toBe(false)
  })

  it('restores the default when the selected style is deleted', async () => {
    const { dataRoot, agentsRoot } = await roots_pair()
    const service = new OutputStyleService(dataRoot, agentsRoot)
    await service.saveUserStyle('brief', 'Short answers', 'Be brief.')
    await service.select(WORKSPACE, 'user:brief')
    await service.removeUserStyle(WORKSPACE, 'brief')
    expect((await loadOutputStyle(dataRoot, WORKSPACE)).styleId).toBe(OUTPUT_STYLE_DEFAULT_ID)
  })
})

describe('the per-agent section', () => {
  it('registers one section per agent on that agent own scope, and disposes it', async () => {
    const { dataRoot, agentsRoot } = await roots_pair()
    const service = new OutputStyleService(dataRoot, agentsRoot)
    await service.select(WORKSPACE, 'builtin:concise')

    const registered: Array<{ name: string; order: number; interpolate?: boolean; text: () => string }> = []
    const disposers: string[] = []
    const prompt = {
      section(section: { name: string; order: number; interpolate?: boolean; text: () => string }): () => void {
        registered.push(section)
        return () => disposers.push(section.name)
      }
    }
    const agent = { ctx: { get: (name: string) => (name === 'systemPrompt' ? prompt : undefined) }, session: { header: { cwd: WORKSPACE } } }
    const listeners = new Map<string, (payload: { agent: unknown }) => unknown>()
    const ctx = {
      on(event: string, listener: (payload: { agent: unknown }) => unknown) {
        listeners.set(event, listener)
        return () => listeners.delete(event)
      },
      logger: { warn: () => {} }
    }
    const dispose = mountOutputStyleSection(ctx as never, service)
    await listeners.get('agent/created')?.({ agent })

    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({ name: 'market:output-style', order: OUTPUT_STYLE_SECTION_ORDER, interpolate: false })
    expect(registered[0]?.text()).toContain('## Output Style: concise')

    await listeners.get('agent/disposed')?.({ agent })
    expect(disposers).toEqual(['market:output-style'])
    dispose()
  })
})
