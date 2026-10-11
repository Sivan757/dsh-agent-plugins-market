#!/usr/bin/env node
/**
 * Verify every link in the built site resolves.
 *
 * VitePress fails its own build on a dead internal link between pages it
 * knows, but the guide pages come from a rewritten copy, the READMEs publish
 * trailing-slash deep links against the deployed site, and a fragment can
 * name a heading that no longer exists. This check reads the final build
 * output and resolves every href: assets and routes against the emitted
 * files, fragments against the declared ids.
 *
 * Usage: node scripts/check-links.mjs [distDir]
 *
 * Exit codes: 0 every link resolves, 1 a link is broken, 2 the check could not run.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const DIST = resolve(process.argv[2] ?? 'dist')
const BASE = '/dsh-agent-plugins-market'

/** Files that only exist at their flat emitted path. */
const FLAT_ONLY = ['404.html', 'googlede2463be9a1dd823.html']

/** Every .html file under dir, recursively. */
function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) htmlFiles(path, out)
    else if (entry.name.endsWith('.html')) out.push(path)
  }
  return out
}

/** Site route of a built file: dist/docs/install/index.html becomes /docs/install/. */
function routeOf(file) {
  const rel = relative(DIST, file).split(sep).join('/')
  return rel === 'index.html' ? '/' : '/' + rel.replace(/\/index\.html$/, '/')
}

/** Every id the document declares, which is what a fragment must match. */
function idsOf(file) {
  const html = readFileSync(file, 'utf8')
  return new Set([...html.matchAll(/\sid="([^"]*)"/g)].map(m => m[1]))
}

if (!existsSync(DIST)) {
  console.error('check-links: no build output at ' + DIST + ' — run the VitePress build first')
  process.exit(2)
}

const pages = htmlFiles(DIST)
const ids = new Map(pages.map(page => [routeOf(page), idsOf(page)]))
const broken = []
let internal = 0
let anchors = 0
let external = 0
let assets = 0

for (const page of pages) {
  const route = routeOf(page)
  const html = readFileSync(page, 'utf8')
  for (const match of html.matchAll(/href="([^"]*)"/g)) {
    const href = match[1]

    if (/^(?:https?:|mailto:)/.test(href)) {
      external += 1
      continue
    }
    if (href.startsWith('#')) {
      anchors += 1
      if (!ids.get(route).has(decodeURIComponent(href.slice(1)))) {
        broken.push(route + ' -> ' + href + ' (no such id on the page)')
      }
      continue
    }
    if (!href.startsWith(BASE)) {
      broken.push(route + ' -> ' + href + ' (not an absolute site or external URL)')
      continue
    }

    const target = href.slice(BASE.length).split('#')[0]
    const fragment = href.includes('#') ? href.split('#')[1] : undefined
    const last = target.split('/').filter(Boolean).pop() ?? ''
    if (target !== '' && (last.includes('.') || FLAT_ONLY.includes(last + '.html'))) {
      assets += 1
      if (!existsSync(join(DIST, target))) {
        broken.push(route + ' -> ' + href + ' (no such asset)')
      }
      continue
    }
    internal += 1
    const key = target === '' ? '/' : target.endsWith('/') ? target : target + '/'
    if (!ids.has(key)) {
      broken.push(route + ' -> ' + href + ' (no such page)')
      continue
    }
    if (fragment !== undefined) {
      const onTarget = ids.get(key)
      if (onTarget !== undefined && !onTarget.has(decodeURIComponent(fragment))) {
        broken.push(route + ' -> ' + href + ' (no such fragment)')
      }
    }
  }
}

if (broken.length > 0) {
  for (const line of broken) console.error('BROKEN ' + line)
  console.error('check-links: ' + broken.length + ' broken link(s) across ' + pages.length + ' page(s)')
  process.exit(1)
}

console.log(
  'check-links: ' +
    pages.length +
    ' page(s), ' +
    internal +
    ' internal link(s), ' +
    anchors +
    ' anchor(s), ' +
    assets +
    ' asset reference(s), ' +
    external +
    ' external link(s) — all resolve'
)
