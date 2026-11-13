/**
 * Claude Code command argument expansion: `$ARGUMENTS`, `$1`-`$N`, and the
 * named placeholders a command declares in its `arguments:` frontmatter.
 *
 * A command body is a prompt template, and the dialect fills it from the
 * invocation text before the model reads it. One pass over the author text
 * treats three placeholder spellings: `$ARGUMENTS` (the whole trimmed input),
 * `$1`-`$9` (one positional argument each), and `$name` for each declared
 * name, bound positionally in declaration order. Every other dollar sequence
 * stays literal, so `$HOME`, a shell variable, and text that merely starts
 * with a dollar reach the model as the author wrote them.
 *
 * The invocation text splits the way Claude Code splits it: on whitespace,
 * except that a single- or double-quoted segment stays inside its argument.
 * Quotes are removed from the value. There is no escape syntax, and an
 * unterminated quote runs to the end of the input.
 *
 * A body with no placeholder is left exactly as its author wrote it: the
 * invocation text already travels in the forwarded message's `ARGUMENTS:`
 * trailer, so appending it again to the body would say the same thing twice and
 * would put a label the author never wrote into authored prose. Placeholders
 * expand inside code fences exactly as elsewhere: the suites that declare them
 * also write argument references inside shell snippets the model is meant to run
 * with those values.
 * @module application/command-arguments
 */

/** One command body with the invocation text filled in. */
export interface CommandExpansion {
  /** The prompt the model receives. */
  text: string
  /**
   * Placeholders the body used and the invocation text left unfilled, in body
   * order, spelled as the author wrote them (`$system`, `$2`). An unfilled
   * declared argument expands to nothing, so this list is what makes the gap
   * visible to the person who typed the command.
   */
  missing: string[]
}

/** The label `forwardCommandText` puts before the invocation text it carries. */
export const ARGUMENTS_TRAILER_LABEL = 'ARGUMENTS: '

/** One substitution pass, so a value containing a dollar sequence is never re-read. */
const PLACEHOLDER = /\$(ARGUMENTS|[A-Za-z_][A-Za-z0-9_]*|[1-9])/g

/**
 * Split invocation input on whitespace, keeping each quoted segment whole.
 *
 * @param rawInput - the text the user typed after the command name.
 * @returns the arguments in order; quotes are removed, and an empty quoted
 * segment produces an empty argument.
 */
export function splitCommandInput(rawInput: string): string[] {
  const tokens: string[] = []
  let current = ''
  /** Whether a token has started, so `""` yields one empty argument. */
  let started = false
  let quote: '"' | "'" | undefined
  for (const character of rawInput) {
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (/\s/.test(character)) {
      if (started) tokens.push(current)
      current = ''
      started = false
      continue
    }
    current += character
    started = true
  }
  if (started) tokens.push(current)
  return tokens
}

/**
 * Fill one command body from the invocation text.
 *
 * @param body - the author's body, with plugin path variables already expanded.
 * @param rawInput - the text the user typed after the command name.
 * @param declared - the names the `arguments:` frontmatter declares, in order.
 * @returns the prompt text and the placeholders that had no value.
 */
export function expandCommandArguments(body: string, rawInput: string | undefined, declared: readonly string[] = []): CommandExpansion {
  // A host line that types `rawInput` as required can still deliver nothing for
  // a command typed with no trailing text; a phrase command must never fail on it.
  const input = (rawInput ?? '').trim()
  const tokens = splitCommandInput(input)
  const declaredIndex = new Map(declared.map((name, index) => [name, index]))
  const missing: string[] = []
  const noteMissing = (placeholder: string): void => {
    if (!missing.includes(placeholder)) missing.push(placeholder)
  }
  const text = body.replace(PLACEHOLDER, (match: string, token: string) => {
    if (token === 'ARGUMENTS') return input
    if (/^[1-9]$/.test(token)) {
      const value = tokens[Number(token) - 1]
      if (value === undefined) {
        noteMissing(match)
        return ''
      }
      return value
    }
    const index = declaredIndex.get(token)
    if (index === undefined) return match
    const value = tokens[index]
    if (value === undefined) {
      noteMissing(match)
      return ''
    }
    return value
  })
  return { text, missing }
}
