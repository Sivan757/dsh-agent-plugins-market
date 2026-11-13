/**
 * Message sources this plugin declares for the user-role messages it injects:
 * suite and user command bodies ride the receiving agent's inbox as instruction
 * text, and connection-health notices ride it as a one-line account of
 * something that just happened. The host's message sources are merge-extensible
 * — each producer declares its own kind through a module augmentation, and
 * consumers fall through unknown kinds.
 * @module contracts/host/plugin-message-source
 */
import type { UserMessage } from '@deepseek-ai/dsh-llm'

/** Producer identity of every follow-up message this plugin injects. */
export interface PluginMarketSource {
  kind: 'plugin-market'
  /** The injected body is author-written instruction text: a suite or user command body. */
  form: 'instructions'
}

/**
 * Producer identity of the connection-health notices this plugin injects.
 *
 * Kept apart from {@link PluginMarketSource} because the two carry different
 * context forms: instruction text is expanded and read as guidance, while a
 * notice is one event the reader can acknowledge and collapse. A consumer that
 * knows only one of them falls through the other, as the host requires.
 */
export interface PluginMarketHealthSource {
  kind: 'plugin-market-mcp'
  /** A one-off account of a connection state change; it supersedes nothing. */
  form: 'notice'
  /** One-line account of what happened, shown without expanding the row. */
  summary: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin-market': PluginMarketSource
    'plugin-market-mcp': PluginMarketHealthSource
  }
}

/** Build the source for one follow-up message; fresh per message, no shared state. */
export function pluginMarketSource(): PluginMarketSource {
  return { kind: 'plugin-market', form: 'instructions' }
}

/**
 * Build the source for one connection-health notice.
 * @param summary - the one-line account the reader sees without expanding the row.
 * @returns a fresh source value; no shared state.
 */
export function pluginMarketHealthSource(summary: string): PluginMarketHealthSource {
  return { kind: 'plugin-market-mcp', form: 'notice', summary }
}

/** A follow-up message this plugin injects. */
export type PluginMarketMessage = UserMessage
