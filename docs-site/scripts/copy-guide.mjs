#!/usr/bin/env node
/**
 * Copy the guide under `docs/user/` into `guide/` for the VitePress build.
 *
 * VitePress renders markdown from files inside its own source tree. The
 * repository stays the single authoring source: this script copies the nine
 * bilingual pairs before `vitepress build`, rewriting each link for the site
 * (see scripts/lib/rewrite-guide.mjs) — guide pages become site routes, and
 * repository-root files become GitHub URLs. `check-guide.mjs` recomputes the
 * rewrite and fails when the copy is missing or stale.
 *
 * Usage: node scripts/copy-guide.mjs
 *
 * Exit codes: 0 copied, 2 the source directory is missing.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { rewriteGuideSource } from './lib/rewrite-guide.mjs'

const HERE = new URL('.', import.meta.url).pathname
const SITE = resolve(HERE, '..')
const REPO = resolve(SITE, '..')
const SRC = join(REPO, 'docs', 'user')
const DEST = join(SITE, 'guide')

if (!statSync(SRC, { throwIfNoEntry: false })?.isDirectory()) {
  console.error('copy-guide: no guide source at ' + SRC + ' — run from the docs-site directory')
  process.exit(2)
}

mkdirSync(DEST, { recursive: true })
const files = readdirSync(SRC)
  .filter(name => name.endsWith('.md'))
  .sort()
for (const name of files) {
  writeFileSync(join(DEST, name), rewriteGuideSource(readFileSync(join(SRC, name), 'utf8'), name))
}
console.log('copy-guide: copied ' + files.length + ' file(s) from docs/user to guide/ with links rewritten')
