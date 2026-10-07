import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerOwnedBridgeTool } from '../src/runtime/mcp/bridge/tool-ownership.js'
import { attachExtensionToolGates } from '../src/runtime/host/extension-tool-gates.js'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { ExtensionRuntime } from '../src/runtime/host/extension-runtime.js'
import { ExtensionPresetStore, extensionPresetLibraryPath } from '../src/application/state/extension-presets.js'
import { allFiltersOn, saveResourceFilters } from '../src/application/state/resource-filters.js'
import type { ExtensionResource } from '../src/contracts/extension-presets.js'

let presetSequence = 0
/**
 * Grant exactly these ids the way the product does now: write a named preset into
 * the workspace library, then select it. The library revision and the session state
 * revision are separate counters, each read immediately before the call that
 * consumes it — creating a preset never advances session state.
 */
async function applyPreset(runtime: ExtensionRuntime, sessionId: string, enabledIds: string[]): Promise<void> {
  const name = 'acceptance-preset-' + presetSequence++
  await runtime.create(sessionId, (await runtime.window(sessionId)).library.revision, { name, enabledIds })
  const preset = (await runtime.window(sessionId)).library.presets.find(row => row.name === name)
  if (preset === undefined) throw new Error('extension preset was not created')
  await runtime.select(sessionId, (await runtime.window(sessionId)).state.revision, preset.id)
}
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
    this.onRequest?.()
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
async function setup(inventory?: () => Promise<ExtensionResource[]>) {
  const root = await mkdtemp(join(tmpdir(), 'extension-acceptance-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  const resources: ExtensionResource[] = [
    { id: 'skills:controlled', face: 'skills', name: 'Controlled', source: 'suite', available: true, detail: { kind: 'panel', panel: 'skills', entryId: 'controlled' } },
    { id: 'skills:native', face: 'skills', name: 'Native', source: 'user', control: 'global-only', available: true, detail: { kind: 'panel', panel: 'skills', entryId: 'native' } }
  ]
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const applySelection = vi.fn(async () => {})
  const runtime = new ExtensionRuntime(ctx, {
    dataRoot: root,
    inventory: inventory ?? (async () => resources),
    applySelection,
    // The same predicate the composition root passes: only an agent with a real
    // absolute workspace is governed at all.
    eligible: agent => {
      const cwd = agent.session.header.cwd
      return typeof cwd === 'string' && isAbsolute(cwd)
    }
  })
  cleanups.push(() => runtime.dispose())
  await runtime.start()
  const create = async (id: string, cwd = root) => (await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd }, agentOptions: { provider: 'mock', model: 'test' } })).agent
  return { root, ctx, runtime, create, applySelection, adapter }
}

describe('extension preset acceptance', () => {
  it('holds immediate Send behind initial selection application before any model request', async () => {
    const { create, runtime, ctx, applySelection, adapter } = await setup()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    applySelection.mockImplementationOnce(async () => {
      entered.resolve()
      await release.promise
    })
    const observedReadiness: boolean[] = []
    adapter.onRequest = () => observedReadiness.push(runtime.ready(ctx.agents.get(SessionId('immediate'))!))
    const creating = create('immediate')
    await entered.promise
    const agent = ctx.agents.get(SessionId('immediate'))!
    try {
      expect(agent).toBeDefined()
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Immediate Send' }] }))
      expect(runtime.ready(agent)).toBe(false)
      expect(adapter.requests).toHaveLength(0)
    } finally {
      release.resolve()
    }
    await creating
    await agent.whenIdle()
    expect(runtime.ready(agent)).toBe(true)
    expect(adapter.requests).toHaveLength(1)
    expect(observedReadiness).toEqual([true])
  })
  it('keeps an initialized empty session blank until an actual user message arrives', async () => {
    const { create, runtime } = await setup()
    const agent = await create('blank')
    expect(agent.session.snapshotEvents().length).toBeGreaterThan(0)
    expect((await runtime.window(agent.id)).started).toBe(false)
    const release = Promise.withResolvers<void>()
    const maintenance = agent.runMaintenance(() => release.promise)
    try {
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello' }] }))
      expect((await runtime.window(agent.id)).started).toBe(true)
    } finally {
      agent.cancel({ kind: 'disposed' }, { keepInbox: true })
      release.resolve()
      await maintenance.catch(() => {})
      await agent.whenIdle()
    }
  })
  it('does not apply legacy workspace deny filters to a fresh session', async () => {
    const { root, create, runtime } = await setup()
    const filters = allFiltersOn()
    filters.offEntries.skills = ['skills:controlled']
    await saveResourceFilters(root, root, filters)
    const agent = await create('fresh')
    expect((await runtime.window(agent.id)).state.selection.enabledIds).toEqual(['skills:controlled'])
  })
  it('preserves legacy effective choices when attaching to an unsnapshotted existing session', async () => {
    const { root, ctx, runtime, create } = await setup()
    await runtime.dispose()
    const filters = allFiltersOn()
    filters.offEntries.skills = ['skills:controlled']
    await saveResourceFilters(root, root, filters)
    const store = new ExtensionPresetStore(root)
    const library = await store.create(root, 0, { name: 'New default', enabledIds: ['skills:controlled'] })
    await store.setDefault(root, 1, library.presets[0]!.id)
    const agent = await create('legacy')
    agent.inject(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Existing history' }] }))
    const resource: ExtensionResource = {
      id: 'skills:controlled',
      face: 'skills',
      name: 'Controlled',
      source: 'suite',
      available: true,
      detail: { kind: 'panel', panel: 'skills', entryId: 'controlled' }
    }
    const attached = new ExtensionRuntime(ctx, { dataRoot: root, inventory: async () => [resource], applySelection: async () => {} })
    cleanups.push(() => attached.dispose())
    await attached.start()
    expect((await attached.window(agent.id)).state.selection.enabledIds).toEqual([])
    expect((await attached.window(agent.id)).state.selection.presetId).toBeNull()
  })
  it('leaves prior session snapshots unchanged after preset edit and deletion', async () => {
    const { create, runtime, applySelection, root } = await setup()
    const a = await create('a')
    await runtime.create(a.id, 0, { name: 'None', enabledIds: [] })
    const preset = (await runtime.window(a.id)).library.presets[0]!
    await runtime.setDefault(a.id, 1, preset.id)
    const b = await create('b')
    const other = await create('other', join(root, 'other'))
    expect((await runtime.window(b.id)).state.selection.enabledIds).toEqual([])
    expect((await runtime.window(other.id)).state.selection.enabledIds).toEqual(['skills:controlled'])
    const before = (await runtime.window(b.id)).state
    applySelection.mockClear()
    await runtime.update(a.id, 2, preset.id, { name: 'Changed', enabledIds: ['skills:controlled'] })
    await runtime.delete(a.id, 3, preset.id)
    expect((await runtime.window(b.id)).state).toEqual(before)
    expect((await runtime.window(a.id)).state.selection.enabledIds).toEqual(['skills:controlled'])
    expect(applySelection).not.toHaveBeenCalled()
  })
  it('excludes global-only resources from captured choices without misreporting availability', async () => {
    const { create, runtime } = await setup()
    const agent = await create('native')
    const window = await runtime.window(agent.id)
    expect(window.resources.find(row => row.id === 'skills:native')).toMatchObject({ available: true, control: 'global-only' })
    expect(window.state.selection.enabledIds).toEqual(['skills:controlled'])
    await applyPreset(runtime, agent.id, [])
    expect(runtime.allows(agent, 'skills:controlled')).toBe(false)
  })
  it.each(['', '  \n'])('rejects an existing corrupt empty library without replacing its bytes', async bytes => {
    const { root } = await setup()
    const path = extensionPresetLibraryPath(root, root)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
    const store = new ExtensionPresetStore(root)
    await expect(store.read(root)).rejects.toThrow()
    await expect(store.create(root, 0, { name: 'New', enabledIds: [] })).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(bytes)
  })
  it('authorizes a selected MCP and LSP extension through its suite parent, and fails closed across a catalog change', async () => {
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
    const lsp: ExtensionResource = {
      id: 'lsp:src/suite/ts',
      face: 'lsp',
      name: 'ts',
      source: 'src',
      available: true,
      suiteResourceId: parent.id,
      detail: { kind: 'lsp', entryId: 'src/suite/ts' }
    }
    let rows: ExtensionResource[] = [parent, mcp, lsp]
    const { create, runtime } = await setup(async () => rows)
    const agent = await create('authorized')
    await vi.waitFor(() => expect(runtime.ready(agent)).toBe(true))
    // Both the resource id and the bare suite id the mount ownership reports must
    // authorize the same granted extension, through the authoritative parent.
    expect(runtime.allows(agent, mcp.id)).toBe(true)
    expect(runtime.allows(agent, mcp.id, 'src/suite')).toBe(true)
    expect(runtime.allows(agent, lsp.id, 'src/suite')).toBe(true)
    expect(runtime.allows(agent, 'mcp:plugin:src/other/db', 'src/other')).toBe(false)
    // The catalog drops the parent: the next call denies before any re-read, and
    // stays denied while the new catalog still lacks the parent row.
    rows = [mcp, lsp]
    runtime.invalidate()
    expect(runtime.registrationAllows(agent, mcp.id, 'src/suite')).toBe(false)
    await runtime.refreshAll()
    expect(runtime.allows(agent, mcp.id, 'src/suite')).toBe(false)
    expect(runtime.allows(agent, lsp.id, 'src/suite')).toBe(false)
    // The parent returns: the same selection authorizes again.
    rows = [parent, mcp, lsp]
    runtime.invalidate()
    await runtime.refreshAll()
    expect(runtime.allows(agent, mcp.id, 'src/suite')).toBe(true)
    expect(runtime.allows(agent, lsp.id, 'src/suite')).toBe(true)
  })
  it('marks an agent without a managed workspace ineligible rather than owning or gating it', async () => {
    const { ctx, runtime } = await setup()
    // The host itself refuses a relative cwd, so the unmanaged shape is an agent
    // created without one at all — a plain agent the service must not own.
    const agent = (await ctx.agents.create({ sessionId: SessionId('unmanaged'), agentOptions: { provider: 'mock', model: 'test' } })).agent
    // Ineligible is a reported state, not a pending transaction: nothing to recover,
    // no revision consumed, and no grant to any resource.
    const status = runtime.state.status(agent)
    expect(status.ready).toBe(false)
    expect(status.error).toBe('extension-session-ineligible')
    expect(runtime.ready(agent)).toBe(false)
    expect(runtime.allows(agent, 'skills:controlled')).toBe(false)
    // And no extension interface is offered for it, because no workspace resolves.
    await expect(runtime.window(agent.id)).rejects.toThrow(/workspace|ready/)
  })
  it('never re-authorizes from an inventory read that started before the catalog changed', async () => {
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
    let releaseStale: (() => void) | undefined
    let held = false
    let revoked = false
    const { create, runtime } = await setup(async () => {
      // Only the read the test parks is held, and it answers with the pre-revoke
      // catalog; every other read answers what the catalog holds right now.
      if (held) {
        held = false
        const gate = Promise.withResolvers<void>()
        releaseStale = () => gate.resolve()
        await gate.promise
        return [parent, mcp]
      }
      return revoked ? [] : [parent, mcp]
    })
    const agent = await create('epoch')
    await vi.waitFor(() => expect(runtime.allows(agent, mcp.id)).toBe(true))
    held = true
    const staleRead = runtime.refreshInventory(agent)
    await vi.waitFor(() => expect(releaseStale).toBeDefined())
    revoked = true
    runtime.invalidate()
    expect(runtime.allows(agent, mcp.id)).toBe(false)
    await runtime.refreshInventory(agent)
    expect(runtime.allows(agent, mcp.id)).toBe(false)
    releaseStale!()
    await staleRead
    expect(runtime.allows(agent, mcp.id)).toBe(false)
  })
  it('runs a granted extension tool for the selected session and refuses the same call once the grant is gone', async () => {
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
    const { create, runtime } = await setup(async () => [parent, mcp])
    const agent = await create('granted')
    await vi.waitFor(() => expect(runtime.ready(agent)).toBe(true))
    const execute = vi.fn(async () => 'ran')
    const definition = defineTool({
      name: 'db__query',
      description: 'query',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      execute
    })
    const remove = registerOwnedBridgeTool(agent.ctx, 'db', definition, () => agent.ctx.tools.register(definition))
    const gate = attachExtensionToolGates(
      agent,
      { mcpTools: () => [{ resourceId: mcp.id, suiteId: 'src/suite', name: definition.name, definition, scope: undefined }], lspProviders: () => [], ownsLspTool: () => false },
      { ready: candidate => runtime.ready(candidate), allows: (candidate, resourceId, suiteId) => runtime.allows(candidate, resourceId, suiteId) }
    )
    cleanups.push(() => {
      gate.dispose()
      remove()
    })
    const call = () => agent.ctx.tools.execute({ callId: ToolCallId('granted-call'), name: definition.name, arguments: {}, agent, signal: new AbortController().signal })
    const granted = await call()
    expect(granted.isError).toBe(false)
    expect(execute).toHaveBeenCalledTimes(1)
    // The same tool without the grant never reaches the transport.
    await applyPreset(runtime, agent.id, [])
    await vi.waitFor(() => expect(runtime.allows(agent, mcp.id)).toBe(false))
    gate.refresh()
    const refused = await call()
    expect(refused.isError).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
