/** Host-private adapter for observing model-facing MCP tools. */

import type { Context } from '@deepseek-ai/cordis'

/** One MCP tool observed from the DSH tool registry. */
export interface McpToolSnapshot {
  name: string
  description?: string
}

/**
 * Read MCP tool names from the dsh-tools runtime when available.
 *
 * The registry has no public listing API in the current host release. This
 * adapter uses the observed `layers.merge(...).tools.entries()` data shape and
 * returns an empty observation when a host changes it.
 */
export function inspectToolRegistry(runtime: unknown): McpToolSnapshot[] {
  if (typeof runtime !== 'object' || runtime === null) return []
  const layers = (runtime as { layers?: unknown }).layers
  if (typeof layers !== 'object' || layers === null) return []
  const merge = (layers as { merge?: unknown }).merge
  if (typeof merge !== 'function') return []
  const empty = { entries: (): Array<[string, unknown]> => [] }
  try {
    const visible = (merge as (scope: undefined, pick: (layer: { tools?: typeof empty }) => typeof empty) => typeof empty).call(layers, undefined, layer => layer.tools ?? empty)
    const output: McpToolSnapshot[] = []
    for (const [name, definition] of visible.entries()) {
      if (!name.startsWith('mcp__')) continue
      const description =
        typeof definition === 'object' && definition !== null && typeof (definition as { description?: unknown }).description === 'string'
          ? (definition as { description: string }).description
          : undefined
      output.push({ name, ...(description === undefined ? {} : { description }) })
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
