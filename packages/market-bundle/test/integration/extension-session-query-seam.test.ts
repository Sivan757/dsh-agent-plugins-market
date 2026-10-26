/**
 * A profile that ships no session-query package still loads and still runs.
 *
 * The extension selection surface reads `ctx.sessionQuery`, and the host supplies
 * that service; this plugin never provisions the package. The module therefore
 * imports it for types only, and the seam answers "unavailable" when the service
 * is absent instead of failing module evaluation. A value import cannot honor
 * that: it throws `ERR_MODULE_NOT_FOUND` before the plugin registers anything,
 * which is the defect 0.12.0 shipped.
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { jsonlPersistencePlugin as Persistence } from './helpers/jsonl-persistence.js'
import { removeTempRoot } from './helpers/temp-root.js'
import { captureExtensionSelection } from '../../../../packages/market-contracts/src/contracts/extension-presets.js'
import { ExtensionSessionState } from '../../../../packages/market-runtime/src/runtime/host/extension-session-state.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})

it('answers unavailable instead of failing when the profile provides no session-query service', async () => {
  const root = await mkdtemp(join(tmpdir(), 'extension-session-query-'))
  cleanups.push(() => removeTempRoot(root))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  const service = new ExtensionSessionState(ctx, {
    initialSelection: async () => captureExtensionSelection(null, []),
    applySelection: async () => {}
  })
  cleanups.push(() => service.dispose())
  await service.start()
  const agent = await ctx.agentLoop.create(SessionId('no-query'), { provider: 'mock', model: 'test' })
  expect(service.status(agent)).toEqual({ ready: false, revision: 0, recoverable: false, error: 'extension-session-query-unavailable' })
  // The service governs no agent, so every managed resource stays denied and the
  // agent keeps its own lifecycle: nothing parks its input and nothing cancels it.
  expect(service.read(agent)).toBeUndefined()
  expect(agent.status).toBe('idle')
  await expect(service.initialize(agent)).rejects.toMatchObject({ code: 'extension-session-query-unavailable' })
})
