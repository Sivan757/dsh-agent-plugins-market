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
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { registerOwnedBridgeTool } from './tool-ownership.js'
import { resolveReconnectPolicy, startConnection } from './connection.js'
import { validateConfig } from '../../../application/mcp/mcp-bridge-config.js'
import type { Config } from '../../../application/mcp/mcp-bridge-config.js'
import { resolveDeclaredCommand } from '../../../../../market-runtime/src/index.js'
import { optionalService } from '../../../../../market-runtime/src/index.js'
import type { ToolHost } from './tools.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'market-mcp-client'

/** Services required by this plugin. */
export const inject = ['tools']

/**
 * Live `serverName` reservations per registration scope, or per app for global mounts.
 * Agents may mount the same server namespace independently. A duplicate
 * namespace is a configuration error surfaced at plugin load, never silent
 * shadowing. The mount registry deduplicates too; this is the last line of
 * defense for direct programmatic loads.
 */
const activeServerNames = new WeakMap<object, Set<string>>()

/** Adapt the cordis context onto the structural host the bridge modules use. */
function toToolHost(ctx: Context, serverName: string): ToolHost {
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
        return registerOwnedBridgeTool(ctx, serverName, definition, () => register.call(registry.tools, definition))
      }
    },
    getService: serviceName => optionalService(ctx, serviceName)
  }
}

/**
 * Resolve one stdio command before the SDK spawns it, extending the child
 * `PATH` from the login shell only when the current environment cannot find
 * the command.
 *
 * An explicit `env.PATH` is the author's or user's declaration and is never
 * touched: the bridge respects it verbatim and does not even probe. Without
 * one, the child inherits the scrubbed parent `PATH`; when that cannot resolve
 * the command (the desktop case, where `npx` is absent) the login shell's
 * directories are appended, and the extension travels beside the config as
 * `config.env.PATH`.
 *
 * Resolution never rejects: a command that stays unresolved keeps today's
 * behavior (a spawn that fails with its own `ENOENT`), and the searched `PATH`
 * is returned as a diagnostic so the failure can say what was tried.
 */
async function resolveStdioCommand(ctx: Context, config: Config): Promise<{ config: Config; diagnostic?: string }> {
  if (config.transport !== 'stdio') return { config }
  const resolution = await resolveDeclaredCommand(ctx, config.command, config.env)
  if (resolution === undefined) return { config }
  const { path, diagnostic } = resolution
  const resolved = path === undefined ? config : { ...config, env: { ...config.env, PATH: path } }
  return { config: resolved, ...(diagnostic === undefined ? {} : { diagnostic }) }
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
  const resolution = await resolveStdioCommand(ctx, config)
  const resolvedConfig = resolution.config
  const reconnect = resolveReconnectPolicy(resolvedConfig.reconnect, `mcp-client(${resolvedConfig.serverName}): reconnect`)

  // Reserve the namespace next: a duplicate `serverName` fails THIS instance
  // at load with an actionable error and leaves the earlier instance intact.
  ctx.effect(() => {
    const owner = scopeOf(ctx) ?? ctx.root
    let names = activeServerNames.get(owner)
    if (!names) {
      names = new Set()
      activeServerNames.set(owner, names)
    }
    if (names.has(resolvedConfig.serverName)) {
      throw new Error(`market-mcp-client: serverName "${resolvedConfig.serverName}" is already in use by another bridge instance — pick a unique serverName`)
    }
    names.add(resolvedConfig.serverName)
    return () => void names.delete(resolvedConfig.serverName)
  }, 'market-mcp-client.serverName')

  // The supervisor owns the client/transport generations, the reconnect
  // loop, and the live tool registrations; disposal stops reconnection,
  // quiesces in-flight work, and unregisters the current generation.
  // Optional service: the credential store receives OAuth tokens when
  // mounted; absence (no credentials plugin) is the supported
  // no-persistence configuration.
  const host = toToolHost(ctx, resolvedConfig.serverName)
  const credentials = optionalService(ctx, 'credentials')
  const connection = startConnection(host, resolvedConfig, reconnect, credentials)

  ctx.effect(() => {
    return () => connection.dispose()
  }, 'market-mcp-client.connection')

  // Block plugin activation on the initial connection + tool discovery so
  // Cordis consumers observe the tools immediately after the fiber activates.
  // When failOnStartupError is true, a failed initial attempt rejects the
  // fiber (Cordis rolls it back); otherwise the error is logged and the
  // supervisor enters its reconnect loop.
  const outcome = await connection.ready
  if (outcome.error !== undefined && resolvedConfig.failOnStartupError) {
    // The resolution fact explains why the spawn failed (or what was searched),
    // so it rides the cause chain into the mount diagnostic ahead of the raw
    // spawn error. On the happy path there is nothing to add and the chain is
    // exactly today's.
    const cause = resolution.diagnostic === undefined ? outcome.error : new Error(resolution.diagnostic, { cause: outcome.error })
    throw new Error(`mcp-client(${resolvedConfig.serverName}): initial connection or tool synchronization failed`, { cause })
  }
  // A command that resolved only after the login shell extended PATH leaves a
  // trace, so "why does this work now" is answerable from the log. With
  // failOnStartupError=false a failed resolution reaches here too; the env.PATH
  // guard excludes it, because PATH is only set on a successful extension —
  // the transport check is the narrowing that makes env exist at all.
  if (resolvedConfig.transport === 'stdio' && resolvedConfig.env.PATH !== undefined && resolution.diagnostic !== undefined) {
    ctx.logger?.info?.(`market-mcp-client(${resolvedConfig.serverName}): ${resolution.diagnostic}`)
  }
}
