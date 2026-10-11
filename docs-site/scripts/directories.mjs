#!/usr/bin/env node
/**
 * Convert the flat build output into the directory layout GitHub Pages serves.
 *
 * VitePress emits dist/docs/install.html, but the READMEs deep-link
 * /docs/install/ and GitHub Pages resolves that URL only against
 * docs/install/index.html. cleanUrls: true rewrites internal hrefs to the
 * extensionless form this layout needs, so this script moves every page into
 * <route>/index.html and leaves true assets untouched.
 *
 * The 404 fallback and the search-engine verification file are special: GitHub
 * Pages reads 404.html only at the site root, and the verification file is
 * fetched by its literal flat path, so neither moves.
 *
 * Usage: node scripts/directories.mjs [distDir]
 *
 * Exit codes: 0 moved, 2 the build output is missing.
 */
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const DIST = resolve(process.argv[2] ?? 'dist')

/** Files that only work at their emitted flat path. */
const KEEP_FLAT = ['404.html', 'googlede2463be9a1dd823.html']

if (!existsSync(DIST)) {
  console.error('directories: no build output at ' + DIST + ' — run the VitePress build first')
  process.exit(2)
}

/** Every .html file under dir, recursively. */
function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) htmlFiles(path, out)
    else if (entry.name.endsWith('.html')) out.push(path)
  }
  return out
}

let moved = 0
for (const file of htmlFiles(DIST)) {
  const rel = relative(DIST, file).split(sep).join('/')
  if (rel === 'index.html' || rel.endsWith('/index.html')) continue
  if (KEEP_FLAT.includes(rel)) continue

  const dir = join(DIST, rel.replace(/\.html$/, ''))
  mkdirSync(dir, { recursive: true })
  renameSync(file, join(dir, 'index.html'))
  moved += 1
}
console.log('directories: moved ' + moved + ' page(s), kept ' + KEEP_FLAT.length + ' flat')
