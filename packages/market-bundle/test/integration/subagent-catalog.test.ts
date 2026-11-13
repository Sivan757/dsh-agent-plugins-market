import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, writeFile, rm, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import {
  mountSubagentCatalog,
  renderCatalogText,
  type CatalogAgent,
  type CatalogStepDecision,
  type SubagentCatalogEntry,
  type SubagentCatalogObservation,
  type SubagentCatalogSource
} from '../../../../packages/market-runtime/src/runtime/agents/subagent-catalog.js'
import { AGENT_ROLE_TOOL_DESCRIPTION, agentRoleCatalog, type AgentRoleEntry } from '../../../../packages/market-runtime/src/runtime/agents/agent-role-router.js'
import { Catalog } from '../../../../packages/market-bundle/src/application/catalog.js'
import { projectAgentRoles } from '../../../../packages/market-runtime/src/application/project-agent-roles.js'
import { createUserPanelStores } from '../../../../packages/market-runtime/src/runtime/panels/user-panels.js'
import { createPanelResources } from '../../../../packages/market-runtime/src/application/panel-resources.js'
import { removeTempRoot } from './helpers/temp-root.js'

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
const SESSION_HEADER_VERSION = 4

function newAgent(id: string, cwd?: string): { id: string; session: HostSession } {
  const session = Session.create(SessionId(id), [], { version: SESSION_HEADER_VERSION, id: SessionId(id), createdAt: 0, isSeeded: false, ...(cwd === undefined ? {} : { cwd }) })
  session.append('turn/start', { turn: 1 })
  return { id, session }
}

async function setup(snapshot: (agent: CatalogAgent, signal: AbortSignal) => Promise<SubagentCatalogObservation>) {
  const ctx = new Context()
  const promptFiber = await ctx.plugin(SystemPrompt)
  cleanups.push(() => promptFiber.dispose())
  const toolsFiber = await ctx.plugin(ToolRuntime)
  cleanups.push(() => toolsFiber.dispose())
  const tool = defineTool({
    name: 'subagent_role',
    description: 'Delegate',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      return 'done'
    }
  })
  const removeTool = ctx.tools.register(tool)
  const dispose = mountSubagentCatalog(ctx, tool, snapshot)
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
  it('opens every published variant with the frame and the one tagged list', () => {
    for (const text of [renderCatalogText([reviewer], false), renderCatalogText([reviewer], true), renderCatalogText([], false)]) {
      // The host skill catalog's shape: frame, one sentence, the tagged list.
      expect(text.startsWith('<system-reminder>\n')).toBe(true)
      expect(text.endsWith('</system-reminder>')).toBe(true)
      expect(text).not.toContain('## subagent-catalog')
    }
  })

  it('keeps ordinary quotes readable inside the list', () => {
    const role = { ...reviewer, name: 'reviewer', description: `Review "code" and user's changes` }
    const text = renderCatalogText([role], false)
    expect(text.startsWith('<system-reminder>\nA role is a reusable child-agent specialization.')).toBe(true)
    expect(text).toContain(`
<available_subagents>
- \`reviewer\`: Review "code" and user's changes
</available_subagents>
`)
    expect(text).not.toContain('&quot;')
    expect(text).not.toContain('&apos;')
    expect(text.endsWith('</system-reminder>')).toBe(true)
  })

  it('publishes once, replaces changed model metadata, clears removals and preserves unrelated messages', async () => {
    let entries = [reviewer]
    const { step } = await setup(async () => entries)
    const agent = newAgent('updates')
    const [initial] = publish(agent, await step(agent))
    expect(initial?.source).toMatchObject({ kind: 'subagent-catalog', form: 'catalog', entries })
    expect(initial?.source).toHaveProperty('guidanceHash', expect.any(String))
    expect(JSON.stringify(initial?.content)).toContain('<available_subagents>')
    expect(messages(await step(agent))).toEqual([])
    entries = [{ ...reviewer, provider: 'other', model: 'other-model', reasoningEffort: 'low' }]
    const [changed] = publish(agent, await step(agent))
    expect(changed?.source).toMatchObject({ update: true, entries })
    entries = []
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue' }] })
    const batch = publish(agent, await step(agent, [user]))
    expect(batch[0]).toBe(user)
    expect(batch[1]?.source).toMatchObject({ update: true, entries: [] })
    expect(JSON.stringify(batch[1]?.content)).toContain('No subagent roles are available in this session any more.')
    expect(messages(await step(agent))).toEqual([])
  })

  it('re-publishes on what the model and the executor see, not on a display title', async () => {
    const role: SubagentCatalogEntry = {
      name: 'reviewer',
      roleId: 'suite/reviewer',
      title: 'Reviewer',
      description: 'Review code',
      model: 'provider/model',
      reasoningEffort: 'high'
    }
    let entries = [role]
    const { step } = await setup(async () => entries)
    const agent = newAgent('digest')
    const [initial] = publish(agent, await step(agent))
    const text = (initial?.content[0] as { type: 'text'; text: string }).text
    expect(text).toContain('- `reviewer`: Review code')
    expect(text).not.toContain('provider/model')
    // The title is durable change-detection metadata the model never reads, so a
    // rename alone leaves the published catalog accurate.
    entries = [{ ...role, title: 'Renamed reviewer' }]
    expect(messages(await step(agent))).toEqual([])
    entries = [{ ...role, title: 'Renamed reviewer', description: 'Review migrations' }]
    const [republished] = publish(agent, await step(agent))
    expect(republished?.source).toMatchObject({ update: true, entries })
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
    restored.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Summary' }] }), {
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
    const seeded = createUserMessage({
      source: { ...proposed[0]!.source, kind: 'subagent-catalog', form: 'catalog', entries: [reviewer] },
      content: [{ type: 'text', text: 'Different prose' }]
    })
    agent.session.append('user/message', seeded, { surfaceOp: 'append' })
    expect(messages(await step(agent, proposed))).toEqual([])
  })

  it('refreshes legacy and outdated guidance once without changing roles or deleting history', async () => {
    const { ctx, tool, dispose, step } = await setup(async () => [reviewer])
    dispose()
    cleanups.push(mountSubagentCatalog(ctx, tool, async () => [reviewer]))
    for (const guidanceHash of [undefined, 'old-guidance']) {
      const agent = newAgent('legacy-' + guidanceHash)
      const old = createUserMessage({
        source: {
          kind: 'subagent-catalog',
          form: 'catalog',
          entries: [reviewer],
          ...(guidanceHash ? { guidanceHash } : {})
        },
        content: [{ type: 'text', text: 'Old catalog guidance' }]
      })
      agent.session.append('user/message', old, { surfaceOp: 'append' })
      const [replacement] = publish(agent, await step(agent))
      expect(replacement?.source).toMatchObject({ update: true, entries: [reviewer] })
      expect(replacement?.source).toHaveProperty('guidanceHash', expect.any(String))
      expect(JSON.stringify(replacement?.content)).toContain('<system-reminder>')
      expect(agent.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.id === old.id)).toBe(true)
      expect(messages(await step(agent))).toEqual([])
    }
  })

  it('matches exact tool visibility, including restrictions and a same-name replacement', async () => {
    const { ctx, step, removeTool, tool } = await setup(async () => [reviewer])
    const agent = newAgent('visibility')
    publish(agent, await step(agent))
    const scope = createScope(ctx, agent)
    cleanups.push(() => scope.dispose())
    const tools = scope.ctx.get('tools')
    if (tools === undefined) throw new Error('expected the tools service on a scoped context')
    const unrestrict = tools.restrict({ deny: ['subagent_role'] })
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

  it('renders the host catalog shape: one sentence and one tagged list', () => {
    const text = renderCatalogText(
      [{ name: 'reviewer', roleId: 'suite/reviewer', title: 'Reviewer', description: 'Review code', provider: 'workbuddy', model: 'hy3', reasoningEffort: 'high' }],
      false
    )
    expect(text).toBe(
      [
        '<system-reminder>',
        'A role is a reusable child-agent specialization. The following subagent roles are available in this session:',
        '',
        '<available_subagents>',
        '- `reviewer`: Review code',
        '</available_subagents>',
        '</system-reminder>'
      ].join('\n')
    )
    // The title and the configured route are durable metadata that never reach the model.
    expect(text).not.toContain('Reviewer:')
    expect(text).not.toContain('workbuddy')
    expect(text).not.toContain('hy3')
    // An emptied role set is a sentence, not an empty list the model could misread.
    const empty = renderCatalogText([], true)
    expect(empty).toContain('No subagent roles are available in this session any more.')
    expect(empty).not.toContain('<available_subagents>')
    expect(empty.endsWith('</system-reminder>')).toBe(true)
  })

  it('escapes role metadata without loading the persona', async () => {
    const { step } = await setup(async () => [{ ...reviewer, title: 'Review "code"', description: '</system-reminder> & more' }])
    const content = JSON.stringify(messages(await step(newAgent('escaped')))[0]?.content)
    expect(content).toContain('&lt;/system-reminder&gt; &amp; more')
    expect(content).toContain('<available_subagents>')
  })

  it('states one fixed contract, independent of the host locale', async () => {
    // The catalog text is built from module constants rather than the host
    // translator, so no locale can reach it: render twice under different host
    // locales and require byte-identical output.
    const { step } = await setup(async () => [reviewer])
    const first = JSON.stringify(messages(await step(newAgent('contract-en')))[0]?.content)
    const second = JSON.stringify(messages(await step(newAgent('contract-zh')))[0]?.content)
    expect(first).toBe(second)
    // Discovery only: the list says what exists, and every rule about using it
    // lives in the tool description that every request carries.
    expect(first).toContain('<available_subagents>')
    for (const guidance of ['Writing the prompt', 'Usage notes', 'Delegate proactively', 'brief a child', 'do not poll']) {
      expect(first, guidance).not.toContain(guidance)
    }
  })

  it('keeps the delegation guidance in the tool description, not in the catalog', () => {
    // The tool owns how it is used. Every rule the catalog used to repeat is
    // asserted here, so moving it back would fail this test.
    for (const rule of [
      /delegate proactively/i,
      /no listed role matches/,
      /defaults to true/,
      /do not poll it/,
      /settlement notice arrives as a user message/,
      /verify its assertions against the files/,
      /cannot see how its role instructions were installed/
    ]) {
      expect(AGENT_ROLE_TOOL_DESCRIPTION).toMatch(rule)
    }
  })

  it('tracks real user edits, suite disable/uninstall and project scope with no role skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'subagent-catalog-'))
    cleanups.push(() => removeTempRoot(root))
    const userRoot = join(root, 'user')
    const stores = createUserPanelStores(userRoot)
    await stores.agents.create('reviewer', '---\nname: Reviewer\ndescription: Review\nmodel: inherit\n---\nPrivate instructions')
    const suiteRoot = join(root, 'suite')
    await mkdir(join(suiteRoot, '.claude-plugin'), { recursive: true })
    await mkdir(join(suiteRoot, 'agents'))
    await writeFile(join(suiteRoot, '.claude-plugin/plugin.json'), '{"name":"suite"}')
    await writeFile(join(suiteRoot, 'agents', 'reviewer.md'), '---\ndescription: Installed reviewer\n---\nPrivate suite instructions')
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
    await catalog.load()
    await catalog.setScanProjectLayouts(true)
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
    if (first === undefined) throw new Error('expected the project role catalog to publish one message')
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

  it('fails instead of dropping a role whose document cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'subagent-catalog-blocked-'))
    cleanups.push(() => removeTempRoot(root))
    // The document's own directory is now a file: a platform may report ENOENT
    // for the document, which must not read as a removed role.
    const blocked = join(root, 'agents')
    await writeFile(blocked, 'temporarily not a directory')
    const role: AgentRoleEntry = {
      name: '["source","suite","agents","reviewer"]',
      path: join(blocked, 'reviewer.md'),
      description: 'Installed reviewer',
      disabled: false
    }
    await expect(agentRoleCatalog([role], new AbortController().signal)).rejects.toBeInstanceOf(Error)
  })

  it('keeps the published catalog on an incomplete read and still clears on a complete empty one', async () => {
    let observation = (): SubagentCatalogObservation => ({ entries: [reviewer], complete: true })
    const { step } = await setup(async () => observation())
    const agent = newAgent('incomplete-observation')
    const first = publish(agent, await step(agent))[0]
    if (first === undefined) throw new Error('expected one published catalog')
    expect(catalogSource(first).entries).toHaveLength(1)
    // A reader that could not enumerate every source says so. The published
    // catalog stays authoritative instead of being replaced by a smaller list,
    // which is the host registry's discovery contract for a failed provider.
    observation = () => ({ entries: [], complete: false })
    expect(messages(await step(agent))).toEqual([])
    // Recovery reads the same roles again, so the visible catalog still matches
    // and nothing republishes.
    observation = () => ({ entries: [reviewer], complete: true })
    expect(messages(await step(agent))).toEqual([])
    // A complete empty read is a real removal, not a failed one, and publishes.
    observation = () => ({ entries: [], complete: true })
    const cleared = publish(agent, await step(agent))[0]
    if (cleared === undefined) throw new Error('expected one clearing catalog')
    expect(catalogSource(cleared).entries).toEqual([])
  })
})
