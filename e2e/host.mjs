#!/usr/bin/env node
/**
 * Boot the real DSH host for the Playwright suite.
 *
 * The suite drives the plugin's Web UI inside the host every user runs, so it
 * needs a real host rather than a mock. This script provisions one isolated
 * `DSH_HOME` under `node_modules/.cache/e2e`, pins the host CLI to the support
 * floor published in `scripts/host-support-window.mjs`, installs the profile
 * that links this checkout, and prints the authenticated URL.
 *
 * Two caches make reruns cheap: the CLI is installed once per floor version,
 * and the profile's dependencies are installed once per manifest change. Delete
 * the cache directory to rebuild both.
 *
 * Environment:
 *   DSH_E2E_NODE   node binary that runs the host CLI; it must satisfy the
 *                  host's engines (`^24.22.3 || >=26.13.1`) and defaults to the
 *                  binary running this script.
 *   DSH_E2E_HOME   cache root; defaults to `node_modules/.cache/e2e`.
 *   DSH_E2E_PORT   port to bind; defaults to 43125.
 *
 * Usage: `node e2e/host.mjs` (Playwright starts it as its web server).
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOST_SUPPORT_FLOOR } from '../scripts/host-support-window.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = resolve(process.env.DSH_E2E_HOME ?? join(ROOT, 'node_modules', '.cache', 'e2e'))
const HOME = join(CACHE, 'home')
const PROFILE = 'market'
const PORT = Number(process.env.DSH_E2E_PORT ?? 43125)
const NODE = process.env.DSH_E2E_NODE ?? process.execPath
const TARGET = join(CACHE, 'target.json')

/** Run one command to completion and fail loudly on a non-zero exit. */
function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}`)
  return result
}

/** The version string of a node binary, for the host's engine check. */
function nodeVersion(binary) {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8' })
  if (result.error !== undefined || result.status !== 0) throw new Error('cannot run ' + binary)
  return result.stdout.trim()
}

/** Whether the host's declared engines admit a `v24.22.3`-style version string. */
function hostEnginesAdmit(version) {
  const [major, minor, patch] = version.replace(/^v/, '').split('.').map(Number)
  if (major === 24) return minor > 22 || (minor === 22 && patch >= 3)
  return major > 26 || (major === 26 && (minor > 13 || (minor === 13 && patch >= 1)))
}

/** Install the pinned host CLI once per support floor. */
async function ensureCli() {
  const prefix = join(CACHE, 'cli')
  const marker = join(prefix, 'version')
  const entry = join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (existsSync(marker) && (await readFile(marker, 'utf8')).trim() === HOST_SUPPORT_FLOOR && existsSync(entry)) return entry
  await rm(prefix, { recursive: true, force: true })
  await mkdir(prefix, { recursive: true })
  await writeFile(join(prefix, 'package.json'), `${JSON.stringify({ name: 'dsh-e2e-host', private: true }, null, 2)}\n`)
  run('npm', ['install', '--no-audit', '--no-fund', `@deepseek-ai/dsh@${HOST_SUPPORT_FLOOR}`], { cwd: prefix })
  await writeFile(marker, `${HOST_SUPPORT_FLOOR}\n`)
  return entry
}

/** Write the profile manifest and its pnpm policy, returning whether either moved. */
async function ensureProfileManifest() {
  const directory = join(HOME, 'profiles', PROFILE)
  await mkdir(directory, { recursive: true })
  const manifest = {
    name: 'dsh-profile-market-e2e',
    private: true,
    dependencies: {
      '@deepseek-ai/dsh-web-app': HOST_SUPPORT_FLOOR,
      'dsh-agent-plugins-market': `link:${ROOT}`
    },
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-agent-plugins-market']
      }
    }
  }
  const text = `${JSON.stringify(manifest, null, 2)}\n`
  const path = join(directory, 'package.json')
  const previous = existsSync(path) ? await readFile(path, 'utf8') : ''
  await writeFile(path, text)
  // The profile keeps the repository's supply-chain policy: koffi's native build
  // is approved-but-skipped, the same decision the root workspace records, so
  // pnpm does not fail the install on an ignored build script.
  await writeFile(
    join(directory, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n\nallowBuilds:\n  esbuild: true\n  koffi: false\n  sharp: true\n'
  )
  return previous !== text
}

/** Install the profile's dependencies when its ready marker is absent or the manifest moved. */
async function ensureProfile(directoryChanged) {
  const directory = join(HOME, 'profiles', PROFILE)
  const ready = join(directory, '.installed')
  const manifest = await readFile(join(directory, 'package.json'), 'utf8')
  if (!directoryChanged && existsSync(ready) && (await readFile(ready, 'utf8')) === manifest) return
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  run(pnpm, ['install', '--no-frozen-lockfile'], { cwd: directory })
  await writeFile(ready, manifest)
}

/**
 * Start every run from the same market: one seeded local source and no
 * installs. The fixture path is absolute, so the scan reads a directory the
 * suite owns instead of cloning a remote repository.
 */
async function resetPluginState() {
  const directory = join(HOME, 'agent-plugins')
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  // The user-level Agent layout root (`$DSH_AGENTS_HOME`, default `~/.agents`)
  // holds hand-authored skills, commands and MCP servers. Empty it so a
  // developer's personal resources never appear on the suite's tabs.
  const agentsHome = join(HOME, 'agents-home')
  await rm(agentsHome, { recursive: true, force: true })
  await mkdir(agentsHome, { recursive: true })
  const state = {
    version: 1,
    sources: [{ id: 'e2e-fixture', url: join(ROOT, 'e2e', 'fixtures', 'local-source'), local: true }],
    installed: {}
  }
  await writeFile(join(directory, 'state.json'), `${JSON.stringify(state, null, 2)}\n`)
}

/** Build the plugin's `lib` and `client` artifacts when they are missing. */
async function ensureBuild() {
  if (existsSync(join(ROOT, 'lib', 'index.js')) && existsSync(join(ROOT, 'client', 'client.js'))) return
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  run(pnpm, ['run', 'build'], { cwd: ROOT })
}

/** Remove a target file left by an earlier run, so readiness reads the new boot. */
async function clearTarget() {
  await rm(TARGET, { force: true })
}

/**
 * Boot the host and resolve with its authenticated URL once it prints one.
 * @returns a promise that settles at the first `dsh web: <url>` line.
 */
function boot(entry) {
  const profileDirectory = join(HOME, 'profiles', PROFILE)
  const child = spawn(NODE, [entry, '--profile', PROFILE, '--no-open', '--port', String(PORT)], {
    cwd: profileDirectory,
    // Fix the process locale: the host resolves the language it serves text in
    // from it, and the suite's browser context is en-US. Without this the UI
    // strings and the server-resolved language disagree on a non-English machine.
    //
    // Point every proxy at a closed port: the seeded fixture source is the only
    // data the suite asserts, and the preset Git source must fail its clone fast
    // instead of adding three network-dependent suites to the same page.
    env: {
      ...process.env,
      DSH_HOME: HOME,
      DSH_AGENTS_HOME: join(HOME, 'agents-home'),
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LANGUAGE: 'en',
      HTTP_PROXY: 'http://127.0.0.1:9',
      HTTPS_PROXY: 'http://127.0.0.1:9',
      ALL_PROXY: 'http://127.0.0.1:9',
      http_proxy: 'http://127.0.0.1:9',
      https_proxy: 'http://127.0.0.1:9',
      all_proxy: 'http://127.0.0.1:9',
      NO_PROXY: '',
      no_proxy: ''
    },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  return {
    child,
    url: new Promise((resolveUrl, reject) => {
      let buffered = ''
      const fail = error => {
        child.kill()
        reject(error)
      }
      child.on('error', fail)
      child.on('exit', code => fail(new Error(`host exited before printing its URL (code ${code ?? 'null'})`)))
      child.stdout?.on('data', chunk => {
        buffered += chunk.toString()
        const match = /dsh web: (http:\/\/[^\s]+)/.exec(buffered)
        if (match === null) return
        resolveUrl(match[1])
      })
    })
  }
}

let host
let stopping = false

/** Stop the host once, whichever signal arrives first. */
function stop() {
  if (stopping) return
  stopping = true
  host?.child.kill('SIGTERM')
}

try {
  const version = nodeVersion(NODE)
  if (!hostEnginesAdmit(version)) {
    throw new Error(`${NODE} reports ${version}, which the host's engines (^24.22.3 || >=26.13.1) do not admit. Set DSH_E2E_NODE to a supported node binary.`)
  }
  const entry = await ensureCli()
  const manifestChanged = await ensureProfileManifest()
  await ensureProfile(manifestChanged)
  await ensureBuild()
  await resetPluginState()
  await mkdir(CACHE, { recursive: true })
  await clearTarget()
  host = boot(entry)
  const url = await host.url
  await writeFile(TARGET, `${JSON.stringify({ url, port: PORT, home: HOME, profileDirectory: join(HOME, 'profiles', PROFILE), pid: host.child.pid }, null, 2)}\n`)
  // The runner keeps this process alive through its web-server contract; the
  // URL is on stdout and the target file, and the child owns the port.
  console.log(`dsh web: ${url}`)
} catch (error) {
  stop()
  console.error(`e2e host: ${error.message}`)
  process.exitCode = 1
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stop()
    process.exit(0)
  })
}
await new Promise(() => {})
