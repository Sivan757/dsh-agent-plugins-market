/**
 * What the model sees for the plugin's MCP tools.
 *
 * The model's catalog is not the registry's view: the agent loop resolves a step's
 * admission (a `ResolvedToolSet`) and asks the scoped executor to describe the
 * admitted definitions. A tool that is registered but not admitted never reaches the
 * model, so "the model says it cannot find MCP" is a statement about that chain.
 *
 * This file measures the chain end to end with the real host services: the plugin's own
 * `syncTools` builds and registers the MCP definitions, and the same two calls the agent
 * loop makes in `preStep` produce the catalog the model would receive.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { syncTools, type ToolBridgeOptions, type ToolHost } from '../../../../packages/market-mcp/src/runtime/mcp/bridge/tools.js'
import { attachExtensionToolGates } from '../../../../packages/market-runtime/src/runtime/host/extension-tool-gates.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
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

/** An MCP client that lists one tool and answers calls. */
function mockClient(tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>) {
  return {
    request: async (request: { method: string; params?: Record<string, unknown> }): Promise<unknown> => {
      if (request.method === 'tools/list') return { tools, nextCursor: undefined }
      if (request.method === 'tools/call') return { content: [{ type: 'text', text: 'ok' }] }
      throw new Error('unexpected MCP request: ' + request.method)
    },
    setNotificationHandler: (): void => {},
    connect: async (): Promise<void> => {},
    close: async (): Promise<void> => {}
  }
}

const options: ToolBridgeOptions = { serverName: 'srv', toolCallTimeoutMs: 1000, registrationFailure: 'contain' }

/**
 * The plugin's own host adapter, as the bridge builds it.
 *
 * The bridge adapts the host registry with a structural cast because the plugin mirrors
 * the host's tool contract instead of importing it
 * (packages/market-mcp/src/runtime/mcp/bridge/bridge.ts). This test registers the very
 * same objects, so it uses the same seam.
 */
function hostOver(ctx: Context): ToolHost {
  const registry = ctx as unknown as { tools?: { register?: (definition: unknown) => () => void } }
  return {
    logger: { error: () => {}, warn: () => {}, info: () => {} },
    tools: { register: definition => registry.tools!.register!(definition) }
  }
}

async function setup() {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('mcp-visibility'), { provider: 'mock', model: 'parent' })
  return { ctx, agent, adapter }
}

/** The tool catalog the model receives: the same two calls the agent loop makes. */
async function modelCatalog(ctx: Context, agent: Awaited<ReturnType<typeof setup>>['agent']) {
  const signal = new AbortController().signal
  const modelSelection = { provider: 'mock', model: 'parent' }
  const toolSet = await ctx.tools.resolve({ agent, modelSelection, signal })
  const assembly = await ctx.systemPrompt.assemble({
    ...assembleContextFor(agent, signal),
    modelSelection,
    toolSet
  })
  return assembly.tools.map(tool => tool.name)
}

describe('the MCP tools the model can see', () => {
  it('carries a registered MCP tool into the model catalog', async () => {
    const { ctx, agent } = await setup()
    // A control tool registered the same way, so a blank catalog is distinguishable
    // from a missing MCP tool.
    const control = defineTool({
      name: 'control_tool',
      description: 'Control',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async () => 'ok'
    })
    const removeControl = ctx.tools.register(control)
    cleanups.push(removeControl)

    // The plugin's own registration path: build the definition and register it.
    const host = hostOver(ctx)
    const disposers = await syncTools(mockClient([{ name: 'query', description: 'Query', inputSchema: { type: 'object', properties: {} } }]) as never, host, options, new Map())
    cleanups.push(() => [...disposers.values()].forEach(dispose => dispose()))

    expect([...disposers.keys()]).toEqual(['mcp__srv__query'])
    const catalog = await modelCatalog(ctx, agent)
    expect(catalog).toContain('control_tool')
    expect(catalog).toContain('mcp__srv__query')
  })

  it('hides the MCP tool from the model when the session selection denies it', async () => {
    // The plugin's own gate: a session that may not use an MCP server hides its tools
    // from the model by restricting them, so the model never sees them at all.
    const { ctx, agent } = await setup()
    const host = hostOver(ctx)
    const disposers = await syncTools(mockClient([{ name: 'query', description: 'Query', inputSchema: { type: 'object', properties: {} } }]) as never, host, options, new Map())
    cleanups.push(() => [...disposers.values()].forEach(dispose => dispose()))
    const definition = ctx.tools.get('mcp__srv__query', agent)!
    const gates = attachExtensionToolGates(
      agent,
      {
        mcpTools: () => [{ name: 'mcp__srv__query', resourceId: 'mcp:srv', suiteId: 'source/suite', definition, scope: undefined }],
        lspProviders: () => [],
        ownsLspTool: () => false
      },
      { ready: () => true, allows: () => false }
    )
    cleanups.push(() => gates.dispose())

    expect(await modelCatalog(ctx, agent)).not.toContain('mcp__srv__query')
  })

  it('keeps the MCP tool in the model catalog when the session selection allows it', async () => {
    const { ctx, agent } = await setup()
    const host = hostOver(ctx)
    const disposers = await syncTools(mockClient([{ name: 'query', description: 'Query', inputSchema: { type: 'object', properties: {} } }]) as never, host, options, new Map())
    cleanups.push(() => [...disposers.values()].forEach(dispose => dispose()))
    const definition = ctx.tools.get('mcp__srv__query', agent)!
    const gates = attachExtensionToolGates(
      agent,
      {
        mcpTools: () => [{ name: 'mcp__srv__query', resourceId: 'mcp:srv', suiteId: 'source/suite', definition, scope: undefined }],
        lspProviders: () => [],
        ownsLspTool: () => false
      },
      { ready: () => true, allows: () => true }
    )
    cleanups.push(() => gates.dispose())

    expect(await modelCatalog(ctx, agent)).toContain('mcp__srv__query')
  })
})
