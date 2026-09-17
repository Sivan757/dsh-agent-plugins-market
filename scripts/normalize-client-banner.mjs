#!/usr/bin/env node
/**
 * Post-process the tsdown client bundle into the Web app's module-loader
 * contract:
 * 1. inline the emitted style.css into the bundle as a document.head style
 *    injection (the loader evaluates the factory in a plain function scope,
 *    so an `import './style.css'` statement would be a syntax error);
 * 2. wrap the CJS body in `window.__ModuleLoader__.load({ id, factory })`
 *    with its own `var module/exports` scaffolding.
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const id = pkg.name
const bundlePath = join(root, 'client', 'client.js')
const cssPath = join(root, 'client', 'style.css')
let body = readFileSync(bundlePath, 'utf8')

if (existsSync(cssPath)) {
  const css = readFileSync(cssPath, 'utf8')
  const cssLiteral = JSON.stringify(css)
  const injection = `(function(){if(typeof document!=="undefined"){var s=document.createElement("style");s.setAttribute("data-dsh-client",${JSON.stringify(id)});s.textContent=${cssLiteral};document.head.appendChild(s);}})();`
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
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
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
