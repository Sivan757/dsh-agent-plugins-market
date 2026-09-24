/**
 * Structural mirrors of the harness tool-registration surface the bridge
 * registers against: the runtime accepts the same object shape the upstream
 * `@deepseek-ai/dsh-tools` bridge registers, so the model-facing behavior is
 * identical. Mirrored rather than imported so the market never loads a second
 * copy of the host runtime.
 *
 * @module runtime/mcp-client/host-contract
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonSchemaNode } from './json-schema-subset.js'

/** Lossless JSON value vocabulary the bridge exchanges with the registry. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** Canonical MCP result exposed to Code Mode without discarding protocol blocks. */
export type McpResult<Structured extends JsonValue = JsonValue> = {
  content: JsonValue[]
  structuredContent?: Structured
}

/** The agent on whose behalf a tool call runs (structural mirror). */
interface ToolExecutionAgent {
  session?: { requestHeader?: () => { config?: { provider?: string; model?: string } } | undefined }
  options?: { provider?: string; model?: string }
}

/** Execution identity handed to a tool body (structural mirror). */
export interface ToolExecution {
  /** Caller-owned cancellation for this invocation. */
  readonly signal: AbortSignal
  /** The calling agent, when the call came from one. */
  readonly agent?: ToolExecutionAgent
}

/** A settled tool outcome (structural mirror). */
export interface ToolExecutionResult {
  readonly value: JsonValue
  readonly content: ContentBlock[]
  readonly isError: boolean
}

/** One registered tool (structural mirror of the host registration shape). */
export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: JsonSchemaNode
    render(args: unknown, value: JsonValue): ContentBlock[]
  }
  execute(args: unknown, exec: ToolExecution): Promise<unknown>
  finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined
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
