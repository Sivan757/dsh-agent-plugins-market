/**
 * A globally disabled suite, explicitly selected by one session.
 *
 * The suite is installed the way a user installs one and then switched off
 * globally (`installed.enabled: false`): its row stays selectable but is not
 * auto-enabled, so a fresh session captures nothing from it. A saved preset that
 * names the suite, one skill and one command must still serve those to the
 * session that selects it — and to no other session in the same workspace.
 *
 * The plugin entry is mounted for real and the selection is driven through the
 * routes it registers. Skills are asserted through the host skill registry with an
 * explicit calling scope, commands through the host's own CommandRuntime, and the
 * global install file is compared byte for byte so a session selection cannot be
 * mistaken for a global switch. MCP and LSP entries are deliberately not selected:
 * this case is about an ordinary disabled consumer, not about the mount path.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { SessionId } from '@deepseek-ai/dsh-session'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { EXTENSION_ROUTES, type ExtensionWindowPayload } from '../packages/market-contracts/src/contracts/extension-presets.js'
import { apply, inject, name } from '../packages/market-bundle/src/index.js'

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
 * declared dependency: it is resolved through the declared graph instead, from the
 * testkit this project already depends on, so no dependency and no production API
 * changes.
 */
async function loadCommandRuntime(): Promise<new (ctx: Context) => unknown> {
  const fromTestkit = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-agent-loop-testkit'))
  let entry: string
  try {
    entry = fromTestkit.resolve('@deepseek-ai/dsh-commands')
  } catch {
    throw new Error('the host command registry is not present in this tree')
  }
  const module = (await import(pathToFileURL(entry).href)) as { CommandRuntime: new (ctx: Context) => unknown }
  return module.CommandRuntime
}
function mount(ctx: Context, plugin: Plugin): Fiber {
  const fiber = ctx.plugin(plugin)
  cleanups.push(() => fiber.dispose())
  return fiber
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
/** The panel's authoritative entry tuple, the id the inventory row carries too. */
const entryId = (kind: string, entry: string) => kind + ':' + JSON.stringify(['demo', 'v1-suite', kind, entry])
const SKILL = 'greet'
const COMMAND = 'deploy'

describe('a globally disabled suite explicitly selected by one session', () => {
  it('serves the selected skill and command to that session only, and never flips the global switch', async () => {
    const home = await mkdtemp(join(tmpdir(), 'global-override-'))
    cleanups.push(() => rm(home, { recursive: true, force: true }))
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents'))
    await cp(join(fixtures, 'v1-suite'), join(home, 'agent-plugins', '.sources', 'demo', 'v1-suite'), { recursive: true })
    const statePath = join(home, 'agent-plugins', 'state.json')
    // Installed, then switched off globally: the declaration is present, the global
    // default is not. A session may still name it explicitly.
    await put(home, 'agent-plugins/state.json', {
      version: 1,
      sources: [{ id: 'demo', url: 'file:///demo' }],
      installed: { 'demo/v1-suite': { enabled: false, installedAt: new Date(0).toISOString() } }
    })

    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(Persistence, { root: join(home, 'sessions') })
    await ctx.plugin(TestQuery)
    await ctx.plugin(AgentLoop, { agents: [] })
    const routes = new Map<string, RouteHandler>()
    mount(ctx, fakeWebServer(routes).Plugin)
    mount(ctx, fakeLoader().Plugin)
    // The scoped mount's hooks fiber injects the host shell seam; the seat contract
    // returns void, so the plugin-owned call is all this test needs to satisfy.
    ctx.provide('shell')
    ctx.set('shell', { resolve: (request: unknown) => request, execute: () => {} })
    mount(ctx, SkillRegistry)
    const CommandRuntime = await loadCommandRuntime()
    await (ctx.plugin as unknown as (plugin: unknown, config?: unknown) => Promise<unknown>)(CommandRuntime)
    await settled()
    const entry: EntryPlugin = { name, inject: [...inject], apply }
    mount(ctx, entry)
    await vi.waitFor(() => expect(routes.has(EXTENSION_ROUTES.window)).toBe(true))
    // Startup may rewrite this file for its own reasons (config-seeded sources), so the
    // baseline is taken once the entry has settled: what must not change from here is the
    // global install switch itself.
    const stateBefore = await readFile(statePath)
    const installedEnabled = async (): Promise<unknown> => {
      const state = JSON.parse(await readFile(statePath, 'utf8')) as { installed?: Record<string, { enabled?: unknown }> }
      return state.installed?.['demo/v1-suite']?.enabled
    }
    expect(await installedEnabled()).toBe(false)

    const granted = await ctx.agentLoop.create(SessionId('global-off-granted'), { provider: 'mock', model: 'test' }, { cwd: home })
    const withheld = await ctx.agentLoop.create(SessionId('global-off-withheld'), { provider: 'mock', model: 'test' }, { cwd: home })
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
      const presetName = 'global-off-preset-' + presetSequence++
      const created = jsonResponse()
      await routes.get(EXTENSION_ROUTES.create)!(
        jsonRequest(EXTENSION_ROUTES.create, 'POST', {
          sessionId,
          expectedRevision: (await windowOf(sessionId)).library.revision,
          name: presetName,
          enabledIds
        }),
        created
      )
      await settled()
      expect(created.status(), JSON.stringify(created.value())).toBe(200)
      const preset = (await windowOf(sessionId)).library.presets.find(row => row.name === presetName)
      if (preset === undefined) throw new Error('extension preset was not created')
      const selected = jsonResponse()
      await routes.get(EXTENSION_ROUTES.select)!(
        jsonRequest(EXTENSION_ROUTES.select, 'POST', { sessionId, expectedRevision: (await windowOf(sessionId)).state.revision, presetId: preset.id }),
        selected
      )
      await settled()
      expect(selected.status(), JSON.stringify(selected.value())).toBe(200)
    }

    // The disabled suite is offered but not switched on: its row is selectable and its
    // global state is off, which is what makes the explicit grant below meaningful.
    const suiteRow = (await windowOf(granted.id)).resources.find(row => row.id === SUITE_ID)
    expect(suiteRow).toMatchObject({ available: true, globalEnabled: false })

    const signal = new AbortController().signal
    const names = async (agent: Agent) => (await ctx.skills.list({ cwd: home, signal, scope: agent })).map(summary => summary.name)
    const commands = (ctx as unknown as { commands: { list(agent: unknown): Array<{ name: string }> } }).commands

    // Nothing is auto-enabled: a fresh session captures no part of a disabled suite.
    expect(await names(granted)).not.toContain(SKILL)
    expect(commands.list(granted).map(row => row.name)).not.toContain(COMMAND)

    // The explicit preset names the suite and its two entries; MCP and LSP stay out.
    await applyPreset(granted.id, [SUITE_ID, entryId('skills', SKILL), entryId('commands', COMMAND)])
    await applyPreset(withheld.id, [])
    await settled()

    // The selecting session reads both the skill and the command.
    expect(await names(granted)).toContain(SKILL)
    await expect(ctx.skills.get(SKILL, { cwd: home, signal, scope: granted })).resolves.toBeDefined()
    expect(commands.list(granted).map(row => row.name)).toContain(COMMAND)

    // Its same-cwd sibling granted nothing and sees neither.
    expect(await names(withheld)).not.toContain(SKILL)
    await expect(ctx.skills.get(SKILL, { cwd: home, signal, scope: withheld })).resolves.toBeUndefined()
    expect(commands.list(withheld).map(row => row.name)).not.toContain(COMMAND)

    // A session selection is not a global switch: the suite is still globally off and the
    // install file is byte-identical to the settled baseline.
    expect(await installedEnabled()).toBe(false)
    expect(await readFile(statePath)).toEqual(stateBefore)
  })
})
