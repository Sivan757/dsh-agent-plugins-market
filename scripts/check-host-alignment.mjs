#!/usr/bin/env node
/**
 * Host dependency alignment gate.
 *
 * The published tarball carries whatever `package.json` said at the released tag, so a stale
 * host pin ships a stale contract. Two ways that bites:
 *
 * 1. A prerelease range only matches its own `major.minor.patch`, so `^0.1.2-rc.1` cannot
 *    resolve against a `0.1.5-rc.2` host — consumers on the current release line get a peer
 *    range that excludes the host they run.
 * 2. A host package that is imported dynamically and never declared (`dsh-lsp-stdio`) has no
 *    declared contract at all: it degrades to the `host-missing` diagnostic with nothing to
 *    align or audit.
 *
 * This gate resolves the host release line from the registry (`next` by default — the
 * `@deepseek-ai/dsh-*` family publishes to `next`, while `latest` lags), then fails unless every
 * declared and referenced host dependency matches that one baseline:
 *
 * - a declared host package carries peer `^<baseline>` and dev `<baseline>`;
 * - anything `src/` imports is declared, and every peer has a dev mirror;
 * - a package reached only through `import(...)` is an optional peer, because it is mounted
 *   lazily and must degrade instead of failing;
 * - `@deepseek-ai/cordis` carries one identical range in peer and dev (it tracks its own 4.x line);
 * - `pnpm-workspace.yaml` `minimumReleaseAgeExclude` admits the baseline for every aligned package.
 *
 * `@deepseek-ai/dsh-client-*` is exempt from the peer rules: those are host-supplied bundle
 * externals, pinned through devDependencies only and never installable capabilities.
 *
 * Usage:
 *   node scripts/check-host-alignment.mjs [options]
 *
 * Options:
 *   --host-version <v>   Pin the baseline explicitly; skips registry resolution.
 *   --channel <tag>      Registry dist-tag to resolve (default: next).
 *   --fix                Rewrite package.json and pnpm-workspace.yaml into alignment.
 *   --json               Emit a machine-readable report.
 *   --offline            Resolve from the local dist-tag cache only.
 *   --refresh            Ignore the cache and re-query the registry.
 *   --cache-ttl <sec>    Cache freshness window (default: 300).
 *
 * Exit codes: 0 aligned, 1 drift, 2 the gate itself could not run.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const MANIFEST_PATH = join(ROOT, 'package.json')
const WORKSPACE_PATH = join(ROOT, 'pnpm-workspace.yaml')
const SRC_DIR = join(ROOT, 'src')
const CACHE_PATH = join(ROOT, 'node_modules', '.cache', 'host-alignment', 'dist-tags.json')

/** Host capability packages share this scope prefix and one release version. */
const HOST_PREFIX = '@deepseek-ai/dsh-'
/** Client modules are host-supplied bundle externals, not installable capabilities. */
const CLIENT_PREFIX = '@deepseek-ai/dsh-client-'
/** Cordis is the plugin container; it tracks its own 4.x line, not the dsh family version. */
const CORDIS = '@deepseek-ai/cordis'
/** `pnpm-workspace.yaml` key carrying the supply-chain escape hatch pnpm writes. */
const EXCLUDE_KEY = 'minimumReleaseAgeExclude'

const argv = process.argv.slice(2)
const flag = name => argv.includes(`--${name}`)
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}

const channel = option('channel', 'next')
const forcedVersion = option('host-version', process.env.DSH_HOST_VERSION)
const cacheTtlMs = Number(option('cache-ttl', '300')) * 1000
const useJson = flag('json')
const offline = flag('offline')
const refresh = flag('refresh')
const fix = flag('fix')

const isHostPackage = name => name.startsWith(HOST_PREFIX)
const isClientPackage = name => name.startsWith(CLIENT_PREFIX)

/** Read one UTF-8 file. */
const read = path => readFile(path, 'utf8')

/**
 * Collect host package names a source tree imports, so an undeclared dependency cannot hide
 * behind a dynamic import. Dynamic imports keep the specifier in a `const` (the optional
 * dependency must stay non-literal for bundlers), so an identifier resolved through `import(...)`
 * counts too.
 * @param dir - directory to walk.
 * @returns map of host package name to `{ reference, static, dynamic }`, where `reference` is the
 * first `file` that mentions it; a package seen only through `import(...)` is a lazily mounted
 * capability and must therefore be an optional peer.
 */
function scanHostSurface(dir) {
  const found = new Map()
  const files = []
  const walk = current => {
    let entries
    try {
      entries = readdirSync(current)
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(current, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.[cm]?[jt]sx?$/.test(entry)) files.push(path)
    }
  }
  walk(dir)

  for (const path of files) {
    const source = readFileSync(path, 'utf8')
    const aliases = new Map()
    for (const match of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*'(@deepseek-ai\/dsh-[a-z0-9-]+)'/g)) {
      aliases.set(match[1], match[2])
    }

    const sloppy = /\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*/g
    const record = (name, kind) => {
      if (isClientPackage(name)) return
      const entry = found.get(name) ?? { reference: relative(ROOT, path), static: false, dynamic: false }
      entry[kind] = true
      found.set(name, entry)
    }
    for (const match of source.matchAll(/(?:from|require\s*\()\s*'(@deepseek-ai\/dsh-[a-z0-9-]+)'/g)) record(match[1], 'static')
    for (const match of source.matchAll(/(?:^|[;\s])import\s+'(@deepseek-ai\/dsh-[a-z0-9-]+)'/g)) record(match[1], 'static')
    for (const match of source.matchAll(/import\(\s*'(@deepseek-ai\/dsh-[a-z0-9-]+)'/g)) record(match[1], 'dynamic')
    // The optional mount spells its specifier through a const, and often guards the call with a
    // bundler hint comment, so strip comments before resolving the identifier.
    for (const match of source.replace(sloppy, ' ').matchAll(/import\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
      const name = aliases.get(match[1])
      if (name !== undefined) record(name, 'dynamic')
    }
  }
  return found
}

/** Dist-tags for every candidate package, served from cache when fresh. */
async function resolveDistTags(names) {
  if (forcedVersion !== undefined) return new Map(names.map(name => [name, { [channel]: forcedVersion }]))

  let cache
  try {
    cache = JSON.parse(await read(CACHE_PATH))
  } catch {
    cache = undefined
  }
  const freshEnough = cache !== undefined && Number.isFinite(cache.fetchedAt) && Date.now() - cache.fetchedAt < cacheTtlMs
  const cached = new Map(Object.entries(cache?.tags ?? {}))
  if (!refresh && (offline || freshEnough)) {
    const missing = names.filter(name => cached.get(name)?.[channel] === undefined)
    if (missing.length === 0) return new Map(names.map(name => [name, cached.get(name)]))
    if (offline) throw new Error(`no cached dist-tags for ${missing.join(', ')}; run once online or pass --host-version`)
  }

  const resolved = await Promise.all(
    names.map(async name => {
      const url = `https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags`
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`${name}: registry responded ${response.status} for dist-tag ${channel}`)
      const tags = await response.json()
      if (typeof tags?.[channel] !== 'string') throw new Error(`${name}: registry has no ${channel} dist-tag`)
      return [name, tags]
    })
  )

  const merged = { fetchedAt: Date.now(), tags: { ...Object.fromEntries(cached), ...Object.fromEntries(resolved) } }
  await mkdir(dirname(CACHE_PATH), { recursive: true })
  await writeFile(CACHE_PATH, `${JSON.stringify(merged, null, 2)}\n`)
  return new Map(resolved)
}

/**
 * The one baseline every host package must carry. The family publishes in lockstep, so a
 * disagreement between packages means the gate cannot decide what "aligned" means.
 */
function baselineFrom(tags) {
  const versions = new Map()
  for (const [name, distTags] of tags) {
    const version = distTags[channel]
    versions.set(version, [...(versions.get(version) ?? []), name])
  }
  if (versions.size > 1) {
    const detail = [...versions].map(([version, names]) => `${version} (${names.join(', ')})`).join('; ')
    throw new Error(`the ${channel} channel disagrees across the @deepseek-ai/dsh-* family: ${detail}`)
  }
  return [...versions.keys()][0]
}

/** Every `name@version` an aligned devDependency pin requires the escape hatch to carry. */
function requiredExclusions(manifest, baseline, hostNames) {
  const required = new Set()
  for (const name of hostNames) {
    if (manifest.devDependencies?.[name] === baseline) required.add(name)
  }
  return required
}

/**
 * Compare the manifest against one baseline.
 * @returns `{ violations, hostNames }`, where each violation carries a stable `code`.
 */
function inspect(manifest, surface, baseline, exclusions) {
  const violations = []
  const peer = manifest.peerDependencies ?? {}
  const dev = manifest.devDependencies ?? {}
  const meta = manifest.peerDependenciesMeta ?? {}

  const names = new Set([...Object.keys(peer).filter(isHostPackage), ...Object.keys(dev).filter(isHostPackage), ...surface.keys()])
  const hostNames = [...names].sort()
  const expectedPeer = `^${baseline}`

  for (const name of hostNames) {
    const entry = surface.get(name)
    const where = entry?.reference
    // A package reached only through `import(...)` is mounted lazily and must degrade, so it is
    // an optional peer; a static import carries a compile-time contract and is a required peer.
    const lazyOnly = entry !== undefined && entry.dynamic && !entry.static
    // A client module is a host-supplied bundle external, never an installable capability:
    // it is pinned through devDependencies only, and only if the manifest already does so.
    const isDevOnlyClient = isClientPackage(name) && peer[name] === undefined
    if (!isDevOnlyClient && peer[name] === undefined) {
      violations.push({
        code: 'peer-missing',
        message: `${name} is imported${where === undefined ? '' : ` by ${where}`} but not declared in peerDependencies`
      })
    } else if (peer[name] !== undefined && peer[name] !== expectedPeer) {
      violations.push({ code: 'peer-stale', message: `peerDependencies["${name}"] is ${peer[name]}, expected ${expectedPeer}` })
    }
    if (!isDevOnlyClient && dev[name] === undefined) {
      violations.push({ code: 'dev-missing', message: `${name} has no devDependencies mirror (the host line this repo builds and tests against)` })
    } else if (dev[name] !== undefined && dev[name] !== baseline) {
      violations.push({ code: 'dev-stale', message: `devDependencies["${name}"] is ${dev[name]}, expected exact ${baseline}` })
    }
    if (lazyOnly && meta[name]?.optional !== true) {
      violations.push({ code: 'optional-undeclared', message: `${name} is reached only through import(...) (${where}) but peerDependenciesMeta does not mark it optional` })
    }
  }

  if (peer[CORDIS] !== undefined && dev[CORDIS] !== peer[CORDIS]) {
    violations.push({
      code: 'cordis-mirror',
      message: `${CORDIS} must carry one identical range in peerDependencies and devDependencies (peer ${peer[CORDIS]}, dev ${dev[CORDIS]})`
    })
  }

  for (const name of requiredExclusions(manifest, baseline, hostNames)) {
    const entry = exclusions.find(candidate => candidate.name === name)
    if (entry === undefined) {
      violations.push({ code: 'exclusion-missing', message: `${WORKSPACE_PATH} ${EXCLUDE_KEY} has no entry for ${name}` })
    } else if (!entry.versions.includes(baseline)) {
      violations.push({
        code: 'exclusion-stale',
        message: `${WORKSPACE_PATH} ${EXCLUDE_KEY} pins ${name} at ${entry.versions.join(' || ')}, which excludes ${baseline}`
      })
    }
  }

  return { violations, hostNames }
}

/**
 * Read the `minimumReleaseAgeExclude` entries out of a pnpm-workspace.yaml. pnpm merges repeated
 * updates for one package into a single `name@a || b` entry, so a version list — not a scalar —
 * is what this has to compare against.
 */
function parseExclusions(text) {
  const entries = []
  const lines = text.split('\n')
  const start = lines.findIndex(line => line.startsWith(`${EXCLUDE_KEY}:`))
  if (start === -1) return entries
  for (const line of lines.slice(start + 1)) {
    const raw = /^\s+-\s+(.+?)\s*$/.exec(line)?.[1]
    if (raw === undefined) break
    const value = raw.replace(/^['"]|['"]$/g, '')
    const split = /^(@[^@]+)@(.*)$/.exec(value)
    if (split === null) continue
    entries.push({
      name: split[1],
      versions: split[2]
        .split('||')
        .map(version => version.trim())
        .filter(version => version !== '')
    })
  }
  return entries
}

/**
 * Rewrite the exclude list in place, preserving every other key and its formatting.
 *
 * Only aligned host packages are normalized — one baseline each. Everything else (the transitive
 * entries pnpm writes for packages this repository does not declare) is pnpm's state and passes
 * through untouched.
 */
function withExclusions(text, entries) {
  const lines = text.split('\n')
  const start = lines.findIndex(line => line.startsWith(`${EXCLUDE_KEY}:`))
  const block = [...entries].sort((left, right) => left.name.localeCompare(right.name)).map(({ name, versions }) => `  - '${name}@${versions.join(' || ')}'`)
  if (start === -1) {
    const trimmed = lines.at(-1) === '' ? lines.slice(0, -1) : lines
    return `${[...trimmed, `${EXCLUDE_KEY}:`, ...block].join('\n')}\n`
  }
  let end = start + 1
  while (end < lines.length && /^\s+-\s/.test(lines[end])) end += 1
  return [...lines.slice(0, start), `${EXCLUDE_KEY}:`, ...block, ...lines.slice(end)].join('\n')
}

/** Write the manifest back with dependency sections re-sorted, matching the file's own style. */
function writeManifest(manifest) {
  for (const section of ['peerDependencies', 'devDependencies', 'peerDependenciesMeta']) {
    const table = manifest[section]
    if (table === undefined) continue
    manifest[section] = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)))
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/** Apply every fixable violation: pins, missing declarations, escape-hatch entries. */
function repair(manifest, surface, baseline, exclusionText) {
  const peer = (manifest.peerDependencies ??= {})
  const dev = (manifest.devDependencies ??= {})
  const meta = (manifest.peerDependenciesMeta ??= {})
  const names = new Set([...Object.keys(peer).filter(isHostPackage), ...Object.keys(dev).filter(isHostPackage), ...surface.keys()])

  for (const name of names) {
    if (peer[name] !== undefined || !isClientPackage(name)) peer[name] = `^${baseline}`
    dev[name] = baseline
    const entry = surface.get(name)
    if (entry?.dynamic && !entry.static) meta[name] = { optional: true }
  }

  const entries = new Map(parseExclusions(exclusionText).map(entry => [entry.name, entry]))
  for (const name of requiredExclusions(manifest, baseline, [...names])) {
    const entry = entries.get(name)
    if (entry === undefined) entries.set(name, { name, versions: [baseline] })
    else entry.versions = [baseline]
  }
  return withExclusions(exclusionText, [...entries.values()])
}

/** Human-readable report, one line per finding. */
function render({ baseline, channel, violations, hostNames, repaired }) {
  const lines = [`host baseline: ${baseline} (channel ${channel}) — ${hostNames.length} package(s) checked`]
  for (const violation of violations) lines.push(`  ✗ [${violation.code}] ${violation.message}`)
  if (violations.length === 0) lines.push('  ✓ every declared and dynamically imported host package matches the baseline')
  if (repaired) lines.push('  → package.json and pnpm-workspace.yaml repaired; run `pnpm install` to refresh pnpm-lock.yaml')
  return lines.join('\n')
}

async function main() {
  const manifestText = await read(MANIFEST_PATH)
  const manifest = JSON.parse(manifestText)
  const surface = scanHostSurface(SRC_DIR)
  const declared = new Set([...Object.keys(manifest.peerDependencies ?? {}).filter(isHostPackage), ...Object.keys(manifest.devDependencies ?? {}).filter(isHostPackage)])
  const candidates = [...new Set([...declared, ...surface.keys()])].sort()
  if (candidates.length === 0) throw new Error('no @deepseek-ai/dsh-* dependencies to align')

  const tags = await resolveDistTags(candidates)
  const baseline = baselineFrom(tags)

  let workspaceText = await read(WORKSPACE_PATH)
  let { violations, hostNames } = inspect(manifest, surface, baseline, parseExclusions(workspaceText))

  // `--fix` normalizes even a currently-passing tree, so the file always reads as exactly one
  // baseline instead of accumulating the version lists pnpm merges on every install.
  let repaired = false
  if (fix) {
    const nextWorkspace = repair(manifest, surface, baseline, workspaceText)
    const nextManifest = writeManifest(manifest)
    repaired = nextManifest !== manifestText || nextWorkspace !== workspaceText
    if (repaired) {
      await writeFile(MANIFEST_PATH, nextManifest)
      await writeFile(WORKSPACE_PATH, nextWorkspace)
      workspaceText = nextWorkspace
    }
    ;({ violations, hostNames } = inspect(manifest, surface, baseline, parseExclusions(workspaceText)))
  }

  if (useJson) {
    console.log(JSON.stringify({ baseline, channel, hostNames, repaired, violations }, null, 2))
  } else {
    console.log(render({ baseline, channel, violations, hostNames, repaired }))
    if (violations.length > 0 && !fix) {
      console.log('\nRun `pnpm run fix:host-alignment` to align package.json and pnpm-workspace.yaml, then `pnpm install`.')
    }
  }
  return violations.length === 0 ? 0 : 1
}

try {
  process.exitCode = await main()
} catch (error) {
  if (useJson) console.log(JSON.stringify({ error: String(error?.message ?? error) }, null, 2))
  else
    console.error(
      `host alignment gate could not run: ${error?.message ?? error}\nPin a baseline with --host-version <v>, or run once with network access to warm the dist-tag cache.`
    )
  process.exitCode = 2
}
