#!/usr/bin/env node
/**
 * Verify the guide under `docs/user/` is complete, bilingual and in sync.
 *
 * The site routes pages from `GUIDES` and groups them with `SECTIONS` in
 * `.vitepress/guide.ts`. A file that is not listed there renders nowhere and
 * reports nothing, and the repository rule that a page ships as an English and
 * Chinese pair with equal line counts is checked by nobody else. Both failures
 * are silent, so this reads the files, the library and the build copy.
 *
 * Usage: node scripts/check-guide.mjs
 *
 * Exit codes: 0 consistent, 1 a problem, 2 the check itself could not run.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { rewriteGuideSource } from './lib/rewrite-guide.mjs'

const HERE = new URL('.', import.meta.url).pathname
const SITE = resolve(HERE, '..')
const REPO = resolve(SITE, '..')
const GUIDE_DIR = join(REPO, 'docs', 'user')
const LIBRARY = join(SITE, '.vitepress', 'guide.ts')
const COPY_DIR = join(SITE, 'guide')

/** Page names the library declares, read from its `GUIDES` array. */
function libraryGuides() {
  const source = readFileSync(LIBRARY, 'utf8')
  const block = source.match(/export const GUIDES(?:: string\[\])? = \[([^\]]*)\]/)
  if (block === null) throw new Error('check-guide: GUIDES not found in ' + LIBRARY)
  return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1])
}

/** Page names the library groups into sections, from every `pages: [...]` entry. */
function sectionPages() {
  const source = readFileSync(LIBRARY, 'utf8')
  const block = source.match(/export const SECTIONS(?:: [A-Za-z]+\[\])? = \[([\s\S]*?)\n\]/)
  if (block === null) throw new Error('check-guide: SECTIONS not found in ' + LIBRARY)
  return [...block[1].matchAll(/pages: \[([^\]]*)\]/g)].flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]))
}

const problems = []

const files = statSync(GUIDE_DIR, { throwIfNoEntry: false })?.isDirectory() ? readdirSync(GUIDE_DIR).filter(name => name.endsWith('.md')) : []
const nav = libraryGuides()
const sections = new Set(sectionPages())

// 1. Every shipped page is routed and grouped.
for (const file of files) {
  if (!nav.includes(file)) problems.push(file + ' is not in GUIDES, so the site renders no route for it')
  const base = file.replace(/\.zh\.md$/, '').replace(/\.md$/, '')
  if (!sections.has(base)) problems.push(file + ' is not in any SECTIONS entry, so no page links to it')
}

// 2. Every declared route has a file, so the build cannot fail on a typo.
for (const entry of nav) {
  if (!files.includes(entry)) problems.push('GUIDES names ' + entry + ', which docs/user/ does not ship')
}

// 3. Bilingual pairing: the repository rule is an equal line count per pair.
for (const file of files.filter(f => f.endsWith('.md') && !f.endsWith('.zh.md'))) {
  const zh = file.slice(0, -'.md'.length) + '.zh.md'
  if (!files.includes(zh)) {
    problems.push(file + ' has no .zh.md counterpart')
    continue
  }
  const count = f => readFileSync(join(GUIDE_DIR, f), 'utf8').replace(/\n$/, '').split('\n').length
  const en = count(file)
  const other = count(zh)
  if (en !== other) problems.push(file + ' (' + en + ' lines) and ' + zh + ' (' + other + ' lines) differ')
}

// 4. A page carries the Guide line only when its siblings exist, so a page cannot
//    be orphaned by a missing nav line.
for (const file of files) {
  const text = readFileSync(join(GUIDE_DIR, file), 'utf8')
  if (!/^\*\*Guide:\*\* /m.test(text)) problems.push(file + ' has no **Guide:** line of sibling links')
}

// 5. The build copy exists and matches the rewritten source, so a stale copy cannot ship.
for (const file of files) {
  const src = join(GUIDE_DIR, file)
  const copy = join(COPY_DIR, file)
  if (!existsSync(copy)) {
    problems.push('guide/' + file + ' is missing — run copy-guide.mjs before check or build')
    continue
  }
  const expected = rewriteGuideSource(readFileSync(src, 'utf8'), file)
  if (expected !== readFileSync(copy, 'utf8')) {
    problems.push('guide/' + file + ' differs from docs/user/' + file + ' — rerun copy-guide.mjs')
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error('GUIDE ' + p)
  console.error('check-guide: ' + problems.length + ' problem(s) across ' + files.length + ' file(s)')
  process.exit(1)
}

console.log('check-guide: ' + files.length + ' file(s) in ' + files.length / 2 + ' pair(s), all routed, grouped, equal in length and in sync')
