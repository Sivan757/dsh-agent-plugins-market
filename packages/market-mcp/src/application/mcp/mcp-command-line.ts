/**
 * Repair a stdio definition whose `command` carries the whole command line.
 *
 * Every MCP README shows its server as one line — `npx -y @modelcontextprotocol/server-filesystem .`
 * — while the portable definition keeps the program and its arguments in two
 * fields. A line pasted into the command field used to be stored verbatim, so
 * the mount tried to execute `npx -y …` as a program name and reported a
 * missing command. Splitting it here is the repair the reader already expects:
 * the definition runs as written, and reopening it shows the program and the
 * arguments in their own fields.
 *
 * The split refuses the one case it cannot read: a bare path that contains a
 * space (`C:\Program Files\app.exe`) is a working command, and cutting it at
 * the first space would break it. A quoted command is unambiguous, so that form
 * splits whenever arguments follow it.
 */

/** One stdio definition, read structurally: a save must not rewrite what it cannot name. */
type ServerRecord = Record<string, unknown>

/**
 * Split one command line into words, honoring single and double quotes.
 *
 * @param line - the command line as typed.
 * @returns the words, with the quotes removed; an unterminated quote ends the last word.
 */
export function splitCommandLine(line: string): string[] {
  const words: string[] = []
  let word = ''
  let quote: '"' | "'" | undefined
  let started = false
  for (const character of line) {
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else word += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (character === ' ' || character === '\t') {
      if (started) words.push(word)
      word = ''
      started = false
      continue
    }
    word += character
    started = true
  }
  if (started) words.push(word)
  return words
}

/**
 * Whether a word can only be the program name and never the head of a path that
 * is about to be cut in half: a bare name such as `npx`, `uvx` or `python3`
 * carries no separator, while `C:\Program` and `/Applications/My` do.
 */
function isBareProgram(word: string): boolean {
  return !word.includes('/') && !word.includes('\\') && !word.includes(':')
}

/**
 * Split a full command line into the program and its arguments.
 *
 * @param config - one stdio server definition.
 * @returns the same definition with `command` and `args` separated, or the
 *   definition unchanged when its command is already a single program, carries
 *   a path that may contain spaces, or the arguments cannot be rewritten safely.
 */
export function withSplitCommand(config: unknown): unknown {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return config
  const server = config as ServerRecord
  const type = server['type']
  if (type !== undefined && type !== 'stdio') return config
  const command = server['command']
  if (typeof command !== 'string') return config
  const line = command.trim()
  if (line === '' || !/\s/.test(line)) return config
  const args = server['args']
  if (args !== undefined && (!Array.isArray(args) || args.some(entry => typeof entry !== 'string'))) return config
  const quoted = line.startsWith('"') || line.startsWith("'")
  const words = splitCommandLine(line)
  const program = words[0]
  if (program === undefined || words.length < 2) return config
  if (!quoted && !isBareProgram(program)) return config
  return { ...server, command: program, args: [...words.slice(1), ...((args as string[] | undefined) ?? [])] }
}
