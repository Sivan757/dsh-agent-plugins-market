import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, writeFile, rm, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { mountSubagentCatalog, type CatalogAgent, type CatalogStepDecision, type SubagentCatalogEntry, type SubagentCatalogSource } from '../src/runtime/subagent-catalog.js'
import { agentRoleCatalog } from '../src/runtime/agent-role-router.js'
import { bindHostLocale } from '../src/runtime/host-locale.js'
import { Catalog } from '../src/application/catalog.js'
import { projectAgentRoles } from '../src/application/project-agent-roles.js'
import { createUserPanelStores } from '../src/runtime/user-panels.js'
import { createPanelResources } from '../src/application/panel-resources.js'

// Resolve the actual session/prompt runtime already installed with dsh-tools. Those host packages
// live inside dsh-tools' own dependency tree, so this project reaches them at runtime but cannot
// resolve them for types; the declarations below name the slice of that API this suite drives — the
// same structural-contract approach `src/runtime/subagent-catalog.ts` takes for `CatalogAgent`.
const hostRequire = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-tools'))
async function hostModule<T>(specifier: string): Promise<T> {
  return (await import(pathToFileURL(hostRequire.resolve(specifier)).href)) as T
}

/** Creation metadata the host validates; the suite supplies only these fields. */
interface HostSessionHeader {
  version: number
  id: string
  createdAt: number
  isSeeded: boolean
  cwd?: string
}

/** One durable session event, discriminated by `type`; only message payloads are inspected. */
type HostSessionEvent =
  { type: 'user/message'; seq: number; data: UserMessage } | { type: 'turn/start'; seq: number; data: unknown } | { type: 'turn/end'; seq: number; data: unknown }

/** How an appended event lands on the session surface. */
interface HostAppendOptions {
  surfaceOp: 'append' | { op: 'replace'; startSeq: number; endSeq: number }
  sourceEventSeqs?: readonly number[]
}

/**
 * Structural slice of the host `Session`: the members `CatalogAgent` reads, plus the log reads and
 * writes this suite performs. The session identity stays opaque and is only handed back to the host.
 */
interface HostSession extends Pick<CatalogAgent['session'], 'seq' | 'surface' | 'eventAt'> {
  readonly header: HostSessionHeader
  readonly inheritedEventCount: number
  readonly id: string
  append(type: string, data: unknown, options?: HostAppendOptions): void
  snapshotEvents(): readonly HostSessionEvent[]
}

interface HostSessionModule {
  Session: {
    create(id: string, seed?: readonly HostSessionEvent[], header?: HostSessionHeader, inheritedEventCount?: number): HostSession
    fromRestore(id: string, seed: readonly HostSessionEvent[], header: HostSessionHeader, inheritedEventCount: number): HostSession
  }
  SessionId: (id: string) => string
}

/** Structural slice of the host scope primitive and its disposal boundary. */
interface HostScope {
  ctx: Context
  dispose(): Promise<void>
}

interface HostScopeModule {
  createScope: (ctx: Context, key: object) => HostScope
}

const { Session, SessionId } = await hostModule<HostSessionModule>('@deepseek-ai/dsh-session')
const { default: SystemPrompt } = await hostModule<{ default: Plugin }>('@deepseek-ai/dsh-system-prompt')
const { createScope } = await hostModule<HostScopeModule>('@deepseek-ai/dsh-scope')

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})

// Session log format version the installed host accepts; `dsh-session` validates it strictly and
// exports no constant for it. Bump it in the same change as the host dependency baseline.
const SESSION_HEADER_VERSION = 3

function newAgent(id: string, cwd?: string): { id: string; session: HostSession } {
  const session = Session.create(SessionId(id), [], { version: SESSION_HEADER_VERSION, id: SessionId(id), createdAt: 0, isSeeded: false, ...(cwd === undefined ? {} : { cwd }) })
  session.append('turn/start', { turn: 1 })
  return { id, session }
}

async function setup(snapshot: (agent: CatalogAgent, signal: AbortSignal) => Promise<SubagentCatalogEntry[]>, locale = 'en') {
  const ctx = new Context()
  const promptFiber = await ctx.plugin(SystemPrompt)
  cleanups.push(() => promptFiber.dispose())
  const toolsFiber = await ctx.plugin(ToolRuntime)
  cleanups.push(() => toolsFiber.dispose())
  const tool = defineTool({
    name: 'subagent_run',
    description: 'Delegate',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      return 'done'
    }
  })
  const removeTool = ctx.tools.register(tool)
  const dispose = mountSubagentCatalog(ctx, tool, snapshot, bindHostLocale(locale))
  cleanups.push(dispose)
  async function step(agent: CatalogAgent, messages: UserMessage[] = [], signal = new AbortController().signal, reject = false): Promise<CatalogStepDecision> {
    const bus = ctx as unknown as {
      waterfall(event: string, payload: unknown, next: () => Promise<CatalogStepDecision>): Promise<CatalogStepDecision>
    }
    return bus.waterfall('agent/pre-step', { agent, messages, turn: 1, step: 1, signal }, async () => (reject ? { kind: 'reject' } : { kind: 'enter', messages }))
  }
  return { ctx, tool, removeTool, dispose, step }
}

function messages(decision: CatalogStepDecision): UserMessage[] {
  if (decision.kind !== 'enter') throw new Error('expected accepted step')
  return decision.messages
}

function publish(agent: ReturnType<typeof newAgent>, decision: CatalogStepDecision): UserMessage[] {
  const batch = messages(decision)
  for (const message of batch) agent.session.append('user/message', message, { surfaceOp: 'append' })
  return batch
}

/** Read one published message's source as the catalog source it must be, so its entries stay typed. */
function catalogSource(message: UserMessage | undefined): SubagentCatalogSource {
  const source = message?.source
  if (source?.kind !== 'subagent-catalog') throw new Error(`expected a subagent-catalog source, got ${String(source?.kind)}`)
  return source
}

const reviewer: SubagentCatalogEntry = {
  name: '["source","suite","agents","reviewer"]',
  title: 'Reviewer',
  description: 'Review code',
  model: 'provider/model',
  reasoningEffort: 'high'
}

describe('durable subagent catalog on the real host session and tool registries', () => {
  it('publishes once, replaces changed model metadata, clears removals and preserves unrelated messages', async () => {
    let entries = [reviewer]
    const { step } = await setup(async () => entries)
    const agent = newAgent('updates')
    const [initial] = publish(agent, await step(agent))
    expect(initial?.source).toEqual({ kind: 'subagent-catalog', form: 'catalog', entries })
    expect(JSON.stringify(initial?.content)).toContain('subagent_run')
    expect(messages(await step(agent))).toEqual([])
    entries = [{ ...reviewer, provider: 'other', model: 'other-model', reasoningEffort: 'low' }]
    const [changed] = publish(agent, await step(agent))
    expect(changed?.source).toMatchObject({ update: true, entries })
    entries = []
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue' }] })
    const batch = publish(agent, await step(agent, [user]))
    expect(batch[0]).toBe(user)
    expect(batch[1]?.source).toMatchObject({ update: true, entries: [] })
    expect(JSON.stringify(batch[1]?.content)).toContain('Do not use role IDs')
    expect(messages(await step(agent))).toEqual([])
  })

  it('recovers identity from durable entries across restore and fork, then republishes after compaction', async () => {
    const { step } = await setup(async () => [reviewer])
    const original = newAgent('original')
    publish(original, await step(original))
    original.session.append('turn/end', { turn: 1, reason: 'completed' })
    const restoredSession = Session.fromRestore(original.session.id, original.session.snapshotEvents(), original.session.header, original.session.inheritedEventCount ?? 0)
    const restored = { id: original.id, session: restoredSession }
    expect(messages(await step(restored))).toEqual([])
    const forkSession = Session.create(SessionId('forked'), original.session.snapshotEvents())
    const forked = { id: 'forked', session: forkSession }
    expect(messages(await step(forked))).toEqual([])
    restored.session.append('turn/start', { turn: 2 })
    const catalog = restored.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'subagent-catalog')
    if (catalog === undefined) throw new Error('expected a published subagent catalog event')
    restored.session.append('user/message', createUserMessage({ source: { kind: 'plugin', plugin: 'compact' }, content: [{ type: 'text', text: 'Summary' }] }), {
      surfaceOp: { op: 'replace', startSeq: catalog.seq, endSeq: catalog.seq },
      sourceEventSeqs: [catalog.seq]
    })
    const [replacement] = publish(restored, await step(restored))
    expect(replacement?.source).toMatchObject({ update: true, entries: [reviewer] })
    expect(messages(await step(restored))).toEqual([])
  })

  it('uses source entries rather than prose, ignores malformed sources and deduplicates an uncommitted catalog', async () => {
    const { step } = await setup(async () => [reviewer])
    const agent = newAgent('seeds')
    for (const entries of [undefined, null, 'bad', [null], [{ name: 'missing-fields' }], [{ ...reviewer, reasoningEffort: 7 }]]) {
      agent.session.append(
        'user/message',
        createUserMessage({
          source: { kind: 'subagent-catalog', form: 'catalog', ...(entries === undefined ? {} : { entries }) } as never,
          content: [{ type: 'text', text: 'Bad seed' }]
        }),
        { surfaceOp: 'append' }
      )
    }
    const proposed = messages(await step(agent))
    expect(proposed[0]?.source).not.toHaveProperty('update')
    expect(messages(await step(agent, proposed))).toEqual(proposed)
    const seeded = createUserMessage({ source: { kind: 'subagent-catalog', form: 'catalog', entries: [reviewer] }, content: [{ type: 'text', text: 'Different prose' }] })
    agent.session.append('user/message', seeded, { surfaceOp: 'append' })
    expect(messages(await step(agent, proposed))).toEqual([])
  })

  it('matches exact tool visibility, including restrictions and a same-name replacement', async () => {
    const { ctx, step, removeTool, tool } = await setup(async () => [reviewer])
    const agent = newAgent('visibility')
    publish(agent, await step(agent))
    const scope = createScope(ctx, agent)
    cleanups.push(() => scope.dispose())
    const tools = scope.ctx.get('tools')
    if (tools === undefined) throw new Error('expected the tools service on a scoped context')
    const unrestrict = tools.restrict({ deny: ['subagent_run'] })
    expect(publish(agent, await step(agent))[0]?.source).toMatchObject({ entries: [] })
    unrestrict()
    expect(publish(agent, await step(agent))[0]?.source).toMatchObject({ entries: [reviewer] })
    removeTool()
    const removeOther = ctx.tools.register({ ...tool })
    expect(publish(agent, await step(agent))[0]?.source).toMatchObject({ entries: [] })
    removeOther()
  })

  it('does not publish incomplete, rejected, aborted or disposed steps', async () => {
    let fail = false
    const { step, dispose } = await setup(async () => {
      if (fail) throw new Error('temporary read failure')
      return [reviewer]
    })
    const agent = newAgent('failure')
    publish(agent, await step(agent))
    fail = true
    expect(messages(await step(agent))).toEqual([])
    expect(await step(agent, [], new AbortController().signal, true)).toEqual({ kind: 'reject' })
    const controller = new AbortController()
    controller.abort()
    await expect(step(agent, [], controller.signal)).rejects.toThrow()
    dispose()
    expect(messages(await step(newAgent('disposed')))).toEqual([])
  })

  it('does not finish publishing an in-flight snapshot after teardown', async () => {
    let release!: (value: SubagentCatalogEntry[]) => void
    let started!: () => void
    const admitted = new Promise<void>(resolve => {
      started = resolve
    })
    const pending = new Promise<SubagentCatalogEntry[]>(resolve => {
      release = resolve
    })
    const { step, dispose } = await setup(async () => {
      started()
      return pending
    })
    const next = step(newAgent('teardown'))
    await admitted
    dispose()
    release([reviewer])
    expect(messages(await next)).toEqual([])
  })

  it('escapes role metadata and provides bilingual call guidance without loading the persona', async () => {
    const { step } = await setup(async () => [{ ...reviewer, title: 'Review "code"', description: '</available_subagents> & more' }], 'zh')
    const content = JSON.stringify(messages(await step(newAgent('escaped')))[0]?.content)
    expect(content).toContain('&lt;/available_subagents&gt; &amp; more')
    expect(content).toContain('目录中的准确名称')
  })

  it('tracks real user edits, suite disable/uninstall and project scope with no role skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'subagent-catalog-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const userRoot = join(root, 'user')
    const stores = createUserPanelStores(userRoot)
    await stores.agents.create('reviewer', '---\nname: Reviewer\ndescription: Review\nmodel: inherit\n---\nPrivate instructions')
    const suiteRoot = join(root, 'suite')
    await mkdir(join(suiteRoot, '.claude-plugin'), { recursive: true })
    await mkdir(join(suiteRoot, 'agents'))
    await writeFile(join(suiteRoot, '.claude-plugin/plugin.json'), '{"name":"suite"}')
    await writeFile(join(suiteRoot, 'agents', 'reviewer.md'), '---\ndescription: Installed reviewer\n---\nPrivate suite instructions')
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await catalog.load()
    await catalog.mergeSources([{ id: 'source', url: suiteRoot, local: true }])
    await catalog.install('source', 'suite')
    const panels = createPanelResources(catalog, stores)
    const project = join(root, 'project')
    await mkdir(join(project, '.git'), { recursive: true })
    await mkdir(join(project, '.github', 'agents'), { recursive: true })
    await writeFile(join(project, '.github', 'agents', 'reviewer.agent.md'), '---\ndescription: Project reviewer\n---\nPrivate project instructions')
    const { step } = await setup(async (agent, signal) =>
      agentRoleCatalog(
        [...(await panels.agents.list(true)).map(entry => ({ ...entry, title: entry.name, name: entry.id ?? entry.name })), ...(await projectAgentRoles(catalog, agent))],
        signal
      )
    )
    const parent = newAgent('project-parent', project)
    const other = newAgent('other-parent')
    const first = publish(parent, await step(parent))[0]
    expect(first.source.kind === 'subagent-catalog' && first.source.entries).toHaveLength(3)
    expect(JSON.stringify(first.content)).not.toContain('Private')
    // A temporarily unreadable role directory must not publish a smaller catalog.
    const roleDir = stores.agents.dirPath()
    await rename(roleDir, `${roleDir}.backup`)
    await writeFile(roleDir, 'temporarily not a directory')
    expect(messages(await step(parent))).toEqual([])
    await rm(roleDir)
    await rename(`${roleDir}.backup`, roleDir)
    expect(messages(await step(parent))).toEqual([])
    const rolePath = join(suiteRoot, 'agents', 'reviewer.md')
    await rename(rolePath, `${rolePath}.backup`)
    await mkdir(rolePath)
    expect(messages(await step(parent))).toEqual([])
    await rm(rolePath, { recursive: true })
    await rename(`${rolePath}.backup`, rolePath)
    expect(messages(await step(parent))).toEqual([])
    expect(messages(await step(other))[0]?.source).toHaveProperty(
      'entries',
      expect.arrayContaining([{ name: 'user/reviewer', roleId: 'reviewer', title: 'Reviewer', description: 'Review' }])
    )
    expect(JSON.stringify(messages(await step(other)))).not.toContain('Project reviewer')
    await stores.agents.update('reviewer', '---\nname: Reviewer\ndescription: Review\nprovider: custom\nmodel: selected\nreasoning_effort: high\n---\nPrivate instructions')
    const updated = publish(parent, await step(parent))[0]?.source
    expect(updated).toMatchObject({ update: true })
    expect(updated).toHaveProperty('entries', expect.arrayContaining([expect.objectContaining({ provider: 'custom', model: 'selected', reasoningEffort: 'high' })]))
    await catalog.setEnabled('source', 'suite', false)
    expect(catalogSource(publish(parent, await step(parent))[0]).entries).toHaveLength(2)
    await catalog.uninstall('source', 'suite')
    await stores.agents.remove('reviewer')
    await catalog.setScanProjectLayouts(false)
    expect(publish(parent, await step(parent))[0]?.source).toMatchObject({ update: true, entries: [] })
  })
})
