// @vitest-environment node

/**
 * What a child scope sees, and what a child session may use.
 *
 * Two questions, one host mechanism. The tool registry is scope-aware at this
 * host line: a registration made through an unscoped context is global, one
 * made through an agent's own context is that agent's, and a step admits its
 * tools through a ResolvedToolSet bound to the agent that prepared it. On top
 * of that sits the plugin's own per-agent gate, which denies the managed
 * capabilities an agent's selection does not name.
 *
 * The owner's symptom — the model says it cannot find MCP in a child while the
 * market panel still says connected — is the second question. A child session
 * has no panel of its own: nobody chooses its resources, so its selection must
 * follow the session that started it instead of inventing an answer of its own.
 *
 * Measured at 0.2.2-rc.2, where the host derives Team membership from the
 * subagent tree, so one child measures every delegation path:
 *
 * - there is ONE tool registry. An agent's `ctx.tools` differs from the root's
 *   only because Cordis hands each context a traceable wrapper of the same
 *   service; the registry state is the same object.
 * - an agent's scope chain has no parent link, so an agent inherits the
 *   global layer and nothing else.
 * - a root-registered tool is therefore visible and admitted by the Lead and by
 *   a plain subagent.
 * - a tool registered in an agent's own scope stays in that agent: a subagent
 *   does not inherit it.
 * - a child session inherits its parent's committed selection, so the child's
 *   gate answers exactly as the parent's does.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { scopeChainOf } from '@deepseek-ai/dsh-scope'
import { jsonlPersistencePlugin as Persistence } from './helpers/jsonl-persistence.js'
import { startContinuableChild } from '../src/runtime/agents/subagent-seam.js'
import { ExtensionRuntime } from '../src/runtime/host/extension-runtime.js'
import { attachExtensionToolGates, type ExtensionToolGates } from '../src/runtime/host/extension-tool-gates.js'
import type { ExtensionResource } from '../../market-contracts/src/contracts/extension-presets.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})

/** One managed MCP resource, and the tool the bridge registers for it. */
const RESOURCE = 'mcp:plugin:demo/suite/db'
const TOOL = 'demo_db_query'

/** A model that answers every turn immediately, and can hold one turn open. */
class QuietAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  /** Hold the next stream open, so an agent stays alive while the test measures it. */
  hold = false
  private releaseHeld?: () => void
  /** Release a held stream. */
  release(): void {
    this.releaseHeld?.()
    this.releaseHeld = undefined
  }
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.hold)
      await new Promise<void>(resolve => {
        this.releaseHeld = resolve
      })
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** The session query service, with the search half this file never uses. */
class Query extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
}

/** A probe tool, named by the caller so a registration's scope is readable. */
function probeTool(name: string) {
  return defineTool({
    name,
    description: 'probe',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    async execute() {
      return {}
    }
  })
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'market-root-tool-visibility-'))
  // The lead's cwd must exist before the agent is created: the host's
  // working-directory service rejects an agent whose directory is missing.
  await mkdir(join(root, 'lead'), { recursive: true })
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(Query)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Subagents)
  await ctx.plugin(Spawn)
  const adapter = new QuietAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = await ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'parent' }, { cwd: join(root, 'lead') })
  return { ctx, lead, root, adapter }
}

/** The names one agent's step would admit. */
async function admittedNames(ctx: Context, agent: Agent): Promise<string[]> {
  const toolSet = await ctx.tools.resolve({
    agent,
    modelSelection: { provider: 'mock', model: 'parent' },
    signal: new AbortController().signal
  })
  return [...toolSet.view(agent).keys()].sort()
}

/** The names one agent's scope can see. */
function visibleNames(ctx: Context, agent: Agent): string[] {
  return ctx.tools
    .definitions(agent)
    .map(definition => definition.name)
    .sort()
}

/**
 * Start one continuable child whose first turn is held open: a settled run has
 * disposed the child's scope, and a gate attached afterwards cannot be created
 * on it. The child stays mid-turn until `settle` releases it, so the gate
 * attaches to a live agent.
 */
async function startHeldSubagent(ctx: Context, parent: Agent, adapter: QuietAdapter): Promise<{ child: Agent; settle: () => Promise<void> }> {
  const ended = Promise.withResolvers<void>()
  let child: Agent | undefined
  const offCreated = ctx.on('agent/created', async ({ agent }) => {
    if (child === undefined) child = agent
  })
  const off = ctx.on('subagent/end', () => ended.resolve())
  adapter.hold = true
  void startContinuableChild(ctx.subagents, {
    provider: 'spawn',
    label: 'plain subagent',
    request: { parent, prompt: [{ type: 'text', text: 'Work on your own.' }] },
    signal: new AbortController().signal
  }).catch(() => {})
  await vi.waitFor(() => {
    if (child === undefined) throw new Error('the plain subagent was never published')
  })
  const settle = async (): Promise<void> => {
    adapter.hold = false
    adapter.release()
    await ended.promise
    off()
    offCreated()
  }
  return { child: child!, settle }
}

/** Start one continuable child and wait for the end of its first turn. */
async function startPlainSubagent(ctx: Context, parent: Agent): Promise<Agent> {
  const ended = Promise.withResolvers<void>()
  const created = new Map<string, Agent>()
  const offCreated = ctx.on('agent/created', async ({ agent }) => {
    created.set(agent.id, agent)
  })
  const off = ctx.on('subagent/end', () => ended.resolve())
  try {
    const started = await startContinuableChild(ctx.subagents, {
      provider: 'spawn',
      label: 'plain subagent',
      request: { parent, prompt: [{ type: 'text', text: 'Work on your own.' }] },
      signal: new AbortController().signal
    })
    await ended.promise
    const child = created.get(started.childId)
    if (child === undefined) throw new Error('the plain subagent was never published')
    return child
  } finally {
    off()
    offCreated()
  }
}

/**
 * The plugin's own runtime, over one managed MCP resource.
 *
 * The resource is available but its global default is off, which is the
 * contract's own case: a saved preset may select an available resource
 * independently of its global default. The person's choice and a default
 * capture therefore differ, which is what separates the Lead's session from a
 * session nobody chose anything for.
 */
async function setupRuntime(ctx: Context, root: string) {
  const rows: ExtensionResource[] = [
    {
      id: RESOURCE,
      face: 'mcp',
      name: 'db',
      source: 'demo',
      available: true,
      globalEnabled: false,
      detail: { kind: 'mcp', entryId: 'plugin:demo/suite/db' }
    }
  ]
  const gates = new Map<Agent, ExtensionToolGates>()
  const runtime = new ExtensionRuntime(ctx, {
    dataRoot: root,
    inventory: async () => rows,
    applySelection: async () => {},
    committed: agent => {
      gates.get(agent)?.refresh()
    }
  })
  cleanups.push(() => runtime.dispose())
  await runtime.start()
  const tool = defineTool({
    name: TOOL,
    description: 'query the demo database',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      return 'ok'
    }
  })
  ctx.tools.register(tool)
  /** Attach the plugin's own gate to one agent, over the runtime as policy. */
  const attach = (agent: Agent): ExtensionToolGates => {
    const gate = attachExtensionToolGates(
      agent,
      {
        mcpTools: () => [{ name: TOOL, definition: tool, scope: undefined, resourceId: RESOURCE }],
        lspProviders: () => [],
        ownsLspTool: () => false
      },
      runtime
    )
    cleanups.push(() => gate.dispose())
    gates.set(agent, gate)
    return gate
  }
  /** Grant the one resource the way a saved preset does. */
  const grant = async (target: Agent): Promise<void> => {
    const name = 'grant-' + String(target.id)
    const window = await runtime.window(target.id)
    await runtime.create(target.id, window.library.revision, { name, enabledIds: [RESOURCE] })
    const preset = (await runtime.window(target.id)).library.presets.find(row => row.name === name)
    if (preset === undefined) throw new Error('the preset was not created')
    await runtime.select(target.id, (await runtime.window(target.id)).state.revision, preset.id)
  }
  return { runtime, tool, attach, grant }
}

describe('the tool registry a child scope sees', () => {
  it('gives every agent one registry, and inherits only the global layer', async () => {
    const { ctx, lead } = await setup()
    // The plugin's MCP bridge registers through the root context.
    cleanups.push(ctx.tools.register(probeTool('probe_root_tool')))
    // A project mount registers in the agent's own scope.
    cleanups.push(lead.ctx.tools.register(probeTool('probe_lead_scope_tool')))

    const child = await startPlainSubagent(ctx, lead)

    // An agent's scope chain carries no parent link.
    expect(scopeChainOf(lead)).toHaveLength(1)
    expect(scopeChainOf(child)).toHaveLength(1)

    // A root registration is global: every scope sees it and admits it.
    expect(visibleNames(ctx, lead)).toContain('probe_root_tool')
    expect(await admittedNames(ctx, lead)).toContain('probe_root_tool')
    expect(visibleNames(ctx, child)).toContain('probe_root_tool')
    expect(await admittedNames(ctx, child)).toContain('probe_root_tool')

    // An agent-scope registration stays with that agent.
    expect(visibleNames(ctx, lead)).toContain('probe_lead_scope_tool')
    expect(visibleNames(ctx, child)).not.toContain('probe_lead_scope_tool')
  })
})

describe('the gate a child session answers with', () => {
  it('keeps the tools the parent session granted', async () => {
    const { ctx, lead, root, adapter } = await setup()
    const { runtime, tool, attach, grant } = await setupRuntime(ctx, root)
    await vi.waitFor(() => expect(runtime.state.status(lead).ready).toBe(true))
    await grant(lead)
    expect(runtime.allows(lead, RESOURCE)).toBe(true)
    attach(lead)
    expect(await admittedNames(ctx, lead)).toContain(tool.name)

    // The gate has to attach while the child is alive: a settled run has
    // disposed its scope, and a restriction on a dead scope measures nothing.
    const { child, settle } = await startHeldSubagent(ctx, lead, adapter)
    attach(child)
    await vi.waitFor(() => expect(runtime.state.status(child).ready).toBe(true))

    // The child's own selection is the parent's committed selection.
    expect(runtime.state.read(child)?.selection.enabledIds).toEqual(runtime.state.read(lead)?.selection.enabledIds)
    // So the child's gate answers exactly as the parent's does.
    expect(runtime.allows(child, RESOURCE)).toBe(true)
    expect(await admittedNames(ctx, child)).toContain(tool.name)
    await settle()
  })

  it("keeps the tool when the agent's own gate allows it", async () => {
    const { ctx, lead } = await setup()
    const tool = probeTool('probe_root_tool')
    cleanups.push(ctx.tools.register(tool))
    const gates = [
      attachExtensionToolGates(
        lead,
        {
          mcpTools: () => [{ name: tool.name, definition: tool, scope: undefined, resourceId: RESOURCE }],
          lspProviders: () => [],
          ownsLspTool: () => false
        },
        { ready: () => true, allows: () => true }
      )
    ]
    cleanups.push(() => {
      for (const gate of gates) gate.dispose()
    })
    expect(await admittedNames(ctx, lead)).toContain(tool.name)
  })
})
