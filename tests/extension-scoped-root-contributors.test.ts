/**
 * Suite skills are served per session, not from the root layer.
 *
 * Two sessions in one workspace may select opposite suites, so the suite
 * provider is registered on the agent's own scope and authorizes each call.
 * The registry selects layers from `options.scope`, which the host's own skill
 * tool passes as the calling agent; reading the agent's ctx alone would answer
 * from the root layer, so every lookup here names its scope explicitly.
 *
 * The first case drives that path through the real catalog and the real
 * registry. The second mounts the plugin entry itself and pins the root layer:
 * an installed suite must not be reachable by any session that never selected it.
 */
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service, type Fiber, type Plugin } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { SessionId } from '@deepseek-ai/dsh-session'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { Catalog } from '../src/application/catalog.js'
import { EXTENSION_ROUTES, captureExtensionSelection, type ExtensionSelection, type ExtensionWindowPayload } from '../src/contracts/extension-presets.js'
import { apply, inject, name } from '../src/index.js'
import { ScopedExtensionContributors } from '../src/runtime/host/scoped-contributors.js'
import { createUserPanelStores } from '../src/runtime/panels/user-panels.js'

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
/** The suite the sessions grant or withhold, installed the way a user installs one. */
const SKILL = 'greet'
const SUITE_ID = 'market:demo/v1-suite'
/** The panel's authoritative entry tuple, the id the inventory row carries too. */
const entryId = 'skills:' + JSON.stringify(['demo', 'v1-suite', 'skills', SKILL])
/** Install the fixture suite into one user root, through the real catalog or the entry's own state. */
async function installFixture(userRoot: string, catalog: Catalog): Promise<void> {
  await cp(join(fixtures, 'v1-suite'), join(userRoot, '.sources', 'demo'), { recursive: true })
  await catalog.mergeSources([{ id: 'demo', url: 'file:///demo' }])
  await catalog.install('demo', 'v1-suite')
}
/** Let the mounted plugin fibers activate: Cordis loads one on a later tick. */
const settled = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
function mount(ctx: Context, plugin: Plugin): Fiber {
  const fiber = ctx.plugin(plugin)
  cleanups.push(() => fiber.dispose())
  return fiber
}
/** The host command registry, keeping the definitions the mount registers. */
function fakeCommands() {
  class FakeCommands extends Service {
    constructor(ctx: Context) {
      super(ctx, 'commands')
    }
    register(): () => void {
      return () => {}
    }
  }
  return { Plugin: FakeCommands }
}
/** The host shell seam; this suite needs no command expansion, only the service seat. */
function fakeShell() {
  class FakeShell extends Service {
    constructor(ctx: Context) {
      super(ctx, 'shell')
    }
    resolve(request: unknown): unknown {
      return request
    }
    async run(): Promise<unknown> {
      return { exitCode: 0, timedOut: false, aborted: false, stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false } }
    }
  }
  return { Plugin: FakeShell }
}
type RouteHandler = (request: unknown, response: unknown) => void | Promise<void>
/** The host web server seat: records the exact routes the entry mounts. */
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
/** The loader seat the entry injects alongside the web server. */
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
  // The route reads a POST body as a stream, so the stub is one: a real Readable
  // carries both the async iteration and the event face an IncomingMessage has.
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
interface EntryPlugin {
  name: string
  inject: string[]
  apply(ctx: Context): unknown
}
async function put(dir: string, path: string, value: unknown): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), typeof value === 'string' ? value : JSON.stringify(value))
}

describe('suite skills are served per session, never from the root layer', () => {
  it('serves the granted session, denies its same-cwd sibling, and honors a single entry switch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scoped-root-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const userRoot = await mkdtemp(join(tmpdir(), 'scoped-root-user-'))
    cleanups.push(() => rm(userRoot, { recursive: true, force: true }))
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
    await catalog.load()
    await installFixture(catalog.userRoot, catalog)
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(Persistence, { root })
    await ctx.plugin(TestQuery)
    await ctx.plugin(AgentLoop, { agents: [] })
    // The scoped mount reaches for the same host seats production provides: the real
    // registry plus the sibling command and shell seats its fibers inject.
    mount(ctx, fakeCommands().Plugin)
    mount(ctx, fakeShell().Plugin)
    await ctx.plugin(SkillRegistry)
    const cwd = catalog.userRoot
    const selections = new Map<Agent, ExtensionSelection>()
    const contributors = new ScopedExtensionContributors({
      dataRoot: root,
      catalog,
      shell: () => undefined,
      // Production supplies the panel stores, which is what makes the scoped mount
      // declare its host seats as injected dependencies instead of reaching for them.
      panels: { commands: createUserPanelStores(join(root, 'agents')).commands },
      // The runtime's own answer, read on every provider call.
      allows: (agent, resourceId, suiteId) => {
        const selection = selections.get(agent)
        if (selection === undefined || !selection.enabledIds.includes(resourceId)) return false
        return suiteId === undefined || selection.enabledIds.includes(suiteId)
      }
    })
    const create = (id: string) => ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'test' }, { cwd })
    const granted = await create('granted-session')
    const withheld = await create('withheld-session')
    expect(granted.session.header.cwd).toBe(withheld.session.header.cwd)
    // The suite grant alone is not enough: the scoped provider authorizes the suite and each
    // entry separately, so a session that grants a skill holds both its suite id and its tuple.
    selections.set(granted, captureExtensionSelection(null, [SUITE_ID, entryId]))
    selections.set(withheld, captureExtensionSelection(null, []))
    await contributors.reconcile(granted, selections.get(granted)!)
    await contributors.reconcile(withheld, selections.get(withheld)!)
    const signal = new AbortController().signal
    const lookup = (agent: Agent) => ({ cwd, signal, scope: agent })
    const names = async (agent: Agent) => (await ctx.skills.list(lookup(agent))).map(summary => summary.name)
    // Nothing registers a suite provider on the root layer, so a scope-less read
    // must not answer with an extension resource any session could then load.
    expect((await ctx.skills.list({ cwd, signal })).map(summary => summary.name)).not.toContain(SKILL)
    // The session that granted the suite reads it from its own scope.
    expect(await names(granted)).toContain(SKILL)
    await expect(ctx.skills.get(SKILL, lookup(granted))).resolves.toBeDefined()
    // The sibling session in the same workspace granted nothing and must see none of it.
    expect(await names(withheld)).not.toContain(SKILL)
    await expect(ctx.skills.get(SKILL, lookup(withheld))).resolves.toBeUndefined()
    // A single entry switch inside a still-granted suite denies without re-registering.
    // The change is announced the way the runtime announces one — applySelection calls
    // reconcile — so nothing here depends on a map edit the host never hears about.
    selections.set(granted, captureExtensionSelection(null, [SUITE_ID]))
    await contributors.reconcile(granted, selections.get(granted)!)
    expect(await names(granted)).not.toContain(SKILL)
    await expect(ctx.skills.get(SKILL, lookup(granted))).resolves.toBeUndefined()
  })

  it('keeps an installed suite out of the root layer the plugin entry mounts', async () => {
    const home = await mkdtemp(join(tmpdir(), 'scoped-root-home-'))
    cleanups.push(() => rm(home, { recursive: true, force: true }))
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents'))
    const suiteRoot = join(home, 'agent-plugins', '.sources', 'demo', 'v1-suite')
    await cp(join(fixtures, 'v1-suite'), suiteRoot, { recursive: true })
    await put(home, 'agent-plugins/state.json', {
      version: 1,
      sources: [{ id: 'demo', url: 'file:///demo' }],
      installed: { 'demo/v1-suite': { enabled: true, installedAt: new Date(0).toISOString() } }
    })
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    mount(ctx, fakeShell().Plugin)
    mount(ctx, SkillRegistry)
    mount(ctx, fakeCommands().Plugin)
    await settled()
    const entry: EntryPlugin = { name, inject: [...inject], apply }
    mount(ctx, entry)
    await settled()
    const signal = new AbortController().signal
    // The entry serves the installed suite only to the session that selected it,
    // so no session can reach it through the root layer.
    expect((await ctx.skills.list({ cwd: home, signal })).map(summary => summary.name)).not.toContain(SKILL)
  })

  it('drives one session selection through the routes the entry mounts', async () => {
    const home = await mkdtemp(join(tmpdir(), 'scoped-root-http-'))
    cleanups.push(() => rm(home, { recursive: true, force: true }))
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'agents'))
    const suiteRoot = join(home, 'agent-plugins', '.sources', 'demo', 'v1-suite')
    await cp(join(fixtures, 'v1-suite'), suiteRoot, { recursive: true })
    await put(home, 'agent-plugins/state.json', {
      version: 1,
      sources: [{ id: 'demo', url: 'file:///demo' }],
      installed: { 'demo/v1-suite': { enabled: true, installedAt: new Date(0).toISOString() } }
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
    mount(ctx, fakeShell().Plugin)
    mount(ctx, SkillRegistry)
    mount(ctx, fakeCommands().Plugin)
    await settled()
    const entry: EntryPlugin = { name, inject: [...inject], apply }
    mount(ctx, entry)
    await vi.waitFor(() => expect(routes.has(EXTENSION_ROUTES.window)).toBe(true))
    const agent = await ctx.agentLoop.create(SessionId('http-session'), { provider: 'mock', model: 'test' }, { cwd: home })
    const signal = new AbortController().signal
    const lookup = { cwd: home, signal, scope: agent }
    const names = async () => (await ctx.skills.list(lookup)).map(summary => summary.name)
    const window = async (): Promise<ExtensionWindowPayload> => {
      const response = jsonResponse()
      await routes.get(EXTENSION_ROUTES.window)!(jsonRequest(EXTENSION_ROUTES.window + '?sessionId=' + agent.id, 'GET'), response)
      expect(response.status()).toBe(200)
      return response.value() as ExtensionWindowPayload
    }
    let presetSequence = 0
    /**
     * Grant exactly these ids through the public routes, the way the product does now:
     * create a named preset, then select it. The library revision and the session state
     * revision are separate counters, each read immediately before the call consuming it.
     */
    const applyPreset = async (enabledIds: string[]): Promise<void> => {
      const name = 'scoped-root-preset-' + presetSequence++
      const created = jsonResponse()
      await routes.get(EXTENSION_ROUTES.create)!(
        jsonRequest(EXTENSION_ROUTES.create, 'POST', {
          sessionId: agent.id,
          expectedRevision: (await window()).library.revision,
          name,
          enabledIds
        }),
        created
      )
      await settled()
      expect(created.status(), JSON.stringify(created.value())).toBe(200)
      const preset = (await window()).library.presets.find(row => row.name === name)
      if (preset === undefined) throw new Error('extension preset was not created')
      const selected = jsonResponse()
      await routes.get(EXTENSION_ROUTES.select)!(
        jsonRequest(EXTENSION_ROUTES.select, 'POST', { sessionId: agent.id, expectedRevision: (await window()).state.revision, presetId: preset.id }),
        selected
      )
      await settled()
      expect(selected.status(), JSON.stringify(selected.value())).toBe(200)
    }
    // A fresh session with no default preset captures every available resource, so
    // its own scope already serves the suite before any preset is selected.
    await vi.waitFor(async () => expect((await window()).state.revision).toBeGreaterThan(0))
    expect(await names()).toContain(SKILL)
    // The real route grants the suite and the skill together.
    await applyPreset([SUITE_ID, entryId])
    expect(await names()).toContain(SKILL)
    await expect(ctx.skills.get(SKILL, lookup)).resolves.toBeDefined()
    // Switching the single entry off through the same route must deny the next read.
    await applyPreset([SUITE_ID])
    expect(await names()).not.toContain(SKILL)
    await expect(ctx.skills.get(SKILL, lookup)).resolves.toBeUndefined()
  })
})
