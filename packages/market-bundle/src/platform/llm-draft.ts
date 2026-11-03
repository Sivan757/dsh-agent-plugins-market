/**
 * The host-backed model call behind a draft.
 *
 * The route, the effort choice, the stream and the terminal failures all come from the shared
 * auxiliary-call module, because translation makes the same call for the same reasons. What is
 * left here is what is specific to drafting: the bounds, the message, and the answer's shape.
 *
 * @module platform/llm-draft
 */
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { AI_DRAFT_LIMITS, type AiDraftResult } from '../../../market-contracts/src/contracts/ai-draft.js'
import { pluginMarketSource } from '../../../market-contracts/src/host/plugin-message-source.js'
import { auxiliaryFinishError, auxiliaryLlmOf, chooseOffEffort, readDefaultModelRoute, type AuxiliaryCallHost } from '../../../market-translation/src/index.js'
import type { AiDraftPort } from '../application/ai-draft.js'

/**
 * Build the host-backed drafting port over one plugin context.
 * @param host - the plugin context.
 * @returns the port the draft service calls.
 */
export function createLlmDraftPort(host: AuxiliaryCallHost): AiDraftPort {
  return {
    async complete(prompt, outerSignal): Promise<AiDraftResult> {
      const route = readDefaultModelRoute(host)
      const llm = auxiliaryLlmOf(host)
      if (route === undefined || llm === undefined) {
        throw Object.assign(new Error('no model is configured for drafting; set the default model first'), { code: 'ai-model-unconfigured' })
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), AI_DRAFT_LIMITS.timeoutMs)
      const forward = (): void => controller.abort()
      outerSignal?.addEventListener('abort', forward, { once: true })
      try {
        const effort = await chooseOffEffort(llm, route, controller.signal)
        const options: GenerateOptions = {
          provider: route.provider,
          model: route.model,
          system: prompt.system,
          messages: [createUserMessage({ content: [{ type: 'text', text: prompt.user }], source: pluginMarketSource() })],
          maxTokens: AI_DRAFT_LIMITS.maxTokens,
          temperature: 0.2,
          ...(effort === undefined ? {} : { reasoningEffort: effort as GenerateOptions['reasoningEffort'] }),
          signal: controller.signal
        }
        const assembler = new BlockAssembler()
        for await (const chunk of llm.stream(options)) {
          controller.signal.throwIfAborted()
          assembler.push(chunk)
        }
        const terminal = auxiliaryFinishError(assembler.finish, 'the draft reached the output token limit')
        if (terminal !== undefined) throw terminal
        const blocks = assembler.blocks()
        const text = blocks
          .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
          .map(block => block.text)
          .join('')
        return { text, provider: route.provider, model: route.model }
      } finally {
        clearTimeout(timeout)
        outerSignal?.removeEventListener('abort', forward)
      }
    }
  }
}
