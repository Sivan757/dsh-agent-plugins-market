#!/usr/bin/env node
/**
 * Verify every link in the built site resolves.
 *
 * The guide pages render repository markdown and rewrite its links at build
 * time (\`src/lib/guide.ts\`). That rewrite is a string pass over rendered HTML,
 * so it cannot tell a link it should rewrite from one it should leave alone: a
 * wrong target shows as a 404 on GitHub rather than as a broken site route.
 * This check reads the build output and fails on any link that goes nowhere.
 *
 * Usage: node scripts/check-links.mjs [distDir]
 *
 * Exit codes: 0 every link resolves, 1 a link is broken, 2 the check could not run.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');
const BASE = '/dsh-agent-plugins-market';
/** A path whose final segment looks like this is an asset, not a page. */
const ASSET = /\.[a-z0-9]+$/i;

/** Every \`.html\` file under \`dir\`, recursively. */
function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(path, out);
    else if (entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

/** Site route of a built file: \`dist/docs/usage/index.html\` becomes \`/docs/usage/\`. */
function routeOf(file) {
  const rel = relative(DIST, file).split(sep).join('/');
  return rel === 'index.html' ? '/' : '/' + rel.replace(/index\.html$/, '');
}

/** Every \`id\` the document declares, which is what a fragment must match. */
function idsOf(file) {
  const html = readFileSync(file, 'utf8');
  return new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));
}

/** Built file behind a site route. */
function fileFor(route) {
  const clean = route.replace(/^\//, '');
  return clean === '' ? join(DIST, 'index.html') : join(DIST, clean, 'index.html');
}

if (!existsSync(DIST)) {
  console.error('check-links: no build output at ' + DIST + ' — run the Astro build first');
  process.exit(2);
}

const pages = htmlFiles(DIST);
const ids = new Map(pages.map((page) => [routeOf(page), idsOf(page)]));
const broken = [];
let internal = 0;
let anchors = 0;
let external = 0;
let assets = 0;

for (const page of pages) {
  const route = routeOf(page);
  const html = readFileSync(page, 'utf8');
  for (const match of html.matchAll(/href="([^"]*)"/g)) {
    const href = match[1];

    if (/^(?:https?:|mailto:)/.test(href)) {
      external += 1;
      continue;
    }
    if (!href.startsWith('#') && !href.startsWith(BASE)) {
      broken.push(route + ' -> ' + href + ' (not an absolute site or external URL)');
      continue;
    }
    if (href.startsWith('#')) {
      anchors += 1;
      if (!ids.get(route).has(decodeURIComponent(href.slice(1)))) {
        broken.push(route + ' -> ' + href + ' (no such id on the page)');
      }
      continue;
    }

    const [target, fragment] = href.slice(BASE.length).split('#');
    if (ASSET.test(target) && !target.endsWith('.html')) {
      assets += 1;
      continue;
    }
    internal += 1;
    const key = target.endsWith('/') ? target : target + '/';
    if (!existsSync(fileFor(key))) {
      broken.push(route + ' -> ' + href + ' (no such page)');
      continue;
    }
    if (fragment !== undefined && !ids.get(key).has(decodeURIComponent(fragment))) {
      broken.push(route + ' -> ' + href + ' (no such fragment)');
    }
  }

  // A relative \`.md\` link means the rewrite missed a target the site cannot serve.
  for (const match of html.matchAll(/href="((?!https?:|\/|#)[^"]*\.md[^"]*)"/g)) {
    broken.push(route + ' -> ' + match[1] + ' (unrewritten markdown link)');
  }
}

if (broken.length > 0) {
  for (const line of broken) console.error('BROKEN ' + line);
  console.error('check-links: ' + broken.length + ' broken link(s) across ' + pages.length + ' page(s)');
  process.exit(1);
}

console.log(
  'check-links: ' + pages.length + ' page(s), ' + internal + ' internal link(s), ' +
  anchors + ' anchor(s), ' + assets + ' asset reference(s), ' + external + ' external link(s) — all resolve'
);
