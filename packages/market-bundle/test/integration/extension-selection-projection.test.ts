import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { jsonlPersistencePlugin as Persistence } from './helpers/jsonl-persistence.js'
import { removeTempRoot } from './helpers/temp-root.js'
import { ExtensionRuntime } from '../../../../packages/market-runtime/src/runtime/host/extension-runtime.js'
import {
  EXTENSION_SELECTION_KEY,
  extensionSelectionProjection,
  type ExtensionSelectionView
} from '../../../../packages/market-runtime/src/runtime/host/extension-selection-projection.js'
import { EXTENSION_SESSION_SOURCE } from '../../../../packages/market-runtime/src/runtime/host/extension-session-state.js'

class Query extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('unused'))
  }
}
class Adapter extends LlmAdapter {
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
const GLOBAL: ExtensionSelectionView = { presetId: null, presetName: null, modified: false }
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** One committed-session event carrying a binding of the given phase. */
function bindingEvent(phase: 'pending' | 'committed', name: string | null, presetId: string | null): SessionEvent {
  const message = createUserMessage({
    source: {
      kind: EXTENSION_SESSION_SOURCE,
      form: 'context',
      binding: {
        version: 1,
        ownerId: 'owner',
        revision: 1,
        phase,
        selection: { presetId, presetName: name, presetRevision: 1, modified: false, enabledIds: [] }
      }
    },
    content: []
  })
  return { type: 'user/message', seq: 1, time: 1, data: message } as unknown as SessionEvent
}

it('folds the last committed binding and ignores a pending request', () => {
  expect(extensionSelectionProjection.apply(GLOBAL, bindingEvent('pending', 'Research', 'preset'))).toBe(GLOBAL)
  const committed = extensionSelectionProjection.apply(GLOBAL, bindingEvent('committed', 'Research', 'preset'))
  expect(committed).toEqual({ presetId: 'preset', presetName: 'Research', modified: false })
  // A repeated envelope must not disturb the reference: publication is by identity.
  expect(extensionSelectionProjection.apply(committed, bindingEvent('committed', 'Research', 'preset'))).toBe(committed)
  const next = extensionSelectionProjection.apply(committed, bindingEvent('committed', 'Writing', 'other'))
  expect(next).toEqual({ presetId: 'other', presetName: 'Writing', modified: false })
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'extension-selection-projection-'))
  cleanups.push(() => removeTempRoot(root))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(Query)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new Adapter())
  const runtime = new ExtensionRuntime(ctx, { dataRoot: root, inventory: async () => [], applySelection: async () => {} })
  cleanups.push(() => runtime.dispose())
  await runtime.start()
  const agent = await ctx.agentLoop.create(SessionId('projected'), { provider: 'mock', model: 'test' }, { cwd: root })
  return { ctx, runtime, agent }
}

it('publishes the committed selection the chip renders, and follows a new one', async () => {
  // The chip reads this value instead of asking a route, so it must be the
  // session's own committed selection and nothing the connection happens to hold.
  const { ctx, runtime, agent } = await setup()
  await runtime.window(agent.id)
  expect(ctx.sessionProjections.stateOf(agent.session, EXTENSION_SELECTION_KEY)).toEqual(GLOBAL)
  const library = await runtime.window(agent.id)
  await runtime.create(agent.id, library.library.revision, { name: 'Research', enabledIds: [] })
  const withPreset = await runtime.window(agent.id)
  const preset = withPreset.library.presets.find(row => row.name === 'Research')
  expect(preset).toBeDefined()
  await runtime.select(agent.id, withPreset.selectionRevision ?? withPreset.state.revision, preset!.id)
  const after = await runtime.window(agent.id)
  expect(after.state.selection.presetName).toBe('Research')
  expect(ctx.sessionProjections.stateOf(agent.session, EXTENSION_SELECTION_KEY)).toEqual({
    presetId: preset!.id,
    presetName: 'Research',
    modified: false
  })
})
