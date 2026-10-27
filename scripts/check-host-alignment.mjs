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
 * This gate resolves the host release line from the registry (`next` by default), then fails
 * unless every declared and referenced host dependency matches that one baseline. The harness
 * family publishes prerelease candidates (rc and later) to `next` and repoints `latest` only at
 * stable releases, so while the host runs a prerelease line `next` is the only tag naming the
 * version consumers actually install; `latest` lags behind by whole candidate lines. The baseline
 * is the `next` version of `@deepseek-ai/dsh` itself: it is the package a consumer installs, and
 * the only family member whose tags track the release line. The capability packages publish in
 * lockstep to `next`, while their own `latest` tags still sit on early placeholders, so they
 * cannot decide the baseline.
 *
 * - a `dependencies` entry carries the support range: this plugin provisions that capability itself,
 *   so pnpm installs it into the consuming profile (a dsh profile sets `autoInstallPeers: false`,
 *   which makes a peer contract a declaration the host has to satisfy on its own);
 * - a `peerDependencies` entry carries the support range and an exact `<baseline>` dev mirror;
 * - anything `src/` imports is declared in one of the two sections above;
 * - a package reached only through `import(...)` is an optional peer, because it is mounted
 *   lazily and must degrade instead of failing — unless this plugin provisions it itself;
 * - a package imported for value is never optional: the marker promises the plugin still works
 *   when the package is absent, and a value import fails module evaluation instead. The marker
 *   stays valid for a type-only import, whose cordis augmentation costs nothing at runtime;
 * - `@deepseek-ai/cordis` carries one identical range in peer and dev (it tracks its own 4.x line);
 * - `pnpm-workspace.yaml` `minimumReleaseAgeExclude` admits the baseline for every aligned package,
 *   and for every host package the lockfile resolves at that baseline. The second half matters
 *   because pnpm's age policy covers the whole resolved graph: a host package arriving
 *   transitively needs its own exemption, and demanding it only for manifest entries left 26 of
 *   them stale while this gate reported green.
 *
 * `@deepseek-ai/dsh-client-*` is exempt from the peer rules: those are host-supplied bundle
 * externals, pinned through devDependencies only and never installable capabilities. Host packages
 * used only by tests also stay dev-only; production source imports still require a runtime declaration.
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
const SRC_DIR = join(ROOT, 'packages')
const CACHE_PATH = join(ROOT, 'node_modules', '.cache', 'host-alignment', 'dist-tags.json')

/** Host capability packages share this scope prefix and one release version. */
const HOST_PREFIX = '@deepseek-ai/dsh-'
/**
 * The package whose dist-tag is the family release line. A consumer installs the CLI, and the
 * capability packages carry placeholder `latest` tags from their first publishes, so the CLI is
 * the only family member that can answer which version has actually shipped.
 */
const HOST_ANCHOR = '@deepseek-ai/dsh'
/**
 * The support window every consumer-facing host pin must carry.
 *
 * A caret range is an anchor, not a contract: `^0.2.1-rc.2` excludes the 0.2.1-rc.1 candidate
 * the host shipped the day before, and a host that refuses an unmet peer range marks the plugin
 * incompatible on its own plugin page. The window states the two facts a consumer needs — the
 * oldest host release this code runs on, and the major line it never crosses — so a candidate
 * between them keeps working without a release here.
 *
 * The floor moves only when the plugin drops a release line on purpose; `baselineFrom` still
 * decides which exact version this repository builds and tests against.
 */
const HOST_SUPPORT_FLOOR = '0.2.0-rc.2'
const HOST_SUPPORT_CEILING = '0.3.0-0'
const HOST_SUPPORT_RANGE = `>=${HOST_SUPPORT_FLOOR} <${HOST_SUPPORT_CEILING}`
/** Client modules are host-supplied bundle externals, not installable capabilities. */
const CLIENT_PREFIX = '@deepseek-ai/dsh-client-'
/** Cordis is the plugin container; it tracks its own 4.x line, not the dsh family version. */
const CORDIS = '@deepseek-ai/cordis'
/** `pnpm-workspace.yaml` key carrying the supply-chain escape hatch pnpm writes. */
const EXCLUDE_KEY = 'minimumReleaseAgeExclude'
/** The lockfile, read for the full resolved graph the age policy also covers. */
const LOCK_PATH = 'pnpm-lock.yaml'

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
 * Whether the import statement ending at `end` is type-only.
 *
 * The nearest preceding `import` or `export` keyword opens the statement, so `import type { X }
 * from` and `import type {}` from both read as type-only while a mixed `import { type X, y }`
 * reads as a value import. A type-only import is erased at build time, so the package it names
 * carries no runtime obligation.
 * @param source - file contents.
 * @param end - index of the `from` keyword that closes the statement's bindings.
 * @returns true when the statement is type-only.
 */
function isTypeOnly(source, end) {
  const open = Math.max(source.lastIndexOf('import', end), source.lastIndexOf('export', end))
  return open !== -1 && /^(?:import|export)\s+type\b/.test(source.slice(open, end))
}

/**
 * Collect host package names a source tree imports, so an undeclared dependency cannot hide
 * behind a dynamic import. Dynamic imports keep the specifier in a `const` (the optional
 * dependency must stay non-literal for bundlers), so an identifier resolved through `import(...)`
 * counts too.
 * @param dir - directory to walk.
 * @returns map of host package name to `{ reference, static, value, dynamic }`, where `reference`
 * is the first `file` that mentions it; `value` means a production file imports it for value, a
 * package seen only through `import(...)` is a lazily mounted capability, and one seen only
 * through `import type` is erased at build time.
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
      if (entry === 'node_modules') continue
      const path = join(current, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.[cm]?[jt]sx?$/.test(entry)) files.push(path)
    }
  }
  walk(dir)

  for (const path of files) {
    const source = readFileSync(path, 'utf8')
    const record = (name, kind) => {
      if (isClientPackage(name)) return
      const isTest = /(^|\/)test\//.test(relative(ROOT, path))
      const entry = found.get(name) ?? { reference: relative(ROOT, path), static: false, value: false, dynamic: false, inSrc: false, inTest: false }
      entry[kind === 'dynamic' ? 'dynamic' : 'static'] = true
      // A type-only import is erased, so only a value import obliges the package at runtime.
      if (kind === 'value' && !isTest) entry.value = true
      if (isTest) entry.inTest = true
      else entry.inSrc = true
      found.set(name, entry)
    }
    for (const match of source.matchAll(/(from|require\s*\()\s*'(@deepseek-ai\/dsh-[a-z0-9-]+)'/g)) {
      // A `require(` specifier names a runtime load; only a `from` clause can belong to a type-only statement.
      record(match[2], match[1] === 'from' && isTypeOnly(source, match.index) ? 'type' : 'value')
    }
    for (const match of source.matchAll(/(?:^|[;\s])import\s+'(@deepseek-ai\/dsh-[a-z0-9-]+)'/g)) record(match[1], 'value')
    for (const match of source.matchAll(/import\(\s*'(@deepseek-ai\/dsh-[a-z0-9-]+)'/g)) record(match[1], 'dynamic')
    // A host specifier held in a top-level `const` exists to be imported dynamically — possibly
    // through a helper that takes the literal as an argument — so the reference is recorded where
    // the literal is declared rather than only where the `import(...)` call appears.
    for (const match of source.matchAll(/const\s+[A-Za-z_$][\w$]*\s*=\s*'(@deepseek-ai\/dsh-[a-z0-9-]+)'/g)) record(match[1], 'dynamic')
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

  // The registry answers each request fine, but a burst of ~20 concurrent
  // connections from one process trips this network's per-host throttling and
  // fails a third of them with an opaque "fetch failed". Walking the names
  // serially keeps the whole run to a few seconds and every request succeeds.
  const resolved = new Map()
  for (const name of names) {
    const url = `https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags`
    const response = await fetch(url, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`${name}: registry responded ${response.status} for dist-tag ${channel}`)
    const tags = await response.json()
    if (typeof tags?.[channel] !== 'string') throw new Error(`${name}: registry has no ${channel} dist-tag`)
    resolved.set(name, tags)
  }

  const merged = { fetchedAt: Date.now(), tags: { ...Object.fromEntries(cached), ...Object.fromEntries(resolved) } }
  await mkdir(dirname(CACHE_PATH), { recursive: true })
  await writeFile(CACHE_PATH, `${JSON.stringify(merged, null, 2)}\n`)
  return new Map(resolved)
}

/**
 * The one baseline every host package must carry: the anchor's version on the selected channel.
 *
 * `next` is the default because the harness family publishes prerelease candidates there and only
 * repoints `latest` at stable releases; the 2026-09-22 note that moved the default to `latest`
 * judged a `next` tag nobody would release, which no longer describes the family's flow (see the
 * superseding note).
 */
function baselineFrom(tags) {
  const version = tags.get(HOST_ANCHOR)?.[channel]
  if (typeof version !== 'string') {
    throw new Error(`${HOST_ANCHOR}: registry has no ${channel} dist-tag to resolve the baseline from`)
  }
  return version
}

/**
 * Every host package the supply-chain escape hatch must admit at the baseline.
 *
 * Two sources, because pnpm's minimum-release-age policy covers the whole resolved
 * graph rather than the packages this repo names. First, every host package this
 * repo pins directly. Second, every host package the lockfile already resolves at
 * the baseline, which is where transitive dependencies enter: a host package pulled
 * in by another host package needs its own exemption, and a fixer that only reads
 * the manifest leaves those 26 entries stale.
 * @param manifest - the parsed root package.json.
 * @param baseline - the resolved host version.
 * @param hostNames - host packages this repo imports or declares.
 * @param lockedAtBaseline - host packages the lockfile resolves at the baseline.
 * @returns the names that must appear in the exclusion list.
 */
function requiredExclusions(manifest, baseline, hostNames, lockedAtBaseline) {
  const required = new Set(lockedAtBaseline)
  for (const name of hostNames) {
    if (manifest.devDependencies?.[name] === baseline) required.add(name)
    else if (manifest.dependencies?.[name] === HOST_SUPPORT_RANGE) required.add(name)
  }
  return required
}

/**
 * Host packages the lockfile resolves at one version.
 * @param lockText - pnpm-lock.yaml contents.
 * @param baseline - the version to look for.
 * @returns the package names resolved at that version.
 */
function lockedHostPackages(lockText, baseline) {
  const found = new Set()
  // A pin in the importers block is `  name@version`, and a resolution in the packages block is
  // `  'name@version':` optionally followed by a peer-suffix. Only the first two tokens matter,
  // so the line is split rather than parsed.
  const suffix = '@' + baseline
  for (const raw of lockText.split('\n')) {
    const line = raw.trim().replace(/^'/u, '')
    const at = line.indexOf(HOST_PREFIX)
    if (at !== 0) continue
    const name = line.slice(0, line.indexOf(suffix) === -1 ? 0 : line.indexOf(suffix))
    if (!name.endsWith('') || name.length <= HOST_PREFIX.length) continue
    const versionStart = line.indexOf('@', HOST_PREFIX.length)
    if (versionStart === -1) continue
    const version = line.slice(versionStart + 1).split(/['":(]/u)[0]
    if (version !== baseline) continue
    if (/^[a-z0-9-]+$/u.test(name.slice(HOST_PREFIX.length))) found.add(name)
  }
  return found
}

/**
 * Compare the manifest against one baseline.
 * @returns `{ violations, hostNames }`, where each violation carries a stable `code`.
 */
function inspect(manifest, surface, baseline, exclusions, lockedAtBaseline) {
  const violations = []
  const peer = manifest.peerDependencies ?? {}
  const dev = manifest.devDependencies ?? {}
  const deps = manifest.dependencies ?? {}
  const meta = manifest.peerDependenciesMeta ?? {}

  const names = new Set([...Object.keys(peer).filter(isHostPackage), ...Object.keys(dev).filter(isHostPackage), ...Object.keys(deps).filter(isHostPackage), ...surface.keys()])
  const hostNames = [...names].sort()
  const expectedPeer = HOST_SUPPORT_RANGE

  for (const name of hostNames) {
    const entry = surface.get(name)
    const where = entry?.reference
    // A package reached only through `import(...)` is mounted lazily and must degrade, so it is
    // an optional peer; a static import carries a compile-time contract and is a required peer.
    const lazyOnly = entry !== undefined && entry.dynamic && !entry.static
    // `dependencies` and `peerDependencies` are two different provisioning answers: a dependency
    // is installed into the consuming profile by pnpm, a peer must already be supplied by the host.
    // A self-provisioned package therefore needs no peer contract and no dev mirror.
    const selfProvisioned = deps[name] !== undefined
    // A client module is a host-supplied bundle external, never an installable capability:
    // it is pinned through devDependencies only, and only if the manifest already does so.
    const isDevOnlyClient = isClientPackage(name) && peer[name] === undefined && !selfProvisioned
    // A package absent from production imports can support tests without imposing a consumer peer.
    const isDevOnlyTest = entry === undefined && dev[name] !== undefined && peer[name] === undefined && !selfProvisioned

    if (selfProvisioned && deps[name] !== expectedPeer) {
      violations.push({ code: 'dependency-stale', message: `dependencies["${name}"] is ${deps[name]}, expected ${expectedPeer}` })
    }
    if (peer[name] !== undefined && peer[name] !== expectedPeer) {
      violations.push({ code: 'peer-stale', message: `peerDependencies["${name}"] is ${peer[name]}, expected ${expectedPeer}` })
    } else if (!isDevOnlyClient && !isDevOnlyTest && entry !== undefined && !entry.inSrc && entry.inTest && !selfProvisioned && peer[name] === undefined) {
      // A package imported only from a test/ tree supports this repository's own builds and
      // tests; the exact dev mirror below pins it, and no consumer peer is imposed.
    } else if (!isDevOnlyClient && !isDevOnlyTest && !selfProvisioned && peer[name] === undefined) {
      violations.push({
        code: 'undeclared',
        message: `${name} is imported${where === undefined ? '' : ` by ${where}`} but declared in neither dependencies nor peerDependencies`
      })
    }
    if (dev[name] !== undefined && dev[name] !== baseline) {
      violations.push({ code: 'dev-stale', message: `devDependencies["${name}"] is ${dev[name]}, expected exact ${baseline}` })
    } else if (!isDevOnlyClient && !selfProvisioned && dev[name] === undefined) {
      violations.push({ code: 'dev-missing', message: `${name} has no devDependencies mirror (the host line this repo builds and tests against)` })
    }
    if (lazyOnly && !selfProvisioned && meta[name]?.optional !== true) {
      violations.push({ code: 'optional-undeclared', message: `${name} is reached only through import(...) (${where}) but peerDependenciesMeta does not mark it optional` })
    }
    // The optional marker promises the plugin still works when the package is absent. A value
    // import refuses to evaluate without it, so the marker has to go: the package becomes a
    // required peer, or a dependency when this plugin provisions it.
    if (entry?.value && entry.inSrc && !lazyOnly && !selfProvisioned && meta[name]?.optional === true) {
      violations.push({
        code: 'optional-static',
        message: `${name} is imported for value by ${where} but peerDependenciesMeta marks it optional; a value import needs a required peer or a dependencies entry`
      })
    }
  }

  if (peer[CORDIS] !== undefined && dev[CORDIS] !== peer[CORDIS]) {
    violations.push({
      code: 'cordis-mirror',
      message: `${CORDIS} must carry one identical range in peerDependencies and devDependencies (peer ${peer[CORDIS]}, dev ${dev[CORDIS]})`
    })
  }

  for (const name of requiredExclusions(manifest, baseline, hostNames, lockedAtBaseline)) {
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
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies', 'peerDependenciesMeta']) {
    const table = manifest[section]
    if (table === undefined) continue
    manifest[section] = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)))
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/** Apply every fixable violation: pins, missing declarations, escape-hatch entries. */
function repair(manifest, surface, baseline, exclusionText, lockedAtBaseline) {
  const peer = (manifest.peerDependencies ??= {})
  const dev = (manifest.devDependencies ??= {})
  const meta = (manifest.peerDependenciesMeta ??= {})
  const deps = manifest.dependencies ?? {}
  const names = new Set([...Object.keys(peer).filter(isHostPackage), ...Object.keys(dev).filter(isHostPackage), ...Object.keys(deps).filter(isHostPackage), ...surface.keys()])
  const expected = HOST_SUPPORT_RANGE

  for (const name of names) {
    // Repair never moves a package between sections: declaring a capability as a dependency is an
    // author decision about who provisions it, and this script only keeps the pinned value aligned.
    const selfProvisioned = deps[name] !== undefined
    if (selfProvisioned) deps[name] = expected
    else if (peer[name] !== undefined || (!isClientPackage(name) && (surface.has(name) || dev[name] === undefined))) peer[name] = expected
    if (!selfProvisioned) {
      dev[name] = baseline
      const entry = surface.get(name)
      if (entry?.dynamic && !entry.static) meta[name] = { optional: true }
      // A value import cannot honor the optional marker, so repair drops it instead of shipping it.
      else if (entry?.value && entry.inSrc) delete meta[name]
    }
  }

  const entries = new Map(parseExclusions(exclusionText).map(entry => [entry.name, entry]))
  for (const name of requiredExclusions(manifest, baseline, [...names], lockedAtBaseline)) {
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

/**
 * Whether the resolved baseline still sits inside the declared support window.
 *
 * Only `major.minor` decides: the window names release lines, and every candidate version inside
 * one shares them. A baseline outside the window means the gate would pin a dev mirror the shipped
 * range refuses, so the maintainer must move the floor and ceiling deliberately.
 * @param baseline - the version resolved from the channel.
 * @returns true when the baseline belongs to the declared window.
 */
function baselineInWindow(baseline) {
  const line = version => version.split('-')[0].split('.').slice(0, 2).map(Number)
  const compare = (left, right) => left[0] - right[0] || left[1] - right[1]
  const current = line(baseline)
  return compare(current, line(HOST_SUPPORT_FLOOR)) >= 0 && compare(current, line(HOST_SUPPORT_CEILING)) < 0
}

async function main() {
  const manifestText = await read(MANIFEST_PATH)
  const manifest = JSON.parse(manifestText)
  const surface = scanHostSurface(SRC_DIR)
  const declared = new Set([...Object.keys(manifest.peerDependencies ?? {}).filter(isHostPackage), ...Object.keys(manifest.devDependencies ?? {}).filter(isHostPackage)])
  const candidates = [...new Set([...declared, ...surface.keys()])].sort()
  if (candidates.length === 0) throw new Error('no @deepseek-ai/dsh-* dependencies to align')

  const tags = await resolveDistTags([...candidates, HOST_ANCHOR])
  const baseline = baselineFrom(tags)
  if (!baselineInWindow(baseline)) {
    throw new Error(`resolved baseline ${baseline} is outside the declared support window ${HOST_SUPPORT_RANGE}; move HOST_SUPPORT_FLOOR/HOST_SUPPORT_CEILING before releasing`)
  }

  // pnpm's age policy covers the whole resolved graph, so a host package pulled in
  // transitively needs its own exemption even though this repo never names it. A
  // fixture that exercises only the manifest and exclusion rules carries no lockfile,
  // so a missing one is an empty resolved graph rather than a failure. Naming ENOENT
  // keeps a real read error loud.
  const lockText = await read(LOCK_PATH).catch(error => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
  const lockedAtBaseline = lockedHostPackages(lockText, baseline)

  let workspaceText = await read(WORKSPACE_PATH)
  let { violations, hostNames } = inspect(manifest, surface, baseline, parseExclusions(workspaceText), lockedAtBaseline)

  // `--fix` normalizes even a currently-passing tree, so the file always reads as exactly one
  // baseline instead of accumulating the version lists pnpm merges on every install.
  let repaired = false
  if (fix) {
    const nextWorkspace = repair(manifest, surface, baseline, workspaceText, lockedAtBaseline)
    const nextManifest = writeManifest(manifest)
    repaired = nextManifest !== manifestText || nextWorkspace !== workspaceText
    if (repaired) {
      await writeFile(MANIFEST_PATH, nextManifest)
      await writeFile(WORKSPACE_PATH, nextWorkspace)
      workspaceText = nextWorkspace
    }
    ;({ violations, hostNames } = inspect(manifest, surface, baseline, parseExclusions(workspaceText), lockedAtBaseline))
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
