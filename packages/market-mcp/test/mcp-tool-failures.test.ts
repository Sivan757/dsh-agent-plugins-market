/**
 * What a failed MCP tool call says.
 *
 * A dead transport rejects with the SDK's two words — "Not connected" — which
 * names neither the server nor what the supervisor is doing, so a model reads it
 * as the tool's own verdict and moves on. These cases pin the rewritten message:
 * the public tool name, the server, the phase with its attempt budget, and the
 * underlying error, while a server-side failure and a caller cancellation keep
 * their own words.
 *
 * @module test/mcp-tool-failures
 */
import { describe, expect, it } from 'vitest'
import { syncTools, type ToolBridgeOptions, type ToolDefinition, type ToolHost } from '../src/runtime/mcp/bridge/tools.js'
import type { McpConnectionObservation } from '../../market-contracts/src/contracts/mcp-status.js'

const OBSERVATION: McpConnectionObservation = {
  serverName: 'flappy',
  phase: 'reconnecting',
  since: 0,
  attempt: 3,
  maxAttempts: 10,
  retryAt: Date.now() + 2_000,
  error: 'Client network socket disconnected'
}

/** A client whose tool listing works and whose call runs a caller-supplied failure. */
function clientOf(call: () => Promise<unknown>): never {
  return {
    request: async (request: { method: string }) =>
      request.method === 'tools/list' ? { tools: [{ name: 'flap', description: 'Say flap.', inputSchema: { type: 'object', properties: {} } }] } : call()
  } as never
}

/** A host stub that keeps the registered definitions. */
function hostOf(): { host: ToolHost; definitions: ToolDefinition[] } {
  const definitions: ToolDefinition[] = []
  return {
    host: {
      logger: { error: () => {}, warn: () => {}, info: () => {} },
      tools: {
        register(definition) {
          definitions.push(definition)
          return () => {}
        }
      }
    },
    definitions
  }
}

/** Sync one tool and run it, returning the rejection message. */
async function failureOf(call: () => Promise<unknown>, options: { connection?: () => McpConnectionObservation | undefined; aborted?: boolean } = {}): Promise<string> {
  const { host, definitions } = hostOf()
  const opts: ToolBridgeOptions = {
    registrationFailure: 'contain',
    serverName: 'flappy',
    toolCallTimeoutMs: 1_000,
    ...(options.connection === undefined ? {} : { connection: options.connection })
  }
  await syncTools(clientOf(call), host, opts, new Map())
  const controller = new AbortController()
  if (options.aborted === true) controller.abort()
  try {
    await definitions[0]?.execute({}, { signal: controller.signal })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('the call was expected to fail')
}

describe('MCP tool failure attribution', () => {
  it('names the tool, the server, and the reconnect the call died in', async () => {
    const message = await failureOf(() => Promise.reject(new Error('Not connected')), { connection: () => OBSERVATION })

    expect(message).toContain('mcp__flappy__flap failed')
    expect(message).toContain('MCP server "flappy" is not reachable')
    expect(message).toContain('reconnecting, attempt 3/10, next retry in about')
    expect(message).toContain('this call never reached it')
    expect(message).toContain('Not connected')
  })

  it('says when reconnecting has stopped entirely', async () => {
    const message = await failureOf(() => Promise.reject(new Error('socket hang up')), {
      connection: () => ({ ...OBSERVATION, phase: 'failed' })
    })

    expect(message).toContain('reconnecting has stopped')
    expect(message).toContain('mcp__flappy__flap failed')
  })

  it('omits the phase when the supervisor has published none', async () => {
    const message = await failureOf(() => Promise.reject(new Error('fetch failed')))

    expect(message).toContain('MCP server "flappy" is not reachable, so this call never reached it')
  })

  it('leaves a server-side tool error in its own words', async () => {
    const message = await failureOf(() => Promise.reject(new Error('argument "path" is required')))

    expect(message).toBe('argument "path" is required')
  })

  it('leaves a cancelled call in its own words', async () => {
    const message = await failureOf(() => Promise.reject(new Error('Not connected')), {
      connection: () => OBSERVATION,
      aborted: true
    })

    expect(message).toBe('Not connected')
  })
})
