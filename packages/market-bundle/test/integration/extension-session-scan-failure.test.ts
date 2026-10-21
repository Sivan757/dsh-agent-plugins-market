/**
 * One terminal plugin-side failure degrades the session instead of hanging it.
 *
 * The reporter's symptom: a workspace session whose catalog scan throws (the
 * packaged artifact shipped no schemas, so reading a suite's declarations died
 * with ENOENT) never starts, on create or on resume. The capture, or the replay
 * of a committed selection, records the error and marks the agent unavailable;
 * the pre-step handler then refused to enter a step, so the host ended every turn
 * as blocked with the request parked in the inbox. Nothing retries that failure
 * on its own, so the wait had no end.
 *
 * These cases drive the real loop with a recording adapter: the turn must reach
 * the model with every managed resource denied, the failure must stay visible,
 * and the terminal failure must not be retried per turn.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { jsonlPersistencePlugin as Persistence } from './helpers/jsonl-persistence.js'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { captureExtensionSelection } from '../../../../packages/market-contracts/src/contracts/extension-presets.js'
import { ExtensionRuntime } from '../../../../packages/market-runtime/src/runtime/host/extension-runtime.js'
import { attachExtensionToolGates, type ExtensionToolGates } from '../../../../packages/market-runtime/src/runtime/host/extension-tool-gates.js'
import type { ExtensionResource } from '../../../../packages/market-contracts/src/contracts/extension-presets.js'

class Query extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
}
class RecordingAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const ownedId = 'mcp:plugin:source/suite/db'
const ownedRow: ExtensionResource = { id: ownedId, face: 'mcp', name: 'db', source: 'source', available: true, detail: { kind: 'mcp', entryId: 'plugin:source/suite/db' } }
const userMessage = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
/** The packaged artifact's failure: one missing file while reading suite declarations. */
const scanFailure = (): Error => Object.assign(new Error("ENOENT: no such file or directory, open 'plugin.schema.json'"), { code: 'ENOENT' })
/** The turn a completed step ends in, so a wrong outcome reads as the blocked reason. */
const lastTurnEnd = (agent: Agent) =>
  agent.session
    .snapshotEvents()
    .filter(event => event.type === 'turn/end')
    .at(-1)?.data

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'extension-scan-failure-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(Query)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  // The scan and the apply work until a case turns one off, which is how a
  // catalog that used to be readable starts failing between a commit and a resume.
  let scanFailing = false
  let applyFailing = false
  const inventory = vi.fn(async (): Promise<ExtensionResource[]> => {
    if (scanFailing) throw scanFailure()
    return [ownedRow]
  })
  const runtime = new ExtensionRuntime(ctx, {
    dataRoot: root,
    inventory,
    applySelection: async () => {
      if (applyFailing) throw new Error('apply failed')
    },
    committed: () => {}
  })
  cleanups.push(() => runtime.dispose())
  await runtime.start()
  const create = (id: string) => ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: root }, agentOptions: { provider: 'mock', model: 'test' } })
  return {
    root,
    ctx,
    runtime,
    adapter,
    inventory,
    warn,
    create,
    failScan: () => {
      scanFailing = true
    },
    healScan: () => {
      scanFailing = false
    },
    failApply: (value: boolean) => {
      applyFailing = value
    },
    scans: () => inventory.mock.calls.length
  }
}
/** One managed tool whose row the failed scan would have published. */
async function attachOwnedTool(ctx: Context, runtime: ExtensionRuntime, agent: Agent): Promise<ExtensionToolGates> {
  const definition = defineTool({
    name: 'owned_query',
    description: 'query',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      return 'ok'
    }
  })
  ctx.tools.register(definition)
  let gate: ExtensionToolGates | undefined
  await agent.ctx.inject(['tools'], () => {
    gate = attachExtensionToolGates(
      agent,
      { mcpTools: () => [{ name: definition.name, definition, scope: undefined, resourceId: ownedId }], lspProviders: () => [], ownsLspTool: () => false },
      runtime
    )
  })
  cleanups.push(async () => gate?.dispose())
  return gate!
}
/** Shared assertions for a step that ran degraded: no grant, error visible, one warn line. */
function expectDegraded(ctx: Context, runtime: ExtensionRuntime, adapter: RecordingAdapter, agent: Agent, warn: ReturnType<typeof vi.spyOn>, text: string): void {
  expect(lastTurnEnd(agent)).toMatchObject({ reason: { kind: 'completed' } })
  expect([...agent.inbox.nextStep, ...agent.inbox.nextTurn]).toEqual([])
  expect(adapter.requests).toHaveLength(1)
  expect(JSON.stringify(adapter.requests[0]?.messages)).toContain(text)
  expect(runtime.state.status(agent)).toMatchObject({ ready: false, error: 'ENOENT' })
  expect(() => runtime.state.read(agent)).toThrow('extension-session-not-ready')
  expect(runtime.allows(agent, ownedId)).toBe(false)
  expect(ctx.tools.schemas(agent).map(tool => tool.name)).not.toContain('owned_query')
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('ENOENT'))
}

it('runs the turn degraded instead of blocking it forever when the scan fails during create', async () => {
  const f = await setup()
  f.failScan()
  const { agent } = await f.create('scan-failure-create')
  await attachOwnedTool(f.ctx, f.runtime, agent)
  // The capture failed before recording anything: not ready, error visible, and
  // the terminal failure is not retried on its own.
  expect(f.runtime.state.status(agent)).toMatchObject({ ready: false, error: 'ENOENT', revision: 0 })
  const scansAfterCreate = f.scans()
  await agent.whenIdle()
  expect(f.scans()).toBe(scansAfterCreate)

  agent.followup(userMessage('Review the diff.'))
  await agent.whenIdle()
  expectDegraded(f.ctx, f.runtime, f.adapter, agent, f.warn, 'Review the diff.')

  // A later request runs degraded too; the terminal failure is never re-scanned.
  agent.followup(userMessage('Second request.'))
  await agent.whenIdle()
  expect(f.adapter.requests).toHaveLength(2)
  expect(f.scans()).toBe(scansAfterCreate)
  expect(f.warn).toHaveBeenCalledTimes(1)
})

it('runs the turn degraded instead of blocking it forever when the scan fails on resume', async () => {
  const f = await setup()
  const first = await f.create('scan-failure-resume')
  // The session commits a selection while the scan works, which is the durable
  // record a later resume replays instead of capturing.
  expect(first.agent.session.snapshotEvents().some(event => event.type === 'agent/inbox/spliced')).toBe(true)
  expect(f.runtime.state.status(first.agent)).toMatchObject({ ready: true, revision: 1 })
  await first.agent.whenIdle()
  const scansBefore = f.scans()
  await first.dispose()
  // The catalog breaks between the commit and the resume, so replaying the
  // committed selection throws inside the apply instead of the capture.
  f.failScan()
  const resumed = (await f.ctx.agents.resume({ resumeSessionId: SessionId('scan-failure-resume'), agentOptions: { provider: 'mock', model: 'test' } })).agent
  await attachOwnedTool(f.ctx, f.runtime, resumed)
  expect(f.runtime.state.status(resumed)).toMatchObject({ ready: false, error: 'ENOENT' })
  // Exactly one scan: the resume re-reads the catalog once, and nothing retries it.
  expect(f.scans() - scansBefore).toBe(1)

  resumed.followup(userMessage('Turn after resume.'))
  await resumed.whenIdle()
  expectDegraded(f.ctx, f.runtime, f.adapter, resumed, f.warn, 'Turn after resume.')

  // The request is consumed once and the failure stays terminal.
  resumed.followup(userMessage('Second turn after resume.'))
  await resumed.whenIdle()
  expect(f.adapter.requests).toHaveLength(2)
  expect(f.scans() - scansBefore).toBe(1)
  expect(f.warn).toHaveBeenCalledTimes(1)
})
it('parks a request again once a recovered session fails mid-session', async () => {
  const f = await setup()
  f.failScan()
  const { agent } = await f.create('scan-failure-recovered')
  expect(f.runtime.state.status(agent)).toMatchObject({ ready: false, error: 'ENOENT', revision: 0 })
  // The catalog comes back and the user recovers explicitly: the session starts.
  f.healScan()
  await f.runtime.recover(agent.id, 0)
  expect(f.runtime.state.status(agent)).toMatchObject({ ready: true, revision: 1 })

  // A later failure is a mid-session one, not a failed start, so the established
  // contract holds: the request waits for the explicit recovery that re-applies
  // the committed selection instead of running under a broken session.
  f.failApply(true)
  await expect(f.runtime.state.change(agent, 1, captureExtensionSelection(null, []))).rejects.toThrow('apply failed')
  expect(f.runtime.state.status(agent)).toMatchObject({ ready: false, recoverable: true })
  const parked = userMessage('send while mid-session apply is broken')
  agent.followup(parked)
  await agent.whenIdle()
  expect(lastTurnEnd(agent)).toMatchObject({ reason: { kind: 'blocked' } })
  expect(f.adapter.requests).toHaveLength(0)
  expect([...agent.inbox.nextStep, ...agent.inbox.nextTurn].map(message => message.id)).toContain(parked.id)

  // The explicit recovery heals it and the parked request runs.
  f.failApply(false)
  const status = f.runtime.state.status(agent)
  await f.runtime.recover(agent.id, status.revision)
  expect(f.runtime.state.status(agent).ready).toBe(true)
  await agent.whenIdle()
  expect(f.adapter.requests).toHaveLength(1)
  expect(JSON.stringify(f.adapter.requests[0]?.messages)).toContain('send while mid-session apply is broken')
})
