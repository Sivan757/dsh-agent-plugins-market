#!/usr/bin/env node
/**
 * Point this repository at the host's skills directory.
 *
 * The repository used to carry two copies of host skills under '.agents/skills/market-*'. A copy
 * is a snapshot: the host kept moving, the copies did not, and the divergence stayed invisible
 * until someone read both. The host already ships these skills, so this repository links them
 * instead of restating them, and keeps only the facts that are this repository's own.
 *
 * Commands
 *   node scripts/host-skills.mjs link [--source <dir>] [--quiet]   create or refresh the link
 *   node scripts/host-skills.mjs check                              report the link and the drift
 *
 * The host directory is resolved from '--source', then DSH_HOST_SKILLS_DIR, then the harness
 * checkout, then the 'dsh-workflow' plugin bundle, then an installed copy of that bundle under the
 * marketplace state. A machine without any of them reports the absence and exits 0: the link is a
 * local convenience, not a build input, so CI stays green without it.
 *
 * 'check' fails only when this repository carries skill copies again. A missing or broken link is
 * a warning, because it is local state the next install repairs.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const LINK_PATH = join(ROOT, '.agents', 'skills')
const AGENTS_PATH = join(ROOT, 'AGENTS.md')
const ROUTING_BEGIN = '<!-- dsh-workflow:begin -->'
const ROUTING_END = '<!-- dsh-workflow:end -->'

/** Host directories to try, most authoritative first. */
const HOST_CANDIDATES = [join(homedir(), 'workspace', 'deepseek-harness', '.agents', 'skills'), join(homedir(), 'workspace', 'agent-plugins', 'plugins', 'dsh-workflow', 'skills')]

/** Where the marketplace keeps the sources it checked out. */
const MARKETPLACE_ROOT = join(homedir(), '.dsh', 'agent-plugins', '.sources')

function parseArgs(argv) {
  const options = { command: 'link', source: undefined, quiet: false }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--source') options.source = argv[++index]
    else if (argument === '--quiet') options.quiet = true
    else if (argument === 'link' || argument === 'check') options.command = argument
    else {
      console.error(`host-skills: unknown argument ${JSON.stringify(argument)}`)
      console.error('host-skills: usage: host-skills.mjs [link|check] [--source <dir>] [--quiet]')
      process.exit(2)
    }
  }
  return options
}

/** The skill names a host directory publishes, read from each skill's frontmatter. */
function listSkillNames(directory) {
  const names = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillFile = join(directory, entry.name, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const frontmatter = readFileSync(skillFile, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)
    const declared = frontmatter?.[1].match(/^name:\s*(.+)$/m)?.[1]?.trim()
    names.push(declared ?? entry.name)
  }
  return names.sort()
}

/** A directory of host skills: it holds at least one skill. */
function isHostDirectory(path) {
  try {
    if (!lstatSync(path).isDirectory()) return false
    return listSkillNames(path).length > 0
  } catch {
    return false
  }
}

/** The skill names the managed routing block in AGENTS.md points at. */
function listRoutedNames() {
  if (!existsSync(AGENTS_PATH)) return []
  const agents = readFileSync(AGENTS_PATH, 'utf8')
  const begin = agents.indexOf(ROUTING_BEGIN)
  const end = agents.indexOf(ROUTING_END)
  if (begin === -1 || end === -1 || end < begin) return []
  const names = []
  for (const line of agents.slice(begin, end).split('\n')) {
    const cells = line.split('|').map(cell => cell.trim())
    if (cells.length < 4) continue
    const candidate = cells[cells.length - 2]
    if (/^[a-z0-9][a-z0-9-]*$/.test(candidate)) names.push(candidate)
  }
  return names
}

/** An installed copy of the workflow bundle, for a machine that never cloned the host repos. */
function findMarketplaceBundle() {
  let sources = []
  try {
    sources = readdirSync(MARKETPLACE_ROOT, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const source of sources) {
    if (!source.isDirectory()) continue
    const bundle = join(MARKETPLACE_ROOT, source.name, 'plugins', 'dsh-workflow', 'skills')
    if (isHostDirectory(bundle)) return bundle
  }
  return undefined
}

function resolveHostSource(explicit) {
  const candidates = [explicit, process.env.DSH_HOST_SKILLS_DIR, ...HOST_CANDIDATES].filter(Boolean)
  for (const candidate of candidates) {
    const path = resolve(candidate)
    if (isHostDirectory(path)) return path
  }
  return findMarketplaceBundle()
}

/** Where the link points right now, whether it is a link at all. */
function readLink() {
  try {
    const stats = lstatSync(LINK_PATH)
    if (!stats.isSymbolicLink()) return { kind: 'directory', entries: readdirSync(LINK_PATH) }
    try {
      return { kind: 'link', target: realpathSync(LINK_PATH) }
    } catch {
      return { kind: 'broken', target: readlinkSync(LINK_PATH) }
    }
  } catch {
    return { kind: 'absent' }
  }
}

function link(source, quiet) {
  const current = readLink()
  if (current.kind === 'directory' && current.entries.length > 0) {
    console.warn(`host-skills: ${LINK_PATH} holds ${current.entries.length} entries; leaving it alone. This repository carries no skills of its own — move or delete them first.`)
    return 0
  }
  if (current.kind === 'link' && current.target === source) {
    if (!quiet) console.log(`host-skills: .agents/skills already points at ${source}`)
    return 0
  }
  rmSync(LINK_PATH, { recursive: true, force: true })
  symlinkSync(source, LINK_PATH, 'dir')
  if (!quiet) console.log(`host-skills: linked .agents/skills -> ${source} (${listSkillNames(source).length} skills)`)
  return 0
}

function check() {
  const problems = []
  const current = readLink()
  if (current.kind === 'directory') {
    problems.push(`.agents/skills is a directory with ${current.entries.length} entries; this repository links the host's skills instead of carrying copies`)
  } else if (current.kind === 'link') {
    console.log(`host-skills: .agents/skills -> ${current.target}`)
  } else if (current.kind === 'broken') {
    console.warn(`host-skills: .agents/skills points at ${current.target}, which no longer exists; run node scripts/host-skills.mjs link`)
  } else {
    console.log('host-skills: .agents/skills is not linked; run node scripts/host-skills.mjs link')
  }

  const source = current.kind === 'link' ? current.target : resolveHostSource()
  if (source === undefined) {
    console.log('host-skills: no host skills directory found; nothing to compare against')
    return problems.length === 0 ? 0 : 1
  }

  const available = listSkillNames(source)
  const routed = listRoutedNames()
  console.log(`host-skills: ${available.length} skills available from ${source}`)
  const missing = routed.filter(name => !available.includes(name))
  const unrouted = available.filter(name => !routed.includes(name))
  if (missing.length > 0) console.warn(`host-skills: the routing table points at ${missing.length} skill(s) the host does not publish: ${missing.join(', ')}`)
  if (unrouted.length > 0) console.log(`host-skills: ${unrouted.length} host skill(s) are not routed: ${unrouted.join(', ')}`)

  for (const problem of problems) console.error(`host-skills: ${problem}`)
  return problems.length === 0 ? 0 : 1
}

const options = parseArgs(process.argv.slice(2))
if (options.command === 'check') process.exit(check())
const source = resolveHostSource(options.source)
if (source === undefined) {
  if (!options.quiet) console.log('host-skills: no host skills directory found; skipping the link')
  process.exit(0)
}
process.exit(link(source, options.quiet))
