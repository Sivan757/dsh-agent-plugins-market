/**
 * Scoped extension effects across two sessions in one workspace.
 *
 * The plugin entry is mounted for real; selections are driven through the routes it
 * registers, and the effect under test is observable outside the plugin: a suite hook
 * runs a shell command, so the shell seat's own call log distinguishes the session that
 * granted the suite from its same-cwd sibling that granted nothing.
 *
 * Both halves are covered here through the real host registry: commands are asserted with
 * the host's own CommandRuntime (see loadCommandRuntime for how it is resolved in this tree)
 * and hooks through the real tools/pre-execute lifecycle.
 */
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { SessionId } from '@deepseek-ai/dsh-session'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { EXTENSION_ROUTES, type ExtensionWindowPayload } from '../src/contracts/extension-presets.js'
import { apply, inject, name } from '../src/index.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})
class TestQuery extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }
}
const settled = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
/** The namespace-style plugin object a loader hands to ctx.plugin: apply is async. */
interface EntryPlugin {
  name: string
  inject: string[]
  apply(ctx: Context): unknown
}
/**
 * The host command registry ships as a transitive package of this tree, not as a
 * declared dependency: it is resolved through the declared graph instead, from
 * the testkit this project already depends on, so no dependency and no
 * production API changes.
 */
async function loadCommandRuntime(): Promise<new (ctx: Context) => unknown> {
  const fromTestkit = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-agent-loop-testkit'))
  let entry: string
  try {
    entry = fromTestkit.resolve('@deepseek-ai/dsh-commands')
  } catch {
    throw new Error('the host command registry is not present in this tree')
  }
  const module = (await import(pathToFileURL(entry).href)) as {
    CommandRuntime: new (ctx: Context) => unknown
  }
  return module.CommandRuntime
}
function mount(ctx: Context, plugin: Plugin): Fiber {
  const fiber = ctx.plugin(plugin)
  cleanups.push(() => fiber.dispose())
  return fiber
}
/** The host shell seat, recording every command the plugin ever runs. */
function shellSeat() {
  const calls: Array<{ command: string; workdir?: string }> = []
  const execute = vi.fn(async (request: { command: string; workdir?: string }) => {
    calls.push(request)
    return {
      result: async () => ({ exitCode: 0, stdout: { text: 'ok' }, stderr: { text: '' } })
    }
  })
  return { calls, execute }
}
type RouteHandler = (request: unknown, response: unknown) => void | Promise<void>
function fakeWebServer(routes: Map<string, RouteHandler>) {
  class FakeWebServer extends Service {
    constructor(ctx: Context) {
      super(ctx, 'webServer')
    }
    register(route: { path: string; handler: RouteHandler }): () => void {
      routes.set(route.path, route.handler)
      return () => routes.delete(route.path)
    }
  }
  return { Plugin: FakeWebServer }
}
function fakeLoader() {
  class FakeLoader extends Service {
    constructor(ctx: Context) {
      super(ctx, 'loader')
    }
  }
  return { Plugin: FakeLoader }
}
function jsonResponse() {
  let body = ''
  let code = 0
  return {
    value: (): unknown => JSON.parse(body),
    status: (): number => code,
    writeHead: (status: number) => {
      code = status
    },
    end: (value: string) => {
      body = value
    }
  }
}
function jsonRequest(url: string, method: 'GET' | 'POST', payload?: unknown): unknown {
  const body = payload === undefined ? Readable.from([]) : Readable.from([JSON.stringify(payload)])
  return {
    method,
    url,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
    [Symbol.asyncIterator]: () => body[Symbol.asyncIterator](),
    on: body.on.bind(body),
    destroy: () => body.destroy()
  }
}
async function put(dir: string, path: string, value: unknown): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), typeof value === 'string' ? value : JSON.stringify(value))
}
const SUITE_ID = 'market:demo/v1-suite'
const entryId = (kind: string, entry: string) => kind + ':' + JSON.stringify(['demo', 'v1-suite', kind, entry])
const exec = (agent: Agent, toolName: string) => ({
  agent,
  name: toolName,
  arguments: { command: 'true' },
  callId: ToolCallId('call-1'),
  rootCallId: ToolCallId('call-1'),
  token: Symbol('tool') as ToolExecution['token'],
  signal: new AbortController().signal
})

describe('scoped extension effects in one workspace', () => {
  it('runs a granted suite hook for its own session only, and never for the same-cwd sibling', async () => {
    const home = await mkdtemp(join(tmpdir(), 'scoped-effects-'))
    cleanups.push(() => rm(home, { recursive: true, force: true }))
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents'))
    await cp(join(fixtures, 'v1-suite'), join(home, 'agent-plugins', '.sources', 'demo', 'v1-suite'), { recursive: true })
    await put(home, 'agent-plugins/state.json', {
      version: 1,
      sources: [{ id: 'demo', url: 'file:///demo' }],
      installed: { 'demo/v1-suite': { enabled: true, installedAt: new Date(0).toISOString() } }
    })
    // The user Agent layout root's own hook file. Its suite is the configuration the
    // session window exposes one row per command hook for, unlike an installed suite.
    await put(home, 'agents/hooks.json', { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo audit-user-hook' }] }] } })

    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(Persistence, { root: join(home, 'sessions') })
    await ctx.plugin(TestQuery)
    await ctx.plugin(AgentLoop, { agents: [] })
    const routes = new Map<string, RouteHandler>()
    mount(ctx, fakeWebServer(routes).Plugin)
    mount(ctx, fakeLoader().Plugin)
    const shell = shellSeat()
    // The seat is a provided service object, the shape the host's own hooks tests use:
    // the scoped mount reaches for ctx.shell.execute, not for a plugin instance.
    ctx.provide('shell')
    // The seat contract returns void; the call log is written synchronously inside execute.
    ctx.set('shell', {
      resolve: (request: unknown) => request,
      execute: (request: unknown) => {
        void shell.execute(request as never)
      }
    })
    mount(ctx, SkillRegistry)
    const CommandRuntime = await loadCommandRuntime()
    // The registry plugin takes no config here; the cast keeps the transitive
    // package's own Context augmentation out of this file's types.
    await (ctx.plugin as unknown as (plugin: unknown, config?: unknown) => Promise<unknown>)(CommandRuntime)
    await settled()
    const entry: EntryPlugin = { name, inject: [...inject], apply }
    mount(ctx, entry)
    await vi.waitFor(() => expect(routes.has(EXTENSION_ROUTES.window)).toBe(true))

    const granted = await ctx.agentLoop.create(SessionId('granted'), { provider: 'mock', model: 'test' }, { cwd: home })
    const withheld = await ctx.agentLoop.create(SessionId('withheld'), { provider: 'mock', model: 'test' }, { cwd: home })
    expect(granted.session.header.cwd).toBe(withheld.session.header.cwd)

    const windowOf = async (sessionId: string): Promise<ExtensionWindowPayload> => {
      const response = jsonResponse()
      await routes.get(EXTENSION_ROUTES.window)!(jsonRequest(EXTENSION_ROUTES.window + '?sessionId=' + sessionId, 'GET'), response)
      expect(response.status()).toBe(200)
      return response.value() as ExtensionWindowPayload
    }
    let presetSequence = 0
    /**
     * Grant exactly these ids through the public routes, the way the product does now:
     * create a named preset, then select it. The library revision and the session state
     * revision are separate counters, each read immediately before the call consuming it.
     */
    const applyPreset = async (sessionId: string, enabledIds: string[]): Promise<void> => {
      const name = 'scoped-effects-preset-' + presetSequence++
      const created = jsonResponse()
      await routes.get(EXTENSION_ROUTES.create)!(
        jsonRequest(EXTENSION_ROUTES.create, 'POST', {
          sessionId,
          expectedRevision: (await windowOf(sessionId)).library.revision,
          name,
          enabledIds
        }),
        created
      )
      await settled()
      expect(created.status(), JSON.stringify(created.value())).toBe(200)
      const preset = (await windowOf(sessionId)).library.presets.find(row => row.name === name)
      if (preset === undefined) throw new Error('extension preset was not created')
      const selected = jsonResponse()
      await routes.get(EXTENSION_ROUTES.select)!(
        jsonRequest(EXTENSION_ROUTES.select, 'POST', { sessionId, expectedRevision: (await windowOf(sessionId)).state.revision, presetId: preset.id }),
        selected
      )
      await settled()
      expect(selected.status(), JSON.stringify(selected.value())).toBe(200)
    }

    // The sibling gives up everything it captured; the granted one keeps the suite.
    await applyPreset(withheld.id, [])
    // Hooks ride the suite grant; commands are gated per entry like skills, so the
    // granted session names both the suite and the command's own tuple.
    await applyPreset(granted.id, [SUITE_ID, entryId('commands', 'deploy')])
    await settled()

    // Commands are the host's own scoped registry: the granted session sees the
    // suite's command, its sibling does not. Same registry instance, per-agent layers.
    const commands = (ctx as unknown as { commands: { list(agent: unknown): Array<{ name: string }> } }).commands
    expect(commands.list(granted).map(row => row.name)).toContain('deploy')
    expect(commands.list(withheld).map(row => row.name)).not.toContain('deploy')

    // The suite's PreToolUse hook runs a shell command. Fire the lifecycle for both.
    shell.calls.length = 0
    await ctx.waterfall('tools/pre-execute', exec(granted, 'Bash'), async () => ({ kind: 'allow' as const }))
    await vi.waitFor(() => expect(shell.calls.length).toBe(1))
    expect(shell.calls[0]?.command).toContain('echo hi')
    await ctx.waterfall('tools/pre-execute', exec(withheld, 'Bash'), async () => ({ kind: 'allow' as const }))
    await settled()
    expect(shell.calls).toHaveLength(1)

    // The user hooks configuration suite publishes one row per command hook, so its
    // hooks answer to their own identity: the parent grant admits none of them, the
    // named row admits exactly it, and a sibling session still gets nothing.
    const configured = await windowOf(granted.id)
    const userHook = configured.resources.find(row => row.face === 'hooks' && row.name === 'echo audit-user-hook')
    expect(userHook?.available).toBe(true)
    expect(userHook?.suiteResourceId).toBe('market:@user-hooks/user-hooks')
    await applyPreset(withheld.id, [userHook!.suiteResourceId!, userHook!.id])
    await applyPreset(granted.id, [userHook!.suiteResourceId!, userHook!.id])
    await settled()
    shell.calls.length = 0
    await ctx.waterfall('tools/pre-execute', exec(granted, 'Bash'), async () => ({ kind: 'allow' as const }))
    await vi.waitFor(() => expect(shell.calls.length).toBe(1))
    expect(shell.calls[0]?.command).toBe('echo audit-user-hook')
    shell.calls.length = 0
    await ctx.waterfall('tools/pre-execute', exec(withheld, 'Bash'), async () => ({ kind: 'allow' as const }))
    await settled()
    expect(shell.calls).toHaveLength(1)

    // Child off: the parent stays granted and the row identity goes away, so the
    // hook must not dispatch. A stale event position must not resurrect it either.
    await applyPreset(granted.id, [userHook!.suiteResourceId!])
    const after = await windowOf(granted.id)
    expect(after.state.selection.enabledIds).not.toContain(userHook!.id)
    expect(after.status?.ready).toBe(true)
    shell.calls.length = 0
    await ctx.waterfall('tools/pre-execute', exec(granted, 'Bash'), async () => ({ kind: 'allow' as const }))
    await settled()
    expect(shell.calls.map(call => call.command)).toEqual([])
    await applyPreset(granted.id, [userHook!.suiteResourceId!, 'hooks:@user-hooks/user-hooks/PreToolUse/7', 'hooks:@user-hooks/user-hooks/Stop/0'])
    shell.calls.length = 0
    await ctx.waterfall('tools/pre-execute', exec(granted, 'Bash'), async () => ({ kind: 'allow' as const }))
    await settled()
    expect(shell.calls.map(call => call.command)).toEqual([])
  })
})
