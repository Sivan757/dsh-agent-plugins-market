// @vitest-environment jsdom

/**
 * The theme tokens this plugin is allowed to name.
 *
 * A stylesheet that names a token the host does not define still compiles, and the
 * `var()` fallback quietly takes over. The tab row shipped `--dsw-alias-bg-primary`
 * with a `#fff` fallback: the host defines no such token, so the selected tab drew a
 * white plate in the dark theme and its own light label disappeared into it. Nothing
 * in the build or the suite noticed, because a wrong colour is a valid value.
 *
 * This case closes that gap the only way a repository can without the host's token
 * file: the list below is the set of tokens verified present in the host's
 * `design-platform.css` for both themes. A new token fails until someone checks it
 * against the host and adds it here.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Every token the host actually defines, verified in its light and dark blocks. */
const KNOWN_TOKENS = new Set([
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-mask-3',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-brand-primary',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-hover-danger',
  '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-markdown-code-block',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-business-tertiary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-label',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-warn-tertiary',
  '--dsw-alias-tooltip-bg',
  '--dsw-elevation-prominent',
  '--dsw-mask-blur',
  '--dsw-radius-sm',
  '--dsw-specific-input-major'
])

/** The bare prefixes a comment or a doc line may mention without naming a token. */
const PREFIXES = new Set(['--dsw-', '--dsw-alias-'])

/** Every stylesheet under the client package. */
function stylesheets(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) stylesheets(full, out)
    else if (entry.name.endsWith('.css')) out.push(full)
  }
  return out
}

describe('theme tokens', () => {
  it('names only tokens the host defines', () => {
    // Vitest runs from the repository root, which is how the other repository-wide
    // cases in this suite resolve their files.
    const root = join(process.cwd(), 'packages', 'market-ui')
    const unknown = []
    for (const file of stylesheets(join(root, 'src'))) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/--dsw-[a-z0-9-]*/g)) {
        const token = match[0]
        if (PREFIXES.has(token) || KNOWN_TOKENS.has(token)) continue
        unknown.push(relative(root, file) + ' names ' + token)
      }
    }
    expect(unknown).toEqual([])
  })
})
