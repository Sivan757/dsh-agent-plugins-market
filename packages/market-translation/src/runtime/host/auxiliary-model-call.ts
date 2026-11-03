/**
 * The auxiliary model call this plugin makes outside an agent loop.
 *
 * Two features need one: translation, which rewords text for the reader, and drafting, which
 * turns an intent into an artifact. Both answer the same three questions — which model, how
 * hard should it think, and how do we read the answer — so the answers live here rather than
 * in each caller.
 *
 * The route is always the deployment's own default model. The plugin never picks a model and
 * never asks for a credential: a deployment with no default model gets no call, which the
 * caller reports as a configuration problem rather than as a failure.
 *
 * @module runtime/host/auxiliary-model-call
 */
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { FinishReason, StreamChunk } from '@deepseek-ai/dsh-llm'

/** The host seams this module reads; every one is optional at composition. */
export interface AuxiliaryCallHost {
  get?(name: string): unknown
}

/** The default-model service the harness exposes as agentDefaultModel. */
interface DefaultModelService {
  currentSelection(): { provider: string; model: string; reasoningEffort?: unknown }
}

/** The LLM service surface these calls use. */
export interface AuxiliaryLlm {
  stream(options: unknown): AsyncIterable<StreamChunk>
  /** Validates an explicit effort against the exact model, rejecting unsupported ones. */
  resolveCallConfig?(config: { provider: string; model: string; reasoningEffort?: string }, signal?: AbortSignal): Promise<unknown>
}

/** The route one call resolved. */
export interface AuxiliaryRoute {
  provider: string
  model: string
  /** The effort the deployment's own selection carries, when it names one. */
  reasoningEffort?: string
}

/**
 * Read the deployment's default model, at call time.
 *
 * Services provision after apply() returns, so a value captured at mount would stay undefined
 * for the life of the process: every call re-reads the selection.
 * @param host - the plugin context, read structurally so tests can pass a stub.
 * @returns the route, or undefined when no model is configured yet.
 */
export function readDefaultModelRoute(host: AuxiliaryCallHost): AuxiliaryRoute | undefined {
  try {
    const service = host.get?.('agentDefaultModel') as DefaultModelService | undefined
    const selection = service?.currentSelection()
    if (selection === undefined) return undefined
    if (typeof selection.provider !== 'string' || typeof selection.model !== 'string') return undefined
    if (selection.provider.length === 0 || selection.model.length === 0) return undefined
    const effort = typeof selection.reasoningEffort === 'string' && selection.reasoningEffort.length > 0 ? selection.reasoningEffort : undefined
    return { provider: selection.provider, model: selection.model, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
  } catch {
    // A half-provisioned service is indistinguishable from an absent one.
    return undefined
  }
}

/**
 * The LLM service these calls stream through.
 * @param host - the plugin context, read structurally.
 * @returns the service, or undefined when the deployment has no model layer at all.
 */
export function auxiliaryLlmOf(host: AuxiliaryCallHost): AuxiliaryLlm | undefined {
  return host.get?.('llm') as AuxiliaryLlm | undefined
}

/**
 * Ask for the cheapest effort the route accepts.
 *
 * Both translation and drafting are mechanical work, and the adapter default is high: leaving
 * the effort unset spends reasoning tokens on calls that do not need them. The deployment's
 * own explicit choice still wins.
 * @param llm - live LLM runtime owning effort validation, when it exposes it.
 * @param route - the resolved provider/model route.
 * @param signal - cancellation for the capability lookup.
 * @returns the effort to send, or undefined to accept the adapter default.
 */
export async function chooseOffEffort(llm: AuxiliaryLlm, route: AuxiliaryRoute, signal: AbortSignal): Promise<string | undefined> {
  if (route.reasoningEffort !== undefined) return route.reasoningEffort
  if (llm.resolveCallConfig === undefined) return undefined
  try {
    await llm.resolveCallConfig({ provider: route.provider, model: route.model, reasoningEffort: 'off' }, signal)
    return 'off'
  } catch {
    // The route does not accept off; fall back to its own default.
    return undefined
  }
}

/**
 * Translate a terminal finish reason into an auxiliary-call failure.
 * @param finish - the assembled finish reason.
 * @param truncatedMessage - what a token-cap stop means to this caller.
 * @returns the error to throw, or undefined when the stream ended normally.
 */
export function auxiliaryFinishError(finish: FinishReason, truncatedMessage: string): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return Object.assign(new Error(truncatedMessage), { code: 'AUXILIARY_TRUNCATED' })
    case 'tool-calls':
      return new Error('an auxiliary call unexpectedly requested a tool')
    default:
      return new Error('an auxiliary call stopped for an unsupported reason: ' + String((finish as { kind?: unknown }).kind))
  }
}

/**
 * Collect the assistant text from one stream, rejecting on a terminal failure.
 * @param stream - the chunk stream from the LLM service.
 * @param signal - cancellation, checked between chunks.
 * @param truncatedMessage - what a token-cap stop means to this caller.
 * @param options.join - how to join the text blocks; translation wants spaces, drafting none.
 * @param options.emptyMessage - what an empty answer means to this caller; absent accepts one.
 * @returns the assembled assistant text.
 */
export async function collectAuxiliaryText(
  stream: AsyncIterable<StreamChunk>,
  signal: AbortSignal,
  truncatedMessage: string,
  options: { join?: string; emptyMessage?: string } = {}
): Promise<string> {
  const assembler = new BlockAssembler()
  for await (const chunk of stream) {
    signal.throwIfAborted()
    assembler.push(chunk)
  }
  signal.throwIfAborted()
  const terminal = auxiliaryFinishError(assembler.finish, truncatedMessage)
  if (terminal !== undefined) throw terminal
  const blocks = assembler.blocks()
  const text = blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(options.join ?? ' ')
    .trim()
  if (text.length === 0 && options.emptyMessage !== undefined) throw new Error(options.emptyMessage)
  return text
}
