/**
 * The call name a command resource registers under.
 *
 * A command resource may live at any depth under its `commands/` directory,
 * but the host's slash-command grammar accepts single-segment names only, so
 * registration flattens the path separators: `git/commit` registers as
 * `git-commit`. The user panel renders the same call name, so a card never
 * advertises a slash name the host cannot accept.
 * @module model/command-names
 */

/** Flatten a resource path into the single-segment name a slash command registers under. */
export function commandCallName(name: string): string {
  return name.replaceAll('/', '-').replaceAll('\\', '-').toLowerCase()
}
