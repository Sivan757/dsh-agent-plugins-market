/**
 * The composition root's mount adapters for the runtime coordinator.
 *
 * The runtime package drives MCP and LSP through structural ports; this module
 * is the one place that knows which registries implement them, so the concrete
 * transport packages stay out of the runtime's import graph. Construction here
 * mirrors what the coordinator used to do itself: the same constructor
 * arguments, and the plugin data root still set by the coordinator.
 *
 * @module runtime-adapters
 */
import type { Context } from '@deepseek-ai/cordis'
import { McpMountRegistry } from '../../market-mcp/src/index.js'
import { deriveServerName } from '../../market-mcp/src/index.js'
import { LspMountRegistry } from '../../market-lsp/src/index.js'
import type { McpMountFactory, RuntimeMounts, SharedMcpMountPort } from '../../market-runtime/src/index.js'

/**
 * Build the shared-service MCP adapter over one context.
 *
 * The mount registry stays the sole owner of its transport state: this wrapper
 * only adds the mount proof, which needs the registry's own server-name
 * derivation, and forwards every other call unchanged.
 * @param ctx - the context the registry mounts through.
 * @param dataRoot - the plugin data root the registry stores overrides under.
 * @returns the MCP adapter the coordinator drives.
 */
export function createSharedMcpMount(ctx: Context, dataRoot: string): SharedMcpMountPort {
  const registry = new McpMountRegistry(ctx, dataRoot)
  return {
    setOverridesProvider: provider => registry.setOverridesProvider(provider),
    setBackendProvider: provider => registry.setBackendProvider(provider),
    setToolNamesProvider: provider => registry.setToolNamesProvider(provider),
    setEntryFilter: filter => registry.setEntryFilter(filter),
    usesCredential: ref => registry.usesCredential(ref),
    forceRemount: (suiteId, serverKey) => registry.forceRemount(suiteId, serverKey),
    forceRemountAll: () => registry.forceRemountAll(),
    serverOwner: serverName => registry.serverOwner(serverName),
    reconcile: suites => registry.reconcile(suites),
    disposeAll: () => registry.disposeAll(),
    toolOwnership: () => registry.toolOwnership(),
    assertMounted: (suite, diagnostics, failed) => {
      const key = suite.sourceId + '/' + suite.id
      for (const serverKey of Object.keys(suite.mcp?.servers ?? {})) {
        const owner = registry.serverOwner(deriveServerName(suite, serverKey))
        if (owner?.suiteId !== key || owner.serverKey !== serverKey || diagnostics.some(row => row.suiteId === key && row.serverKey === serverKey) || failed)
          throw new Error('extension-shared-mcp-unavailable: ' + key + '/' + serverKey)
      }
    }
  }
}

/**
 * Create one MCP mount for an agent-scoped contributor.
 *
 * The contributor mounts into contexts it does not own, so it takes the factory
 * and calls it per context; the adapter is the same object the coordinator
 * drives, which keeps one registry implementation behind both seams.
 * @param ctx - the context the mount registers into.
 * @param dataRoot - the plugin data root the mount stores overrides under.
 * @returns the MCP mount for that context.
 */
export const createMcpMount: McpMountFactory = (ctx, dataRoot) => createSharedMcpMount(ctx, dataRoot)

/**
 * Build both mount adapters one reconciler drives.
 * @param ctx - the context the registries mount through.
 * @param dataRoot - the plugin data root the MCP registry stores overrides under.
 * @returns the MCP and LSP adapters for that reconciler.
 */
export function createRuntimeMounts(ctx: Context, dataRoot: string): RuntimeMounts {
  return { mcp: createSharedMcpMount(ctx, dataRoot), lsp: new LspMountRegistry(ctx) }
}
