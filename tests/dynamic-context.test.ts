import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanSource } from '../src/catalog/suite-scanner.js'
import { CommandMountRegistry } from '../src/runtime/commands-mounts.js'
import { SuiteSkillProvider } from '../src/runtime/skills-provider.js'
import { benignExit, injectDynamicContext, type ShellOutcome, type ShellSeam } from '../src/runtime/dynamic-context.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'

const roots: string[] = []
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'market-dynamic-context-'))
  roots.push(path)
  return path
}
async function put(dir: string, path: string, value: string | object): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), typeof value === 'string' ? value : JSON.stringify(value))
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function outcome(overrides: Partial<ShellOutcome> = {}): ShellOutcome {
  return {
    exitCode: 0,
    timedOut: false,
    aborted: false,
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
    ...overrides
  }
}

/** A shell seam that answers each command from a table and records what it ran. */
function shellFor(answers: Record<string, ShellOutcome | Error>): ShellSeam & { commands: string[]; workdirs: Array<string | undefined> } {
  const commands: string[] = []
  const workdirs: Array<string | undefined> = []
  return {
    commands,
    workdirs,
    resolve: request => {
      commands.push(request.command)
      workdirs.push(request.workdir)
      return request
    },
    run: async spec => {
      const answer = answers[(spec as { command: string }).command]
      if (answer === undefined) throw new Error(`unexpected command: ${(spec as { command: string }).command}`)
      if (answer instanceof Error) throw answer
      return answer
    }
  }
}

/**
 * A context stub that resolves `shell` the way a Cordis context does — through
 * `get`. Attaching the seam as a plain `shell` property would hide the failure
 * this stub exists to stay honest about; `tests/host-shell-seam.test.ts` mounts
 * the real fiber tree where the property read throws.
 */
function shellService(shell: ShellSeam | undefined): { get(name: string): unknown } {
  return { get: (name: string) => (name === 'shell' ? shell : undefined) }
}

describe('dynamic context injection', () => {
  it('replaces inline placeholders with their command output', async () => {
    const shell = shellFor({ 'git status --short': outcome({ stdout: { text: ' M a.ts\n', truncated: false } }) })
    expect(await injectDynamicContext('Changes:\n!`git status --short`\ndone\n', { shell })).toBe('Changes:\n M a.ts\ndone\n')
    expect(shell.commands).toEqual(['git status --short'])
  })

  it('runs a placeholder mid-line and after a list marker', async () => {
    const shell = shellFor({ 'date +%Y': outcome({ stdout: { text: '2026\n', truncated: false } }) })
    expect(await injectDynamicContext('- year !`date +%Y` here', { shell })).toBe('- year 2026 here')
  })

  it('leaves a bang that follows a non-space character alone', async () => {
    const shell = shellFor({})
    expect(await injectDynamicContext('KEY=!`never` value', { shell })).toBe('KEY=!`never` value')
    expect(shell.commands).toEqual([])
  })

  it('runs a fenced multi-line block as one script', async () => {
    const shell = shellFor({ 'echo one\necho two': outcome({ stdout: { text: 'one\ntwo\n', truncated: false } }) })
    expect(await injectDynamicContext('Before\n```!\necho one\necho two\n```\nAfter\n', { shell })).toBe('Before\none\ntwo\nAfter\n')
    expect(shell.commands).toEqual(['echo one\necho two'])
  })

  it('never re-scans an injected output', async () => {
    const shell = shellFor({ echo: outcome({ stdout: { text: '!`echo nested`', truncated: false } }) })
    expect(await injectDynamicContext('!`echo`', { shell })).toBe('!`echo nested`')
    expect(shell.commands).toEqual(['echo'])
  })

  it('runs several placeholders in order and passes the session directory', async () => {
    const shell = shellFor({ pwd: outcome({ stdout: { text: '/here\n', truncated: false } }) })
    expect(await injectDynamicContext('a !`pwd` b !`pwd`', { shell, workdir: '/here' })).toBe('a /here b /here')
    expect(shell.workdirs).toEqual(['/here', '/here'])
  })

  it('merges both captured streams', async () => {
    const shell = shellFor({ noisy: outcome({ stdout: { text: 'out\n', truncated: false }, stderr: { text: 'err\n', truncated: false } }) })
    expect(await injectDynamicContext('!`noisy`', { shell })).toBe('out\nerr')
  })

  it('reports truncated output', async () => {
    const shell = shellFor({ big: outcome({ stdout: { text: 'head\n', truncated: true, spillPath: '/tmp/spill' } }) })
    expect(await injectDynamicContext('!`big`', { shell })).toBe('head\n[output truncated; full output: /tmp/spill]')
  })

  it('aborts the whole invocation with the command output when it fails', async () => {
    const shell = shellFor({ boom: outcome({ exitCode: 2, stdout: { text: 'partial', truncated: false }, stderr: { text: 'bad thing', truncated: false } }) })
    await expect(injectDynamicContext('!`boom`', { shell })).rejects.toThrow(
      'Shell command failed for pattern "!`boom`" (exited with code 2)\n[stdout]\npartial\n[stderr]\nbad thing'
    )
  })

  it('names a timeout and an abort as their own causes', async () => {
    const timedOut = shellFor({ slow: outcome({ exitCode: null, timedOut: true }) })
    await expect(injectDynamicContext('!`slow`', { shell: timedOut })).rejects.toThrow('timed out after 120000ms')
    const aborted = shellFor({ stuck: outcome({ exitCode: null, aborted: true }) })
    await expect(injectDynamicContext('!`stuck`', { shell: aborted })).rejects.toThrow('was aborted')
  })

  it('accepts exit code 1 for the commands whose benign result it is', () => {
    expect(benignExit(0, 'anything')).toBe(true)
    expect(benignExit(1, 'grep -rn x .')).toBe(true)
    expect(benignExit(1, 'FOO=1 rg x')).toBe(true)
    expect(benignExit(1, 'git diff --stat')).toBe(true)
    expect(benignExit(1, 'git grep x')).toBe(true)
    expect(benignExit(1, 'jq -e . empty.json')).toBe(false)
    expect(benignExit(2, 'grep x')).toBe(false)
    expect(benignExit(null, 'grep x')).toBe(false)
  })
})

describe('dynamic context reaches the model through the surfaces', () => {
  it('inlines a command body placeholder before forwarding it', async () => {
    const dir = await root()
    await put(dir, '.claude-plugin/plugin.json', { name: 'demo' })
    await put(dir, 'commands/status.md', '---\ndescription: Status\n---\nStatus: !`git status --short`')
    const [suite] = (await scanSource(dir, 's', 'user')).suites
    if (suite === undefined) throw new Error('expected the layout to resolve to one suite')
    const registered: Array<{ handler: (invocation: { agent: unknown; rawInput: string }) => Promise<unknown> }> = []
    const shell = shellFor({ 'git status --short': outcome({ stdout: { text: ' M a.ts\n', truncated: false } }) })
    const registry = new CommandMountRegistry({ ...shellService(shell), commands: { register: (definition: never) => (registered.push(definition), () => {}) } } as never)
    await registry.reconcile([withDefaultSurfaces({ ...suite, enabled: true })])

    let forwarded = ''
    const result = await registered[0]!.handler({
      agent: { session: { header: { cwd: dir } }, followup: (message: { content: Array<{ text: string }> }) => (forwarded = message.content[0]?.text ?? '') },
      rawInput: ''
    })
    expect(result).toMatchObject({ kind: 'success' })
    expect(forwarded).toBe('Status:  M a.ts')
    expect(shell.workdirs).toEqual([dir])
    registry.disposeAll()
  })

  it('fails the invocation instead of forwarding a half-injected body', async () => {
    const dir = await root()
    await put(dir, '.claude-plugin/plugin.json', { name: 'demo' })
    await put(dir, 'commands/status.md', '---\ndescription: Status\n---\nStatus: !`exit 3`')
    const [suite] = (await scanSource(dir, 's', 'user')).suites
    if (suite === undefined) throw new Error('expected the layout to resolve to one suite')
    const registered: Array<{ handler: (invocation: { agent: unknown; rawInput: string }) => Promise<{ kind: string; text: string }> }> = []
    const shell = shellFor({ 'exit 3': outcome({ exitCode: 3 }) })
    const registry = new CommandMountRegistry({ ...shellService(shell), commands: { register: (definition: never) => (registered.push(definition), () => {}) } } as never)
    await registry.reconcile([withDefaultSurfaces({ ...suite, enabled: true })])
    const followed: unknown[] = []
    const result = await registered[0]!.handler({ agent: { session: { header: { cwd: dir } }, followup: (message: unknown) => followed.push(message) }, rawInput: '' })
    expect(result.kind).toBe('error')
    expect(result.text).toContain('Shell command failed for pattern "!`exit 3`"')
    expect(followed).toEqual([])
    registry.disposeAll()
  })

  it('keeps the placeholder literal when the profile has no shell seam', async () => {
    const dir = await root()
    await put(dir, '.claude-plugin/plugin.json', { name: 'demo' })
    await put(dir, 'commands/status.md', '---\ndescription: Status\n---\nStatus: !`git status --short`')
    const [suite] = (await scanSource(dir, 's', 'user')).suites
    if (suite === undefined) throw new Error('expected the layout to resolve to one suite')
    const registered: Array<{ handler: (invocation: { agent: unknown; rawInput: string }) => Promise<unknown> }> = []
    const registry = new CommandMountRegistry({ ...shellService(undefined), commands: { register: (definition: never) => (registered.push(definition), () => {}) } } as never)
    await registry.reconcile([withDefaultSurfaces({ ...suite, enabled: true })])
    let forwarded = ''
    await registered[0]!.handler({
      agent: { session: { header: { cwd: dir } }, followup: (message: { content: Array<{ text: string }> }) => (forwarded = message.content[0]?.text ?? '') },
      rawInput: ''
    })
    expect(forwarded).toBe('Status: !`git status --short`')
    registry.disposeAll()
  })

  it('inlines a skill body placeholder on load', async () => {
    const dir = await root()
    await put(dir, '.claude-plugin/plugin.json', { name: 'demo' })
    await put(dir, 'skills/status/SKILL.md', '---\nname: status\ndescription: Status\n---\nBranch: !`git rev-parse --abbrev-ref HEAD`')
    const [suite] = (await scanSource(dir, 's', 'user')).suites
    if (suite === undefined) throw new Error('expected the layout to resolve to one suite')
    const shell = shellFor({ 'git rev-parse --abbrev-ref HEAD': outcome({ stdout: { text: 'main\n', truncated: false } }) })
    const provider = new SuiteSkillProvider({ enabledUserSuites: async () => [withDefaultSurfaces({ ...suite, enabled: true })] } as never, { shell: () => shell })
    const [candidate] = await provider.list({})
    if (candidate === undefined) throw new Error('expected the suite to list one skill')
    expect((await provider.get(candidate, { cwd: dir }))?.content).toBe('Branch: main')
    expect(shell.workdirs).toEqual([dir])
  })

  it('surfaces a failed skill placeholder instead of returning half the skill', async () => {
    const dir = await root()
    await put(dir, '.claude-plugin/plugin.json', { name: 'demo' })
    await put(dir, 'skills/status/SKILL.md', '---\nname: status\ndescription: Status\n---\n!`exit 4`')
    const [suite] = (await scanSource(dir, 's', 'user')).suites
    if (suite === undefined) throw new Error('expected the layout to resolve to one suite')
    const shell = shellFor({ 'exit 4': outcome({ exitCode: 4 }) })
    const provider = new SuiteSkillProvider({ enabledUserSuites: async () => [withDefaultSurfaces({ ...suite, enabled: true })] } as never, { shell: () => shell })
    const [candidate] = await provider.list({})
    if (candidate === undefined) throw new Error('expected the suite to list one skill')
    await expect(provider.get(candidate, { cwd: dir })).rejects.toThrow('Shell command failed for pattern "!`exit 4`"')
  })
})
