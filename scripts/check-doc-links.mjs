#!/usr/bin/env node
/**
 * Verify every relative markdown link in a tracked file resolves.
 *
 * The guide moved from one page to seven, and inbound references survived the
 * move unchecked; so did several note-to-note links with the wrong number of
 * leading directories. Both failures are silent in review, because a relative
 * link that points nowhere renders as ordinary text and no build reads it.
 * This script reads every tracked markdown file and resolves each link.
 *
 * Skipped on purpose:
 *   - absolute URLs (https, mailto, tel) and same-page anchors,
 *   - targets with a query string, which are not repository paths,
 *   - line-range anchors such as #L22-L28, a GitHub viewer convention,
 *   - targets starting with a slash, which a repository cannot resolve,
 *   - the path template in the Agent Note rules, which carries an ellipsis
 *     placeholder by design,
 *   - archived Agent Notes, which are frozen snapshots: their inbound links are
 *     what the archival change repairs, so a link left broken inside one is not
 *     a current authority to follow or fix.
 *
 * Usage: node scripts/check-doc-links.mjs
 *
 * Exit codes: 0 every link resolves, 1 at least one does not.
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const files = execSync('git ls-files "*.md"', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean)
  // The first-party collection ships as authored (see .prettierignore); its
  // internal references are not rewritten or policed by this checker.
  .filter(file => !file.startsWith('plugins/'))
  // Archived notes are frozen: [the archival rules](.agents/notes/archived/AGENTS.md)
  // forbid repairing a link out of one, so this checker must not demand it.
  .filter(file => !file.startsWith('.agents/notes/archived/'))

const isLineAnchor = f => /^L\d+(-L\d+)?$/.test(f)
/** GitHub heading slug: lowercase, drop punctuation except letters, digits, spaces, hyphens. */
const slug = s =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')

const headingsOf = new Map()
function headings(file) {
  if (!headingsOf.has(file)) {
    const heads = [...readFileSync(file, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => slug(m[1].trim()))
    headingsOf.set(file, heads)
  }
  return headingsOf.get(file)
}

const dead = []
let checked = 0

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1]
    if (/^(?:https?:|mailto:|tel:|#)/.test(target)) continue
    if (target.includes('?') || target.includes('\u2026')) continue
    if (target.startsWith('/')) continue
    const [pathPart, frag] = target.split('#')
    if (pathPart === '') continue
    checked += 1

    const resolved = resolve(dirname(file), pathPart)
    if (!existsSync(resolved)) {
      dead.push({ file, target, why: 'no such file' })
      continue
    }
    if (frag && !isLineAnchor(frag) && statSync(resolved).isFile() && resolved.endsWith('.md')) {
      if (!headings(resolved).includes(decodeURIComponent(frag))) {
        dead.push({ file, target, why: 'no such heading' })
      }
    }
  }
}

if (dead.length > 0) {
  for (const d of dead) console.error('DOC-LINK ' + d.file + ' -> ' + d.target + '  (' + d.why + ')')
  console.error('check-doc-links: ' + dead.length + ' dead link(s) across ' + files.length + ' file(s)')
  process.exit(1)
}
console.log('check-doc-links: ' + checked + ' relative link(s) across ' + files.length + ' file(s) all resolve')
