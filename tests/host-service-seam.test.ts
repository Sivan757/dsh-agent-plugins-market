/**
 * Host services as a real fiber tree resolves them.
 *
 * Every profile provides `shell` and `tools` from fibers that are *siblings* of
 * the plugins reading them, and Cordis resolves `ctx.<service>` by walking the
 * reading fiber's ancestors. A scope that injects something else — the entry
 * injects `skills` and `commands`, the suite-command mount injects `commands` —
 * reaches the root and throws `cannot get property "<service>" without inject`,
 * which is how every suite skill and command body stopped loading, and how the
 * feedback tool silently stopped registering, while hand-built stubs stayed
 * green. These tests mount the real topology: the services come from sibling
 * fibers, the readers declare only what they inject, and the loading paths run
 * end to end.
 *
 * `tests/dynamic-context.test.ts` covers the injection pass itself against a
 * hand-made seam, and `tests/timer-seat.test.ts` pins the same ancestor-walk
 * trap for the timer accessors.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { scanSource } from '../src/catalog/suite-scanner.js'
import { CommandMountRegistry } from '../src/runtime/commands-mounts.js'
import { shellSeamOf, type ShellOutcome, type ShellSeam } from '../src/runtime/dynamic-context.js'
import { FEEDBACK_TOOL_NAME, mountFeedbackTool } from '../src/runtime/feedback-tool.js'
import { readLocalePreference } from '../src/runtime/host-locale.js'
import { SUITE_USER_SOURCE } from '../src/runtime/skills-provider.js'
import { apply, inject, name } from '../src/index.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'

const roots: string[] = []
const cleanups: Array<() => void | Promise<void>> = []

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'market-host-service-'))
  roots.push(path)
  return path
}

async function put(dir: string, path: string, value: string | object): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), typeof value === 'string' ? value : JSON.stringify(value))
}

/** Let the mounted plugin fibers activate: Cordis loads one on a later tick. */
const settled = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

/**
 * Mount a fiber and remember it for teardown. A case that unloads its own fiber
 * mid-test disposes the returned one; the teardown pass then finds it disposed.
 */
function mount(ctx: Context, plugin: Plugin): Fiber {
  const fiber = ctx.plugin(plugin)
  cleanups.push(() => fiber.dispose())
  return fiber
}

/**
 * The namespace-style plugin object a loader hands to `ctx.plugin`: the entry's
 * own `name`, `inject` and `apply`. Typed here because the entry's `apply` is
 * async, which the loader's plugin contract accepts and the shape below keeps.
 */
interface EntryPlugin {
  name: string
  inject: string[]
  apply(ctx: Context): unknown
}

/** Mount the entry the way the loader does. */
function mountEntry(ctx: Context, plugin: EntryPlugin): Fiber {
  return mount(ctx, plugin)
}

/** The host shell service, provided by whichever fiber the test mounts it on. */
function fakeShell(stdout: string) {
  const workdirs: Array<string | undefined> = []
  class FakeShell extends Service {
    constructor(ctx: Context) {
      super(ctx, 'shell')
    }

    resolve(request: { command: string; workdir?: string }): unknown {
      workdirs.push(request.workdir)
      return request
    }

    async run(): Promise<ShellOutcome> {
      return { exitCode: 0, timedOut: false, aborted: false, stdout: { text: stdout, truncated: false }, stderr: { text: '', truncated: false } }
    }
  }
  return { Plugin: FakeShell, workdirs }
}

/** The host tools service, keeping the definitions registered on it. */
function fakeTools() {
  const names: string[] = []
  class FakeTools extends Service {
    constructor(ctx: Context) {
      super(ctx, 'tools')
    }

    register(definition: { name: string }): () => void {
      names.push(definition.name)
      return () => {
        names.splice(names.indexOf(definition.name), 1)
      }
    }
  }
  return { Plugin: FakeTools, names }
}

/** The host skill registry, keeping the providers the entry registers. */
function fakeSkills() {
  const providers: Array<(control: SkillProviderControl) => SkillProvider> = []
  class FakeSkills extends Service {
    constructor(ctx: Context) {
      super(ctx, 'skills')
    }

    registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void {
      providers.push(create)
      return () => {}
    }
  }
  return { Plugin: FakeSkills, providers }
}

/** The host command registry, keeping the definitions the mount registers. */
function fakeCommands() {
  const definitions = new Map<string, { name: string; handler(invocation: { agent: unknown; rawInput: string }): unknown }>()
  class FakeCommands extends Service {
    constructor(ctx: Context) {
      super(ctx, 'commands')
    }

    register(definition: { name: string; handler(invocation: { agent: unknown; rawInput: string }): unknown }): () => void {
      definitions.set(definition.name, definition)
      return () => {
        definitions.delete(definition.name)
      }
    }
  }
  return { Plugin: FakeCommands, definitions }
}

/**
 * The host settings service, projecting the `locale` entry's live config the way
 * `@deepseek-ai/dsh-settings` does. The preference is mutable so a case can
 * change it the way a settings write does, and reads are counted so a case can
 * see the entry re-read when the form changes.
 */
function fakeSettings(preference: string) {
  const state = { preference, reads: 0 }
  class FakeSettings extends Service {
    constructor(ctx: Context) {
      super(ctx, 'settings')
    }

    describe(): Array<{ ns: string; value: unknown }> {
      state.reads += 1
      return [{ ns: 'locale', value: { preference: state.preference } }]
    }
  }
  return { Plugin: FakeSettings, state }
}

/**
 * Announce one settings form change the way `SettingsForms` does. The event
 * belongs to `@deepseek-ai/dsh-settings`, which this plugin does not depend on,
 * so its payload rides the same cast the production listener registers with.
 */
function emitSettingsUpdated(ctx: Context, ns: string): void {
  ;(ctx as unknown as { emit(name: string, ...args: unknown[]): void }).emit('settings/document-updated', ns, 1)
}

/** A suite skill candidate, shaped the way the provider's own listing shapes one. */ function candidate(file: string, directory: string, body: string): SkillCandidate {
  return {
    name: 'status',
    description: 'Status',
    invocation: { modelInvocable: true, userInvocable: false },
    source: SUITE_USER_SOURCE,
    provider: 'agent-plugin',
    rank: 450,
    locator: { content: `---\nname: status\ndescription: Status\n---\n${body}`, file, directory },
    path: file,
    resourceBase: { kind: 'directory', path: directory }
  }
}

describe('host services on a real fiber tree', () => {
  it('resolves a sibling fiber service where the property read throws', async () => {
    const ctx = new Context()
    const shell = fakeShell('main\n')
    mount(ctx, shell.Plugin)
    await settled()

    let seam: ShellSeam | undefined
    let trapped: unknown
    mount(ctx, {
      name: 'uninjected-reader',
      apply(scope: Context) {
        seam = shellSeamOf(scope)
        try {
          void (scope as unknown as { shell?: unknown }).shell
        } catch (error) {
          trapped = error
        }
      }
    })
    await vi.waitFor(() => expect(seam).toBeDefined())

    expect(String(trapped)).toContain('without inject')
  })

  it('injects command dynamic context into a fiber that injects only commands', async () => {
    const dir = await root()
    await put(dir, '.claude-plugin/plugin.json', { name: 'demo' })
    await put(dir, 'commands/status.md', '---\ndescription: Status\n---\nStatus: !`git status --short`')
    const [suite] = (await scanSource(dir, 's', 'user')).suites
    if (suite === undefined) throw new Error('expected the layout to resolve to one suite')

    const ctx = new Context()
    const shell = fakeShell(' M a.ts\n')
    const commands = fakeCommands()
    mount(ctx, shell.Plugin)
    mount(ctx, commands.Plugin)
    await settled()

    let registry: CommandMountRegistry | undefined
    mount(ctx, {
      name: 'suite-commands',
      inject: ['commands'],
      apply(scope: Context) {
        registry = new CommandMountRegistry(scope)
      }
    })
    await vi.waitFor(() => expect(registry).toBeDefined())
    await registry!.reconcile([withDefaultSurfaces({ ...suite, enabled: true })])

    const forwarded: string[] = []
    const definition = commands.definitions.get('status')
    expect(definition).toBeDefined()
    const result = await definition!.handler({
      agent: {
        session: { header: { cwd: dir } },
        followup: (message: { content: Array<{ text: string }> }) => forwarded.push(message.content[0]?.text ?? '')
      },
      rawInput: ''
    })

    expect(result).toMatchObject({ kind: 'success' })
    expect(forwarded).toEqual(['Status:  M a.ts'])
    expect(shell.workdirs).toEqual([dir])
  })

  it('loads a suite skill body through the plugin entry with the shell provided elsewhere', async () => {
    const home = await root()
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents'))

    const ctx = new Context()
    const shell = fakeShell('main\n')
    const skills = fakeSkills()
    mount(ctx, shell.Plugin)
    mount(ctx, skills.Plugin)
    mount(ctx, fakeCommands().Plugin)
    await settled()

    // The shape the loader hands to `ctx.plugin`: the entry's own name, inject
    // list and apply, load-bearing because the missing `shell` entry in that
    // list is what the skill path used to trip over.
    mountEntry(ctx, { name, inject: [...inject], apply })
    // The suite provider registers first; the user-panel provider follows it.
    await vi.waitFor(() => expect(skills.providers).toHaveLength(2))

    const provider = skills.providers[0]!({ signal: new AbortController().signal, invalidate: () => {} })
    const directory = join(home, 'agent-plugins', '.sources', 'demo', 'v1-suite', 'skills', 'status')
    await mkdir(directory, { recursive: true })
    const file = join(directory, 'SKILL.md')
    const definition = await provider.get(candidate(file, directory, 'Branch: !`git rev-parse --abbrev-ref HEAD`'), { cwd: home })

    expect(definition?.content).toBe('Branch: main')
    expect(shell.workdirs).toEqual([home])
  })

  it('registers the feedback tool from a fiber that injects neither tools nor shell', async () => {
    const dir = await root()
    const ctx = new Context()
    const tools = fakeTools()
    mount(ctx, tools.Plugin)
    mount(ctx, fakeSkills().Plugin)
    mount(ctx, fakeCommands().Plugin)
    await settled()

    let disposer: (() => void) | undefined
    let failure: unknown
    mount(ctx, {
      name: 'feedback-consumer',
      inject: ['skills', 'commands'],
      apply(scope: Context) {
        try {
          disposer = mountFeedbackTool(scope, dir, () => 'issue text')
        } catch (error) {
          failure = error
        }
      }
    })
    // A `tools` property read on this fiber throws; the service-store read
    // hands back the registry and the tool registers on it.
    await vi.waitFor(() => expect(failure ?? disposer).toBeDefined())

    expect(failure).toBeUndefined()
    expect(tools.names).toEqual([FEEDBACK_TOOL_NAME])
    disposer?.()
  })

  it('keeps the host locale readable across the entry unloading and applying again', async () => {
    const home = await root()
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents'))

    const ctx = new Context()
    const skills = fakeSkills()
    mount(ctx, skills.Plugin)
    mount(ctx, fakeCommands().Plugin)
    mount(ctx, fakeSettings('en').Plugin)
    await settled()

    const entry: EntryPlugin = { name, inject: [...inject], apply }
    const first = mountEntry(ctx, entry)
    // The suite provider registers first; the user-panel provider follows it.
    await vi.waitFor(() => expect(skills.providers).toHaveLength(2))
    await vi.waitFor(() => expect(readLocalePreference()).toBe('en'))

    // The loader reloads the entry in place: this fiber unloads, then the entry
    // applies again. An entry that resolved the service as a property read on an
    // injection callback's context reads through a fiber that is gone and
    // rejects with `cannot get required service "settings" in inactive
    // context` — an unhandled rejection, which the host reports as a fatal load
    // failure and exits on.
    await first.dispose()

    const rejections: unknown[] = []
    const onRejection = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on('unhandledRejection', onRejection)
    try {
      const reloaded = mountEntry(ctx, entry)
      await vi.waitFor(() => expect(skills.providers).toHaveLength(4))
      await settled()
      expect(rejections).toEqual([])
      expect(readLocalePreference()).toBe('en')

      // The wiring belongs to the entry that installed it: unloading clears it,
      // and a read then answers `undefined` instead of reaching a fiber that is
      // gone.
      await reloaded.dispose()
      expect(readLocalePreference()).toBeUndefined()
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  it('re-reads the locale when the settings service reports the entry changed', async () => {
    const home = await root()
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents'))

    const ctx = new Context()
    const skills = fakeSkills()
    const settings = fakeSettings('en')
    mount(ctx, skills.Plugin)
    mount(ctx, fakeCommands().Plugin)
    mount(ctx, settings.Plugin)
    await settled()
    mountEntry(ctx, { name, inject: [...inject], apply })
    await vi.waitFor(() => expect(skills.providers).toHaveLength(2))
    await vi.waitFor(() => expect(readLocalePreference()).toBe('en'))

    // A write to another entry's form is not this plugin's news.
    const reads = settings.state.reads
    emitSettingsUpdated(ctx, 'llm-deepseek')
    expect(settings.state.reads).toBe(reads)

    // The locale entry's own change re-reads, so a language switch reaches the
    // copy the market renders without a plugin reload.
    settings.state.preference = 'zh'
    emitSettingsUpdated(ctx, 'locale')
    expect(settings.state.reads).toBe(reads + 1)
    expect(readLocalePreference()).toBe('zh')
  })
})
