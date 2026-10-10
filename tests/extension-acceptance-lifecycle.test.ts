/**
 * Session lifecycle boundaries for extension presets.
 *
 * What this file covers: ORDERING ONLY. A held maintenance pass holds queued input, and
 * by the time the next request starts the runtime already answers with the newly
 * acknowledged selection. It does NOT prove the model saw a tool schema: this harness
 * assembles no tool presentation, so the captured request options carry no `tools` field
 * at all (measured). The model-facing schema is verified in the live profile with the real
 * request assembly, not here.
 *
 * What it does NOT cover yet: driving the host's real `clear`/`compact` commands.
 * Those ship in the profile bundles (@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app),
 * which are not dependencies of this package, so they cannot be invoked from this
 * harness. That case stays open and is verified by driving the composer in the
 * isolated live profile; calling `state.initialize` directly would be a stand-in,
 * not the mechanism, so no such case is asserted here.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ExtensionRuntime } from '../packages/market-runtime/src/runtime/host/extension-runtime.js'
import { attachExtensionToolGates, type ExtensionToolGates } from '../packages/market-runtime/src/runtime/host/extension-tool-gates.js'
import { registerOwnedBridgeTool } from '../packages/market-mcp/src/runtime/mcp/bridge/tool-ownership.js'
import type { ExtensionResource } from '../packages/market-contracts/src/contracts/extension-presets.js'

class TestQuery extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
}
class RecordingAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  onRequest?: () => void
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    this.onRequest?.()
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

let presetSequence = 0
/**
 * Write one named preset into the workspace library and return its id.
 *
 * Presets replaced the temporary adjustment that used to carry an id list, so a
 * grant is now two calls. The library revision and the session state revision are
 * separate counters and each is read immediately before the call consuming it:
 * writing a preset never advances session state.
 */
async function createPreset(runtime: ExtensionRuntime, sessionId: string, enabledIds: string[], label: string): Promise<string> {
  const name = label + '-' + presetSequence++
  await runtime.create(sessionId, (await runtime.window(sessionId)).library.revision, { name, enabledIds })
  const preset = (await runtime.window(sessionId)).library.presets.find(row => row.name === name)
  if (preset === undefined) throw new Error('extension preset was not created')
  return preset.id
}
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const parent: ExtensionResource = {
  id: 'market:src/suite',
  face: 'market',
  name: 'Suite',
  source: 'src',
  available: true,
  detail: { kind: 'suite', sourceId: 'src', suiteId: 'suite' }
}
const mcp: ExtensionResource = {
  id: 'mcp:plugin:src/suite/db',
  face: 'mcp',
  name: 'db',
  source: 'src',
  available: true,
  suiteResourceId: parent.id,
  detail: { kind: 'mcp', entryId: 'db' }
}
const TOOL = 'db__query'

async function setup(holdApply: () => Promise<void>, ready: (agent: unknown) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'extension-lifecycle-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const runtime = new ExtensionRuntime(ctx, {
    dataRoot: root,
    inventory: async () => [parent, mcp],
    applySelection: async () => {
      await holdApply()
    },
    ready: async agent => {
      await ready(agent)
    },
    eligible: agent => {
      const cwd = agent.session.header.cwd
      return typeof cwd === 'string' && cwd.startsWith('/')
    }
  })
  cleanups.push(() => runtime.dispose())
  await runtime.start()
  const agent = (await ctx.agents.create({ sessionId: SessionId('lifecycle'), meta: { cwd: root }, agentOptions: { provider: 'mock', model: 'test' } })).agent
  return { root, ctx, runtime, agent, adapter }
}

describe('extension preset lifecycle boundaries', () => {
  it('publishes a re-granted selection before the next request starts after a held apply', async () => {
    const gate = Promise.withResolvers<void>()
    // Signals that the held pass has actually been entered, so the queued message is
    // sent after the transaction owns the agent rather than after a fixed sleep.
    const entered = Promise.withResolvers<void>()
    let held = false
    const holder: { current?: ExtensionToolGates } = {}
    const { ctx, runtime, agent, adapter } = await setup(
      async () => {
        if (!held) return
        entered.resolve()
        await gate.promise
      },
      // The composition root refreshes the gate from the ready callback, so the new
      // selection is published before maintenance ends.
      async () => {
        holder.current?.refresh()
      }
    )
    // A bounded wait rather than the 1s default: the runtime mounts extensions
    // and opens file watchers, and a loaded Windows runner needs longer than the
    // default. The assertion still fails if it never becomes ready.
    await vi.waitFor(() => expect(runtime.ready(agent)).toBe(true), { timeout: 10_000 })

    // A root-owned (inherited) tool: same-scope tools are exempt from the host
    // restriction, so the boundary must be probed with an inherited one.
    const execute = vi.fn(async () => 'ran')
    const definition = defineTool({
      name: TOOL,
      description: 'query',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      execute
    })
    const remove = registerOwnedBridgeTool(ctx, 'db', definition, () => ctx.tools.register(definition))
    holder.current = attachExtensionToolGates(
      agent,
      { mcpTools: () => [{ resourceId: mcp.id, suiteId: 'src/suite', name: definition.name, definition, scope: undefined }], lspProviders: () => [], ownsLspTool: () => false },
      { ready: candidate => runtime.ready(candidate), allows: (candidate, resourceId, suiteId) => runtime.allows(candidate, resourceId, suiteId) }
    )
    cleanups.push(() => {
      holder.current?.dispose()
      remove()
    })

    // The revision is read synchronously so a held pass is claimed before the queued
    // message below can be considered by the agent.
    const revision = (): number => {
      const snapshot = runtime.state.read(agent)
      if (snapshot === undefined) throw new Error('extension session state is not ready')
      return snapshot.revision
    }

    // Revoke first, so the held pass grants a genuinely different set.
    await runtime.select(agent.id, revision(), await createPreset(runtime, agent.id, [parent.id], 'revoke'))
    await vi.waitFor(() => expect(runtime.allows(agent, mcp.id)).toBe(false))
    holder.current?.refresh()

    const seenSchemas: string[][] = []
    adapter.onRequest = () => seenSchemas.push(ctx.tools.schemas(agent).map(schema => schema.name))
    const reGranted = await createPreset(runtime, agent.id, [parent.id, mcp.id], 'regrant')
    held = true
    const reGrant = runtime.select(agent.id, revision(), reGranted)
    await entered.promise
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Queued while held' }] }))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(adapter.requests, 'no request may start while the pass is held').toHaveLength(0)

    held = false
    gate.resolve()
    await reGrant
    await vi.waitFor(() => expect(adapter.requests).toHaveLength(1))
    // The tool runtime's own answer at the instant the request is issued. This is an
    // ordering check on the runtime, not evidence about what the model received: the
    // adapter options carry no tools field in this harness.
    expect(seenSchemas).toHaveLength(1)
    expect(seenSchemas[0]).toContain(TOOL)
    expect(runtime.state.read(agent)?.selection.enabledIds).toEqual([parent.id, mcp.id])
  })
})
