#!/usr/bin/env node
/**
 * Post-process the tsdown client bundle into the Web app's module-loader
 * contract:
 * 1. replace the emitted `import './style.css'` with a style injection (the
 *    loader evaluates the factory in a plain function scope, so an ESM import
 *    statement is a syntax error);
 * 2. wrap the CJS body in `window.__ModuleLoader__.load({ id, factory })`
 *    with its own `var module/exports` scaffolding.
 *
 * The stylesheet is embedded as a base64 payload that the browser decodes, so
 * no byte of it can end the string literal it sits in or the statement around
 * it. The package id is validated instead, because the loader needs it as a
 * plain module id anyway.
 *
 * The root defaults to this checkout and can be passed as the first argument,
 * which is how `tests/client-banner.test.ts` drives it against a fixture.
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.argv[2] === undefined ? join(dirname(fileURLToPath(import.meta.url)), '..') : resolve(process.argv[2])
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const id = pkg.name
if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
  throw new Error(`client banner: package name ${JSON.stringify(id)} is not a plain module id`)
}
const bundlePath = join(root, 'client', 'client.js')
const cssPath = join(root, 'client', 'style.css')
let body = readFileSync(bundlePath, 'utf8')

/** The runtime expression that turns an embedded base64 payload back into text. */
function decodeLiteral(text) {
  const encoded = Buffer.from(text, 'utf8').toString('base64')
  return `new TextDecoder().decode(Uint8Array.from(atob("${encoded}"),function(c){return c.charCodeAt(0)}))`
}

if (existsSync(cssPath)) {
  const css = readFileSync(cssPath, 'utf8')
  const injection =
    '(function(){if(typeof document!=="undefined"){' +
    'var s=document.createElement("style");' +
    `s.setAttribute("data-dsh-client","${id}");` +
    `s.textContent=${decodeLiteral(css)};` +
    'document.head.appendChild(s);}})();'
  const importPattern = /import\s*['"]\.\/style\.css['"];?/
  if (importPattern.test(body)) {
    body = body.replace(importPattern, injection)
  } else {
    body = `${injection}\n${body}`
  }
  rmSync(cssPath)
  rmSync(`${cssPath}.map`, { force: true })
}

const wrapped = [
  `window.__ModuleLoader__.load({ id: "${id}", factory: (require) => {`,
  '',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  body.trimEnd(),
  '\t\treturn module.exports;',
  '}',
  '});',
  ''
].join('\n')

writeFileSync(bundlePath, wrapped)
console.log(`[dsh-agent-plugins] wrapped client bundle for ${id}`)
