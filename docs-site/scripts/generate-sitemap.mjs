#!/usr/bin/env node
/**
 * Write dist/sitemap.xml from the pages the build actually emitted.
 *
 * VitePress generates a sitemap from its route records, which cannot describe
 * the <route>/index.html layout scripts/directories.mjs produces or the files
 * that must not be listed. This reads the final build output instead: every
 * directory page is listed at its trailing-slash URL, the home page at the
 * bare site root, and the 404 fallback plus the search-engine verification
 * file stay out.
 *
 * Usage: node scripts/generate-sitemap.mjs [distDir]
 *
 * Exit codes: 0 written, 2 the build output is missing.
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const DIST = resolve(process.argv[2] ?? 'dist')
const SITE = 'https://sivan757.github.io'
const BASE = '/dsh-agent-plugins-market'

/** Files that are served but are not site pages. */
const EXCLUDED = ['404.html', 'googlede2463be9a1dd823.html']

/** Site URL of a built file: dist/docs/install/index.html becomes /docs/install/. */
function urlOf(file) {
  const rel = relative(DIST, file).split(sep).join('/')
  if (rel === 'index.html') return BASE + '/'
  return BASE + '/' + rel.replace(/\/index\.html$/, '/')
}

/** Every <route>/index.html under dir, recursively. */
function pages(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) pages(path, out)
    else if (entry.name === 'index.html' && !EXCLUDED.some(name => path.endsWith('/' + name))) out.push(path)
  }
  return out
}

if (!existsSync(DIST)) {
  console.error('generate-sitemap: no build output at ' + DIST + ' — run the VitePress build first')
  process.exit(2)
}

const urls = pages(DIST).map(urlOf).sort()

const lines = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(url => '  <url><loc>' + SITE + url + '</loc></url>'),
  '</urlset>',
  ''
]

writeFileSync(join(DIST, 'sitemap.xml'), lines.join('\n'))
console.log('generate-sitemap: wrote ' + urls.length + ' URL(s) to ' + join(DIST, 'sitemap.xml'))
