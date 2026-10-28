/**
 * The authored body inside the measured slash-command metadata.
 *
 * A command follow-up now carries `<command-message>`, `<command-name>`, the raw
 * argument, a horizontals rule, the body, and an `ARGUMENTS:` trailer. Cases
 * about placeholder expansion read the body back out; the case in
 * `commands-mounts.test.ts` pins the wrapper itself.
 * @param forwarded - the whole follow-up text the agent received.
 * @returns the authored body between the rule and the trailer.
 */
export function authoredBodyOf(forwarded: string): string {
  const lines = forwarded.split('\n')
  const rule = lines.indexOf('---')
  if (rule < 0) return forwarded
  const rest = lines.slice(rule + 1)
  const trailer = rest.findIndex(line => line.startsWith('ARGUMENTS: '))
  const body = (trailer < 0 ? rest : rest.slice(0, trailer)).join('\n')
  // Drop only the one blank line the wrapper inserts before the trailer.
  return body.endsWith('\n') ? body.slice(0, -1) : body
}
