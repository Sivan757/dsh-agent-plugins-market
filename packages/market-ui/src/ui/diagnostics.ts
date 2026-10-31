/**
 * The facts a failure report needs, in one block a person can paste.
 *
 * Reading a failure out of a screenshot loses the endpoint, the transport and the
 * exact cause wording; asking the reader to retype them loses the timestamps. This
 * builds the same text for every surface that can fail to mount something, so a
 * report reads the same whether it came from a connector or a language server.
 *
 * @module client/ui/diagnostics
 */

/** One labelled fact. Fixed order, because a report is read, not parsed. */
export interface DiagnosticsFact {
  label: string
  value: string
}

/** What the block says above the facts. */
export interface DiagnosticsInput {
  /** The surface the facts came from, already localized. */
  surface: string
  /** The item's name, so a list of failures can be told apart. */
  name: string
  /** Its state, already localized. */
  state: string
  facts: DiagnosticsFact[]
  /** Extra sentences, one per classified cause. */
  causes?: string[]
  /** When the panel observed this, as an ISO timestamp. */
  observedAt?: string
}

/**
 * Render the block.
 *
 * Keys are plain text rather than a locale table: the labels name the host's data
 * fields (endpoint, transport, tools) and a translated key would make the block
 * harder to match against a log. The values are whatever the panel already shows.
 *
 * @param input - the surface, the item and the facts the panel knows.
 * @returns the text to copy, without a trailing newline.
 */
export function diagnosticsText(input: DiagnosticsInput): string {
  const lines = ['dsh-agent-plugins-market · ' + input.surface + ' · ' + input.name, 'state: ' + input.state]
  for (const fact of input.facts) {
    if (fact.value === '') continue
    lines.push(fact.label + ': ' + fact.value)
  }
  if (input.causes !== undefined && input.causes.length > 0) {
    lines.push('causes:')
    for (const cause of input.causes) lines.push('  - ' + cause)
  }
  if (input.observedAt !== undefined) lines.push('observed: ' + input.observedAt)
  return lines.join('\n')
}

/**
 * Copy text, reporting whether it worked.
 *
 * The clipboard API rejects when the document is not focused, which happens when a
 * dialog opens from a keyboard shortcut; a caller that assumed success would claim
 * a copy that never happened.
 *
 * @param text - the text to place on the clipboard.
 * @returns true when the browser accepted it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
