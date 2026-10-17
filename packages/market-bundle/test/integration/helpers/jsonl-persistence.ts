import * as persistenceModule from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { Context } from '@deepseek-ai/cordis'

/**
 * The JSONL persistence plugin, in whichever export shape the installed host uses.
 *
 * 0.2.0-rc.2 exports the plugin class as its default export; 0.2.1-alpha.4 exports
 * the same plugin as the named `apply` function beside `name` and `Config`.
 * Reading it here keeps one suite runnable on either host release line.
 */
export const jsonlPersistencePlugin = ((persistenceModule as { default?: unknown }).default ?? persistenceModule) as Parameters<Context['plugin']>[0]
