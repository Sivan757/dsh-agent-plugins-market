/** Reading the model-facing MCP tools the host registry currently exposes. */

import type { Context } from '@deepseek-ai/cordis'

/** One MCP tool observed from the DSH tool registry. */
export interface McpToolSnapshot {
  name: string
  description?: string
  /** The input schema the server advertised, when the host exposes it. */
  parameters?: unknown
}

/** The host tools service subset this plugin reads. */
interface ToolRegistryService {
  schemas(scope?: string): ReadonlyArray<{ name: string; description: string; parameters?: unknown }>
}

/**
 * The MCP tools the host currently publishes to the model.
 *
 * Read through the tools service's own listing API rather than its internal
 * layer structure. `schemas()` deep-clones each tool's parameter schema, so a
 * failure inside it degrades to an empty observation instead of taking the
 * status surface down.
 * @param tools - the host tools service, when it is mounted.
 * @returns one entry per `mcp__`-namespaced tool.
 */
export function inspectToolRegistry(tools: unknown): McpToolSnapshot[] {
  const service = tools as ToolRegistryService | undefined
  if (service === undefined || typeof service !== 'object' || service === null) return []
  if (typeof service.schemas !== 'function') return []
  try {
    const output: McpToolSnapshot[] = []
    for (const schema of service.schemas()) {
      if (!schema.name.startsWith('mcp__')) continue
      const description = typeof schema.description === 'string' ? schema.description : undefined
      output.push({
        name: schema.name,
        ...(description === undefined ? {} : { description }),
        ...(schema.parameters === undefined ? {} : { parameters: schema.parameters })
      })
    }
    return output
  } catch {
    return []
  }
}

/** Read the tools service off the plugin context, when the host mounts one. */
export function toolsServiceOf(ctx: Context): unknown {
  return (ctx as unknown as { get?: (name: string) => unknown }).get?.('tools')
}
