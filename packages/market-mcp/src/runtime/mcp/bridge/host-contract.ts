/**
 * The host's tool registration contract, named in one place.
 *
 * The bridge hands its tools to the host's registry, so the shapes it hands over are the
 * host's own. This module used to mirror them by hand — the host's `ToolDefinition`,
 * `ToolExecution` and `ToolExecutionResult` written out field by field — and the mirror
 * drifted: the host's result is a discriminated union whose failure variant carries no
 * `value`, and the host's execution context grew the call identity, the parsed arguments
 * and the step admission. A hand-written copy of a discriminated union is exactly what a
 * compiler cannot check, so the drift surfaced only as a cast at the registration seam.
 *
 * The host's shapes are therefore taken from the host — imported TYPE-ONLY, so the market
 * still loads no second copy of the host runtime — and the compiler now checks the
 * bridge's definitions against the host's real contract instead of against a copy of it.
 *
 * What stays written here is the plugin's own side of the seam: the execution facts the
 * bridge reads, and the `ToolHost` it talks to. Both are consumer shapes rather than
 * copies of the host's, and both are checked against the host where it matters: the
 * definition the bridge registers must satisfy the host's `ToolDefinition`.
 *
 * @module runtime/mcp-client/host-contract
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition as HostToolDefinition, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/**
 * The execution facts the bridge reads.
 *
 * The host's execution context carries the call identity, the parsed arguments, the step
 * admission and an executor-assigned token. The bridge needs two of them: the caller's
 * cancellation, and the calling agent — because a result carrying an image is stored
 * against the model route that will read it. The agent is optional here: a tool may run
 * outside a session, and the bridge then refuses the image rather than guessing a route.
 */
export interface BridgeExecution {
  readonly signal: AbortSignal
  readonly agent?: Agent
}

/**
 * The host's registered-tool shape, with the execution context the bridge reads.
 *
 * Everything but the execution body is the host's own declaration, so the output schema,
 * the projection callbacks and the presentation hooks are checked against the contract
 * the host enforces. The execution body takes the facts the bridge reads: the host's
 * context satisfies them, so a definition built here registers on the host's registry
 * without a cast.
 */
export interface ToolDefinition extends Omit<HostToolDefinition, 'execute'> {
  execute(args: unknown, exec: BridgeExecution): Promise<unknown>
}

/**
 * The host's execution context and its settled outcome.
 *
 * The outcome is the host's discriminated union: a success carries the canonical value, a
 * failure carries the error and no value. The bridge's finalization reads the value only
 * on the success branch, which the union is what makes checkable.
 */
export type { ToolExecution, ToolExecutionResult }

/**
 * Lossless JSON value vocabulary the bridge exchanges with the registry.
 *
 * The host keeps its own `JsonValue` in a package this plugin does not depend on; the
 * vocabulary is the same one (null, boolean, number, string, array, string-keyed object),
 * so a value written here is a value the host's schema accepts.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** Canonical MCP result exposed to Code Mode without discarding protocol blocks. */
export type McpResult<Structured extends JsonValue = JsonValue> = {
  content: JsonValue[]
  structuredContent?: Structured
}

/**
 * The host surface the bridge needs: a tool registry, a logger, and the two
 * optional services image projection consults. Structural — the cordis
 * context is adapted onto this shape by the bridge shell.
 */
export interface ToolHost {
  readonly logger: { error(message: string): void; warn(message: string): void; info(message: string): void }
  readonly tools: { register(definition: ToolDefinition): () => void }
  /** Optional service lookup; image projection degrades when absent. */
  getService?(name: 'attachments' | 'llm'): unknown
}
