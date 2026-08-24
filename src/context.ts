/**
 * Runtime suite context: the `agent_plugins` query tool.
 *
 * Skills are injected by the native skill catalog (`dsh-tool-skill` renders
 * `ctx.skills` providers into the model's `<available_skills>` catalog), so
 * this module does not inject a duplicate session-start message. The tool
 * exists for facts the catalog does not carry: enabled plugins per
 * dimension, skill names per plugin, and MCP server prefixes.
 */
import type { Context } from '@deepseek-ai/cordis'
import { deriveServerName } from './runtime/mcp-config.js'
import type { Catalog } from './application/catalog.js'
import type { HostTranslate } from './runtime/host-locale.js'
import type { Suite } from './model/types.js'

/** Structural tool registry surface this plugin touches. */
interface ToolsRegistry {
  register(definition: {
    name: string
    description: string
    parameters: Record<string, unknown>
    renderIntent?: string
    output: {
      schema: Record<string, unknown>
      render(args: unknown, value: unknown): Array<{ type: string; text: string }>
    }
    execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown>
  }): () => void
}

/** Mount the agent_plugins query tool. */
export function mountSuiteContext(ctx: Context, manager: Catalog, t: HostTranslate): () => void {
  const disposers: Array<() => void> = []
  ctx.inject(['tools'], toolsCtx => {
    const tools = toolsCtx as unknown as { tools: ToolsRegistry }
    if (typeof tools.tools?.register !== 'function') return
    const parameters = {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'info'], description: t('agentPluginsListAction') },
        suiteId: { type: 'string', description: t('agentPluginsSuiteId') },
        sourceId: { type: 'string', description: t('agentPluginsSourceId') }
      },
      required: ['action'],
      additionalProperties: false
    }
    const outputSchema = {
      type: 'object',
      properties: {
        suites: { type: 'array', items: { type: 'object' } },
        skills: { type: 'array', items: { type: 'object' } },
        mcpServers: { type: 'array', items: { type: 'object' } },
        note: { type: 'string' }
      }
    }
    const dispose = tools.tools.register({
      name: 'agent_plugins',
      description: t('agentPluginsToolDescription'),
      parameters,
      renderIntent: 'generic',
      output: {
        schema: outputSchema,
        render: (_args, value) => {
          const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
          return [{ type: 'text', text }]
        }
      },
      execute: async args => {
        const record = args as Record<string, unknown>
        const action = record['action']
        if (action === 'list') return listPayload(await manager.enabledUserSuites(), t)
        if (action === 'info') return infoPayload(await manager.enabledUserSuites(), record, t)
        return { suites: [], skills: [], mcpServers: [], note: `unknown action ${JSON.stringify(action)}` }
      }
    })
    disposers.push(dispose)
  })

  return () => {
    for (const dispose of disposers) dispose()
  }
}

function listPayload(suites: Suite[], t: HostTranslate): Record<string, unknown> {
  return {
    suites: suites.map(suite => ({
      id: suite.id,
      sourceId: suite.sourceId,
      name: suite.manifest.name,
      version: suite.manifest.version ?? null,
      description: suite.manifest.description ?? null,
      layout: suite.manifest.layout
    })),
    skills: suites.flatMap(suite => suite.skills.map(skill => ({ suiteId: suite.id, name: skill.name, description: `[${suite.manifest.name}] ${skill.description}` }))),
    mcpServers: suites.flatMap(suite =>
      suite.mcp === undefined ? [] : Object.keys(suite.mcp.servers).map(key => ({ suiteId: suite.id, server: key, tools: `mcp__${deriveServerName(suite.id, key)}__*` }))
    ),
    note: t('agentPluginsListNote')
  }
}

function infoPayload(suites: Suite[], record: Record<string, unknown>, t: HostTranslate): Record<string, unknown> {
  const suiteId = record['suiteId']
  const suite = suites.find(entry => entry.id === suiteId)
  if (suite === undefined) return { suites: [], skills: [], mcpServers: [], note: t('agentPluginsNotFound', { suiteId: String(suiteId) }) }
  return listPayload([suite], t)
}
