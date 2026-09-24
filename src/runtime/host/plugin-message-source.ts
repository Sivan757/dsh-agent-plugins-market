/**
 * Message source this plugin declares for the bodies it injects as follow-up
 * messages: suite command bodies and user command bodies ride the receiving
 * agent's inbox with their producer identity attached. The host's message
 * sources are merge-extensible — each producer declares its own kind through a
 * module augmentation, and consumers fall through unknown kinds.
 * @module runtime/plugin-message-source
 */
import type { UserMessage } from '@deepseek-ai/dsh-llm'

/** Producer identity of every follow-up message this plugin injects. */
export interface PluginMarketSource {
  kind: 'plugin-market'
  /** The injected body is author-written instruction text: a suite or user command body. */
  form: 'instructions'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin-market': PluginMarketSource
  }
}

/** Build the source for one follow-up message; fresh per message, no shared state. */
export function pluginMarketSource(): PluginMarketSource {
  return { kind: 'plugin-market', form: 'instructions' }
}

/** A follow-up message this plugin injects. */
export type PluginMarketMessage = UserMessage
