/**
 * Translate a batch of texts through the host's own LLM service.
 *
 * This is the only place the translation layer talks to a model. It follows the
 * harness auxiliary-call shape (packages/session/session-title-llm): resolve a
 * route, stream through ctx.llm.stream, assemble the chunks with
 * BlockAssembler, and reject on a terminal finish reason.
 *
 * The route is the user default model, read at call time from
 * agentDefaultModel -- the same selection the harness uses for its own
 * auxiliary calls, so the market never invents a model the deployment did not
 * configure. purpose is deliberately omitted: the published
 * GenerateOptions.purpose accepts only compaction and session-title, and
 * neither describes a translation. Omitting it keeps the call on the ordinary
 * route with no model-hidden transport metadata.
 * @module runtime/host/llm-translator
 */
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { FinishReason, GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { pluginMarketSource } from './plugin-message-source.js'
import type { TranslationProvider } from '../../application/translation/chain.js'

/** The host seams this translator reads; every one is optional at composition. */
interface TranslatorHost {
  get?(name: string): unknown
}

/** The default-model service the harness exposes as agentDefaultModel. */
interface DefaultModelService {
  currentSelection(): { provider: string; model: string; reasoningEffort?: unknown }
}

/** The LLM service surface this translator calls. */
interface LlmService {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  /** Validates an explicit effort against the exact model, rejecting unsupported ones. */
  resolveCallConfig?(config: { provider: string; model: string; reasoningEffort?: string }, signal?: AbortSignal): Promise<unknown>
}

/** The route this translator resolved for one call. */
interface TranslationRoute {
  provider: string
  model: string
  /** The effort the caller own selection carries, when it names one. */
  reasoningEffort?: string
}

/** Bound the call: a stalled model must not pin a translation slot forever. */
const TRANSLATE_TIMEOUT_MS = 30_000

/** One text worth of output; a batch asks for a multiple of this. */
const MAX_OUTPUT_TOKENS_PER_ITEM = 512

/** Ceiling for one batch, so a large one cannot ask for an unbounded generation. */
const MAX_OUTPUT_TOKENS_CAP = 4_096

/**
 * Batch separator: a line holding only two percent signs.
 *
 * A model asked to translate several segments at once needs an unambiguous
 * boundary, and this one cannot appear inside ordinary prose.
 */
const BATCH_SEPARATOR = '\n\n%%\n\n'
const BATCH_SEPARATOR_PATTERN = /\r?\n[ \t]*%%[ \t]*\r?\n/

/**
 * Stable instruction; the target language and the batch flag are the variables.
 * @param locale - target locale id.
 * @param batched - whether the user turn carries several segments.
 * @returns the system prompt for this call.
 */
function systemPrompt(locale: string, batched: boolean): string {
  const lines = [
    'You translate plugin marketplace text for a developer tool.',
    'Translate the user text into ' + (locale === 'zh' ? 'Simplified Chinese' : locale) + '.',
    'Preserve product names, package names, acronyms (MCP, LSP, DSH, CLI), and URLs exactly as written.',
    'Keep the tone factual and concise. Output the translation alone: no quotes, no notes, no alternatives.'
  ]
  if (batched) {
    lines.push(
      'The input holds several segments separated by a line containing only two percent signs.',
      'Return the same number of segments in the same order, separated the same way.',
      'Never use that separator for anything else, and never merge or split segments.'
    )
  }
  return lines.join(' ')
}

/**
 * The user turn carrying the text.
 *
 * Built through the host factory rather than as a literal: a UserMessage
 * carries a stable id and a source tag, and hand-writing one would fabricate
 * both. The source is this plugin declared producer identity -- the turn is an
 * instruction this plugin sends, not text the user typed.
 * @param text - the masked text to translate.
 * @returns the user message to send.
 */
function userMessage(text: string): Message {
  return createUserMessage({ content: [{ type: 'text', text }], source: pluginMarketSource() })
}

/**
 * Read the route the deployment selected, or undefined.
 * @param host - the plugin context, read structurally.
 * @returns the resolved route, or undefined when no model is configured.
 */
function readRoute(host: TranslatorHost): TranslationRoute | undefined {
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
 * Choose the reasoning effort for one translation call.
 *
 * Translating a sentence is mechanical, and the DeepSeek adapter default is
 * high -- leaving the effort unset would spend reasoning tokens on every one of
 * hundreds of texts. So the call asks for off first and keeps the user own
 * selection only if the route refuses it: an unsupported effort rejects at
 * validation rather than reaching the provider, and a model that genuinely
 * requires reasoning still gets a working call instead of a failure.
 *
 * The user selection is forwarded rather than overridden when it is already
 * explicit, because that is a choice they made for this deployment.
 * @param llm - live LLM runtime owning effort validation, when it exposes it.
 * @param route - the resolved provider/model route.
 * @param signal - cancellation for the capability lookup.
 * @returns the effort to send, or undefined to accept the adapter default.
 */
async function chooseEffort(llm: LlmService, route: TranslationRoute, signal: AbortSignal): Promise<string | undefined> {
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
 * @returns the error to throw, or undefined when the stream ended normally.
 */
function finishError(finish: FinishReason): Error | undefined {
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
      return new Error('translation reached the output token limit')
    case 'tool-calls':
      return new Error('translation unexpectedly requested a tool')
    default:
      return new Error('translation stopped for an unsupported reason: ' + String((finish as { kind?: unknown }).kind))
  }
}

/**
 * Collect the assistant text from one stream, rejecting on a terminal failure.
 * @param stream - the chunk stream from the LLM service.
 * @param signal - cancellation, checked between chunks.
 * @returns the assembled assistant text.
 */
async function collectText(stream: AsyncIterable<StreamChunk>, signal: AbortSignal): Promise<string> {
  const assembler = new BlockAssembler()
  for await (const chunk of stream) {
    signal.throwIfAborted()
    assembler.push(chunk)
  }
  signal.throwIfAborted()
  const terminal = finishError(assembler.finish)
  if (terminal !== undefined) throw terminal
  const blocks = assembler.blocks()
  const text = blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
    .trim()
  if (text.length === 0) throw new Error('the model returned no text')
  return text
}

/**
 * Build the model-backed provider over one plugin context.
 *
 * Every read is deferred to the call, because the LLM and default-model
 * services provision after apply() returns; a value captured here would stay
 * undefined for the life of the process. available() therefore re-resolves the
 * route on each question, and a deployment with no model configured never
 * queues work nothing can complete.
 * @param host - the plugin context, read structurally so tests can pass a stub.
 * @returns a provider bound to this context.
 */
export function createLlmTranslator(host: TranslatorHost): TranslationProvider {
  return {
    id: 'llm',
    available: () => readRoute(host) !== undefined && host.get?.('llm') !== undefined,
    async translate(request): Promise<string[]> {
      const llm = host.get?.('llm') as LlmService | undefined
      const route = readRoute(host)
      if (llm === undefined || route === undefined) throw new Error('the DSH model service is unavailable')
      const texts = request.texts
      if (texts.length === 0) return []
      const batched = texts.length > 1
      // One controller merges caller cancellation with the call deadline, so a
      // stalled provider cannot hold a translation slot open.
      const controller = new AbortController()
      const onAbort = (): void => controller.abort()
      request.signal.addEventListener('abort', onAbort, { once: true })
      const timeout = setTimeout(onAbort, TRANSLATE_TIMEOUT_MS)
      timeout.unref?.()
      try {
        const effort = await chooseEffort(llm, route, controller.signal)
        const options: GenerateOptions = {
          provider: route.provider,
          model: route.model,
          system: systemPrompt(request.locale, batched),
          messages: [userMessage(batched ? texts.join(BATCH_SEPARATOR) : (texts[0] ?? ''))],
          maxTokens: Math.min(MAX_OUTPUT_TOKENS_PER_ITEM * texts.length, MAX_OUTPUT_TOKENS_CAP),
          temperature: 0,
          ...(effort === undefined ? {} : { reasoningEffort: effort as GenerateOptions['reasoningEffort'] }),
          signal: controller.signal
        }
        const answer = await collectText(llm.stream(options), controller.signal)
        if (!batched) return [answer]
        const segments = answer.split(BATCH_SEPARATOR_PATTERN).map(segment => segment.trim())
        if (segments.length !== texts.length) {
          throw new Error('the model returned ' + String(segments.length) + ' of ' + String(texts.length) + ' segments')
        }
        return segments
      } finally {
        clearTimeout(timeout)
        request.signal.removeEventListener('abort', onAbort)
      }
    }
  }
}
