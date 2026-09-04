/**
 * The market's self-built MCP client bridge plugin: connects to one external
 * MCP server and registers its tools on the harness ToolRuntime under
 * server-qualified public names (`mcp__<serverName>__<rawName>`). One plugin
 * instance per server; the mount registry loads instances through
 * `ctx.plugin` exactly like the host's own client, so reconcile, retry,
 * rollback, and HMR semantics are unchanged.
 *
 * Namespace plugin (named exports, no default export). Lifecycle is
 * effect-scoped: disposal disconnects from the server, unregisters all tools,
 * and releases the `serverName` namespace reservation. HMR hot-swaps by
 * disposing the old instance and creating a new one; identical `serverName`
 * reproduces identical public tool names.
 *
 * This replaces the runtime dependency on the host's `dsh-mcp-client`
 * package: stdio, Streamable HTTP (with OAuth 2.1), and legacy SSE all run
 * inside this plugin from the market's own `@modelcontextprotocol/sdk`
 * dependency.
 *
 * @module runtime/mcp-client/bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolveReconnectPolicy, startConnection } from './connection.js'
import { validateConfig } from './config.js'
import type { Config } from './config.js'
import type { ToolHost } from './tools.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'market-mcp-client'

/** Services required by this plugin. */
export const inject = ['tools']

/**
 * Live `serverName` reservations per app, keyed off `ctx.root` (multiple apps
 * in one process — tests — must not see each other's names). A duplicate
 * namespace is a configuration error surfaced at plugin load, never silent
 * shadowing. The mount registry deduplicates too; this is the last line of
 * defense for direct programmatic loads.
 */
const activeServerNames = new WeakMap<Context, Set<string>>()

/** Tolerantly read an optional service from the cordis context. */
function optionalService(ctx: Context, serviceName: 'credentials' | 'attachments' | 'llm'): unknown {
  try {
    const reader = ctx as unknown as { get?: (name: string) => unknown }
    const service = reader.get?.(serviceName)
    // A missing service either reads as undefined or throws (cordis strict
    // mode); both mean "not mounted".
    return service === null ? undefined : service
  } catch {
    return undefined
  }
}

/** Adapt the cordis context onto the structural host the bridge modules use. */
function toToolHost(ctx: Context): ToolHost {
  const logger = {
    error: (message: string): void => {
      ctx.logger?.error?.(message)
    },
    warn: (message: string): void => {
      ctx.logger?.warn?.(message)
    },
    info: (message: string): void => {
      ctx.logger?.info?.(message)
    }
  }
  const registry = ctx as unknown as { tools?: { register?: (definition: unknown) => () => void } }
  return {
    logger,
    tools: {
      register(definition) {
        const register = registry.tools?.register
        if (typeof register !== 'function') {
          throw new Error('the host context does not expose a tool registry — the "tools" service is required')
        }
        return register.call(registry.tools, definition)
      }
    },
    getService: serviceName => optionalService(ctx, serviceName)
  }
}

/**
 * Connect one MCP server and publish its initial tool generation before
 * activation. Remains explicitly `async`: Cordis treats a prototype-bearing
 * ordinary function as a constructor, whose returned Promise is not startup
 * work.
 * @param ctx - plugin context carrying the tool registry.
 * @param config - resolved transport and server namespace configuration.
 * @returns startup readiness after connection and initial tool discovery settle.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  // Fail loud at load: programmatic construction bypasses any schema layer,
  // so every invariant is re-judged here before any effect registers.
  validateConfig(config)
  const reconnect = resolveReconnectPolicy(config.reconnect, `mcp-client(${config.serverName}): reconnect`)

  // Reserve the namespace next: a duplicate `serverName` fails THIS instance
  // at load with an actionable error and leaves the earlier instance intact.
  ctx.effect(() => {
    let names = activeServerNames.get(ctx.root)
    if (!names) {
      names = new Set()
      activeServerNames.set(ctx.root, names)
    }
    if (names.has(config.serverName)) {
      throw new Error(`market-mcp-client: serverName "${config.serverName}" is already in use by another bridge instance — pick a unique serverName`)
    }
    names.add(config.serverName)
    return () => void names.delete(config.serverName)
  }, 'market-mcp-client.serverName')

  // The supervisor owns the client/transport generations, the reconnect
  // loop, and the live tool registrations; disposal stops reconnection,
  // quiesces in-flight work, and unregisters the current generation.
  // Optional service: the credential store receives OAuth tokens when
  // mounted; absence (no credentials plugin) is the supported
  // no-persistence configuration.
  const host = toToolHost(ctx)
  const credentials = optionalService(ctx, 'credentials')
  const connection = startConnection(host, config, reconnect, credentials)

  ctx.effect(() => {
    return () => connection.dispose()
  }, 'market-mcp-client.connection')

  // Block plugin activation on the initial connection + tool discovery so
  // Cordis consumers observe the tools immediately after the fiber activates.
  // When failOnStartupError is true, a failed initial attempt rejects the
  // fiber (Cordis rolls it back); otherwise the error is logged and the
  // supervisor enters its reconnect loop.
  const outcome = await connection.ready
  if (outcome.error !== undefined && config.failOnStartupError) {
    throw new Error(`mcp-client(${config.serverName}): initial connection or tool synchronization failed`, { cause: outcome.error })
  }
}
