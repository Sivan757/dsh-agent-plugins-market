#!/usr/bin/env node
/**
 * Write \`dist/sitemap.xml\` from the pages the build actually emitted.
 *
 * The sitemap used to be a hand-maintained file under \`public/\`, so adding a
 * page left it behind: the guide added seven routes and the deployed sitemap
 * still named four. Deriving it from the build output removes that drift.
 *
 * Usage: node scripts/generate-sitemap.mjs [distDir]
 *
 * Exit codes: 0 written, 2 the build output is missing.
 */
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');
const SITE = 'https://sivan757.github.io';
const BASE = '/dsh-agent-plugins-market';

/** Priority by route shape: the home page first, then the entrance pages, then detail. */
function priorityOf(route) {
  if (route === '/') return '1.0';
  if (route === '/install/' || route === '/docs/') return '0.9';
  if (route === '/compatible-plugins/' || route === '/faq/') return '0.8';
  return '0.7';
}

/** Site route of a built file: \`dist/docs/usage/index.html\` becomes \`/docs/usage/\`. */
function routeOf(file) {
  const rel = relative(DIST, file).split(sep).join('/');
  return rel === 'index.html' ? '/' : '/' + rel.replace(/index\.html$/, '');
}

/** Every \`index.html\` under \`dir\`, recursively. */
function pages(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) pages(path, out);
    else if (entry.name === 'index.html') out.push(path);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error('generate-sitemap: no build output at ' + DIST + ' — run the Astro build first');
  process.exit(2);
}

const routes = pages(DIST).map(routeOf).sort();

const lines = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...routes.map((route) => '  <url><loc>' + SITE + BASE + route + '</loc><priority>' + priorityOf(route) + '</priority></url>'),
  '</urlset>',
  '',
];

writeFileSync(join(DIST, 'sitemap.xml'), lines.join('\n'));
console.log('generate-sitemap: wrote ' + routes.length + ' URL(s) to ' + join(DIST, 'sitemap.xml'));
