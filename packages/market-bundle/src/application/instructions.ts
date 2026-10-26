/**
 * The workspace instruction chain for one session, and the writes the page may
 * make to it.
 *
 * Discovery, load order, per-group content deduplication and the rendered byte
 * budget belong to `@deepseek-ai/dsh-agent-instructions`, the module that puts
 * the baseline into the prompt. This module calls that package through a lazy
 * `import(...)` and reports its own answer, so the page can never disagree with
 * what the model received: a row's status is read off `rendered.text`,
 * `rendered.omitted` and `rendered.truncated`, never recomputed here.
 *
 * The package is an optional peer. A profile that does not provide it gets
 * `available: false` and the package name, not a load failure.
 *
 * Two rules are mirrored from the host because it does not export them: the
 * `.git` climb that names the project root, and the escape that keeps a project
 * path out of the user-global display namespace. Both exist only to offer rows
 * for directories that hold no instruction file yet, and both are tested.
 * @module application/instructions
 */
import { lstat, readFile, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomeDisplay, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { resolveAgentsRoot } from '../../../market-catalog/src/index.js'
import {
  INSTRUCTION_CANDIDATES,
  INSTRUCTION_GLOBAL_CANDIDATE,
  type InstructionDeleteResult,
  type InstructionRow,
  type InstructionsPayload,
  type InstructionScope
} from '../../../market-contracts/src/contracts/instructions.js'

/** The package that owns the rules. Reached only through `import(...)`. */
const INSTRUCTIONS_PACKAGE = '@deepseek-ai/dsh-agent-instructions'

/** Host-provided default for the rendered baseline cap. Keep equal to the host row. */
export const DEFAULT_INSTRUCTION_MAX_BYTES = 65_536

/** Host-provided default for one file's source cap. Keep equal to the host row. */
export const DEFAULT_INSTRUCTION_MAX_SOURCE_BYTES = 1_048_576

/** Root markers the host climbs for. It does not export the list, so it is mirrored. */
const PROJECT_ROOT_MARKERS = ['.git'] as const

/**
 * Display directories the host keeps out of the project namespace. A project
 * directory named after one of them displays with a leading `./`.
 */
const RESERVED_SCOPE_DIRECTORIES = new Set(['user-global', 'agents-global'])

/** The byte limits one read or write runs under. */
export interface InstructionLimits {
  /** Cap on the whole rendered baseline; `0` or less disables loading. */
  maxBytes: number
  /** Cap on one file's UTF-8 bytes. */
  maxSourceBytes: number
}

/**
 * Validate the two configured byte limits.
 *
 * @param config - the plugin configuration's instruction fields.
 * @returns the limits the read and write paths use.
 * @throws when a limit is not a usable number, so a typo fails at load instead
 * of turning into an accidental "never loads".
 */
export function resolveInstructionLimits(config: { instructionMaxBytes?: number; instructionMaxSourceBytes?: number }): InstructionLimits {
  const maxBytes = config.instructionMaxBytes ?? DEFAULT_INSTRUCTION_MAX_BYTES
  const maxSourceBytes = config.instructionMaxSourceBytes ?? DEFAULT_INSTRUCTION_MAX_SOURCE_BYTES
  if (!Number.isInteger(maxBytes) || maxBytes < 0) throw new Error(`instructionMaxBytes must be a non-negative integer, received ${String(maxBytes)}`)
  if (!Number.isInteger(maxSourceBytes) || maxSourceBytes < 1) throw new Error(`instructionMaxSourceBytes must be a positive integer, received ${String(maxSourceBytes)}`)
  return { maxBytes, maxSourceBytes }
}

type HostInstructions = typeof import('@deepseek-ai/dsh-agent-instructions')

let hostModule: Promise<HostInstructions | undefined> | undefined

/**
 * Load the host module once.
 *
 * A missing package is a property of the profile, not a transient failure, so
 * the resolved `undefined` is cached alongside a successful load: the page
 * reports the same unavailable state on every refresh instead of re-probing.
 * @returns the module, or `undefined` when this profile does not provide it.
 */
function loadHost(): Promise<HostInstructions | undefined> {
  hostModule ??= import(INSTRUCTIONS_PACKAGE).then(
    module => module as HostInstructions,
    () => undefined
  )
  return hostModule
}

/** The two user-global roots, with the labels the host would display for them. */
interface InstructionHomes {
  dshHome: string
  agentsHome: string
  /** `~/.dsh` or `$DSH_HOME`, from the host's own display helper. */
  dshLabel: string
  /** `~/.agents` or `$DSH_AGENTS_HOME`, mirroring the host's helper of the same name. */
  agentsLabel: string
}

/**
 * Resolve both user-global roots.
 *
 * The path rules are the host's: `$DSH_HOME` then `~/.dsh`, and
 * `$DSH_AGENTS_HOME` then `~/.agents`. The agents label mirrors the host's
 * `agentsHomeDisplay`, which the installed line does not export.
 * @returns the resolved homes and their display labels.
 */
function readHomes(): InstructionHomes {
  const dshHome = resolveDshHome()
  const agentsHome = resolveAgentsRoot()
  const configured = process.env['DSH_AGENTS_HOME']
  const agentsLabel = configured === undefined || configured.trim() === '' ? '~/.agents' : '$DSH_AGENTS_HOME'
  return { dshHome, agentsHome, dshLabel: dshHomeDisplay(dshHome), agentsLabel }
}

/** One candidate the page can act on. */
interface CandidateTarget {
  scope: InstructionScope
  directory: string
  candidate: string
  absolutePath: string
  /** The display path: the host's own for a discovered file, mirrored otherwise. */
  displayPath: string
}

/** Whether a path error means "not there" rather than "cannot tell". */
function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

/**
 * Mirror of the host's root-marker probe: a marker is present when it exists as
 * anything, including the `.git` file a linked worktree carries.
 * @param path - the marker path inside one directory.
 * @returns whether the marker exists.
 * @throws the probe's own error when the filesystem refuses to answer.
 */
async function markerExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isMissingPathError(error)) return false
    throw error
  }
}

/**
 * Mirrored host rule: climb from `cwd` to the first directory holding a project
 * root marker, and fall back to `cwd` itself when none exists.
 *
 * The host does not export `findProjectRoot`, and the discovery result names
 * only files that already exist, so offering creation for a directory needs
 * this walk. A marker probe that fails for any reason other than absence
 * propagates: the page renders that reason instead of inventing a root.
 * @param cwd - absolute session working directory.
 * @param markers - marker names that identify a project root.
 * @returns the absolute project root.
 */
export async function projectRootOf(cwd: string, markers: readonly string[] = PROJECT_ROOT_MARKERS): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    for (const marker of markers) {
      if (await markerExists(join(current, marker))) return current
    }
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/** The inclusive root-to-cwd directory chain, broadest first. */
function ancestorChain(root: string, cwd: string): string[] {
  const chain: string[] = []
  let current = resolve(cwd)
  const resolvedRoot = resolve(root)
  while (current !== resolvedRoot) {
    chain.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  chain.push(resolvedRoot)
  return chain.reverse()
}

/**
 * Mirrored host rule: keep a project-relative display path out of the
 * user-global namespace by giving it a leading `./`.
 * @param relativePath - project-relative path using the platform separator.
 * @returns the path, escaped when its first segment collides with a reserved name.
 */
function escapeProjectDisplay(relativePath: string): string {
  const separatorIndex = relativePath.search(/[\\/]/)
  const first = separatorIndex < 0 ? relativePath : relativePath.slice(0, separatorIndex)
  return RESERVED_SCOPE_DIRECTORIES.has(first) ? `.${sep}${relativePath}` : relativePath
}

/** Every candidate the page may show or write, in host load order. */
function candidateTargets(cwd: string, projectRoot: string, homes: InstructionHomes): CandidateTarget[] {
  const targets: CandidateTarget[] = [
    {
      scope: 'user-global',
      directory: '.',
      candidate: INSTRUCTION_GLOBAL_CANDIDATE,
      absolutePath: join(homes.dshHome, INSTRUCTION_GLOBAL_CANDIDATE),
      displayPath: `${homes.dshLabel}/${INSTRUCTION_GLOBAL_CANDIDATE}`
    },
    {
      scope: 'agents-global',
      directory: '.',
      candidate: INSTRUCTION_GLOBAL_CANDIDATE,
      absolutePath: join(homes.agentsHome, INSTRUCTION_GLOBAL_CANDIDATE),
      displayPath: `${homes.agentsLabel}/${INSTRUCTION_GLOBAL_CANDIDATE}`
    }
  ]
  for (const directory of ancestorChain(projectRoot, cwd)) {
    const relativeDirectory = relative(projectRoot, directory)
    for (const candidate of INSTRUCTION_CANDIDATES) {
      const absolutePath = join(directory, candidate)
      targets.push({
        scope: 'project',
        directory: relativeDirectory === '' ? '.' : relativeDirectory,
        candidate,
        absolutePath,
        displayPath: escapeProjectDisplay(relative(projectRoot, absolutePath))
      })
    }
  }
  return targets
}

/** The candidate group a file deduplicates within: both user-global roots, or one directory. */
function candidateGroup(scope: InstructionScope, directory: string): string {
  return scope === 'project' ? `project:${directory}` : 'user-global'
}

/** The headers the renderer writes for one rendered file, as a set of display paths. */
function renderedHeaders(text: string): Set<string> {
  const headers = new Set<string>()
  for (const line of text.split('\n')) {
    if (line.startsWith('Instructions from: ')) headers.add(line.slice('Instructions from: '.length).trimEnd())
  }
  return headers
}

/** One candidate's on-disk facts. */
interface FileFacts {
  exists: boolean
  size?: number
}

/** Read one candidate's size without following a number the platform cannot supply. */
async function fileFacts(path: string): Promise<FileFacts> {
  try {
    const info = await stat(path)
    return info.isFile() ? { exists: true, size: info.size } : { exists: false }
  } catch {
    // A missing path and an unreadable one are the same fact for a row: it is
    // not a file this process can read. The render status still says what the
    // host did with it, because that answer comes from the host's own arrays.
    return { exists: false }
  }
}

/**
 * Derive one row's status from the host's rendered answer.
 *
 * The precedence is fixed by how the renderer works: a file can be truncated
 * and still absent from the text (the renderer falls back to a notice line when
 * nothing fits), so `truncated` is read first, then the rendered header, then
 * the omission list.
 * @param target - the candidate.
 * @param facts - its on-disk facts.
 * @param view - the host's rendered answer, indexed.
 * @param limits - the byte caps in force.
 * @param rows - the rows decided so far, in load order.
 * @returns the row.
 */
function buildRow(target: CandidateTarget, facts: FileFacts, view: RenderedView, limits: InstructionLimits, rows: InstructionRow[]): InstructionRow {
  const row: InstructionRow = {
    scope: target.scope,
    directory: target.directory,
    candidate: target.candidate,
    displayPath: target.displayPath,
    path: target.absolutePath,
    exists: facts.exists,
    ...(facts.size === undefined ? {} : { size: facts.size }),
    status: 'missing'
  }
  if (!facts.exists) return row
  const truncation = view.truncated.get(target.displayPath)
  if (truncation !== undefined) {
    return { ...row, status: 'truncated', originalBytes: truncation.originalBytes, includedBytes: truncation.includedBytes }
  }
  if (view.headers.has(target.displayPath)) return { ...row, status: 'loaded' }
  if (view.omitted.has(target.displayPath)) return { ...row, status: 'over-budget' }
  const repeated = repeatedEarlierCandidate(facts, limits, rows, row)
  if (repeated === undefined) return { ...row, status: 'source-over-budget' }
  if (repeated === null) return { ...row, status: 'not-included' }
  return { ...row, status: 'duplicate', duplicateOf: repeated }
}

/**
 * Explain a file that exists and is in no rendered array, as far as that can be
 * known without reading its content.
 *
 * Two causes are distinguishable. A file over the per-file cap is dropped while
 * it is being read, before deduplication, so it appears in no array at all and
 * its size names it. Otherwise, the host's rule is that an earlier candidate in
 * the same group already carried the same trimmed content, so the earliest
 * existing candidate in that group is what it repeats.
 * @param facts - the row's on-disk facts.
 * @param limits - the byte caps in force.
 * @param rows - the rows decided so far, in load order.
 * @param row - the row whose file is absent from every rendered array and header.
 * @returns the earlier candidate it repeats, `null` when no earlier candidate
 * explains it, or `undefined` when the per-file cap is the reason.
 */
function repeatedEarlierCandidate(facts: FileFacts, limits: InstructionLimits, rows: InstructionRow[], row: InstructionRow): string | null | undefined {
  if (facts.size !== undefined && facts.size > limits.maxSourceBytes) return undefined
  const group = candidateGroup(row.scope, row.directory)
  const earliest = rows.find(candidate => candidate.exists && candidateGroup(candidate.scope, candidate.directory) === group)
  return earliest?.displayPath ?? null
}

/** The host's rendered answer, indexed by display path. */
interface RenderedView {
  headers: Set<string>
  omitted: Set<string>
  truncated: Map<string, { originalBytes: number; includedBytes: number }>
}

/** One read's discovery result plus the host options it was read with. */
interface HostRead {
  hosts: HostInstructions
  projectRoot: string
  homes: InstructionHomes
}

/** Everything a read or write needs to name the chain. */
interface ChainContext extends HostRead {
  cwd: string
  limits: InstructionLimits
  targets: CandidateTarget[]
}

/** Resolve the chain context once, so a read and a write name the same candidates. */
function chainContext(cwd: string, limits: InstructionLimits, hosts: HostInstructions, projectRoot: string, homes: InstructionHomes): ChainContext {
  return { cwd, limits, hosts, projectRoot, homes, targets: candidateTargets(cwd, projectRoot, homes) }
}

/**
 * The discovery options, so the read and the render always describe one chain.
 * @param context - the resolved chain.
 * @returns the host's option object.
 */
function discoveryOptions(context: ChainContext): Parameters<HostInstructions['discoverBaselineInstructionFiles']>[0] {
  return {
    cwd: context.cwd,
    dshHome: context.homes.dshHome,
    agentsHome: context.homes.agentsHome,
    projectRootMarkers: [...PROJECT_ROOT_MARKERS],
    projectRoot: context.projectRoot
  }
}

/**
 * Read one session's instruction chain and its rendered baseline.
 *
 * @param cwd - the session's absolute working directory.
 * @param limits - the byte caps in force.
 * @returns the rows, the rendered baseline, and the budget it ran under.
 */
export async function readInstructions(cwd: string, limits: InstructionLimits): Promise<InstructionsPayload> {
  const hosts = await loadHost()
  const homes = readHomes()
  const base = { cwd: resolve(cwd), projectRoot: resolve(cwd), budget: limits.maxBytes, maxSourceBytes: limits.maxSourceBytes, total: 0 }
  if (hosts === undefined) {
    return {
      ...base,
      available: false,
      reason: `This profile does not provide the ${INSTRUCTIONS_PACKAGE} package, so no instruction chain can be read.`,
      rows: [],
      rendered: { text: '', omitted: [], truncated: [] }
    }
  }
  let context: ChainContext
  let discovered: Awaited<ReturnType<HostInstructions['discoverBaselineInstructionFiles']>>
  let rendered: Awaited<ReturnType<HostInstructions['loadBaselineInstructions']>>
  try {
    const projectRoot = await projectRootOf(cwd)
    context = chainContext(resolve(cwd), limits, hosts, projectRoot, homes)
    discovered = await hosts.discoverBaselineInstructionFiles(discoveryOptions(context))
    rendered = await hosts.loadBaselineInstructions({ ...discoveryOptions(context), maxBytes: limits.maxBytes, maxSourceBytes: limits.maxSourceBytes })
  } catch (error) {
    // A marker probe that reports anything but absence throws out of discovery,
    // and a symlink loop throws ELOOP. The page reports the reason; it must
    // never take the surface down with it.
    return {
      ...base,
      available: true,
      error: error instanceof Error ? error.message : String(error),
      rows: [],
      rendered: { text: '', omitted: [], truncated: [] }
    }
  }
  const text = rendered?.text ?? ''
  const view: RenderedView = {
    headers: renderedHeaders(text),
    omitted: new Set((rendered?.omitted ?? []).map(file => file.displayPath)),
    truncated: new Map((rendered?.truncated ?? []).map(item => [item.displayPath, { originalBytes: item.originalBytes, includedBytes: item.includedBytes }]))
  }
  const discoveredByPath = new Map(discovered.map(file => [resolve(file.absolutePath), file]))
  const rows: InstructionRow[] = []
  const claimed = new Set<string>()
  for (const target of context.targets) {
    const file = discoveredByPath.get(resolve(target.absolutePath))
    if (file !== undefined) claimed.add(resolve(file.absolutePath))
    const row = buildRow(file === undefined ? target : { ...target, displayPath: file.displayPath }, await fileFacts(target.absolutePath), view, limits, rows)
    rows.push(await withContent(row, limits))
  }
  // Discovery can name a file the chain above did not synthesize (an ancestor
  // outside the project root, or a display path the escape rule rewrote). It is
  // still part of the prompt, so it is listed rather than dropped.
  for (const file of discovered) {
    if (claimed.has(resolve(file.absolutePath))) continue
    const facts = await fileFacts(file.absolutePath)
    rows.push(
      buildRow(
        {
          scope: 'project',
          directory: dirname(file.displayPath),
          candidate: file.displayPath.slice(dirname(file.displayPath).length + 1),
          absolutePath: file.absolutePath,
          displayPath: file.displayPath
        },
        facts,
        view,
        limits,
        rows
      )
    )
  }
  return {
    ...base,
    available: true,
    projectRoot: context.projectRoot,
    total: Buffer.byteLength(text, 'utf8'),
    rows,
    rendered: { text, omitted: rendered?.omitted ?? [], truncated: rendered?.truncated ?? [] }
  }
}

/** Parse a write's target key strictly, rejecting a path where a name belongs. */
function targetKey(input: Record<string, unknown>): string {
  const scope = input['scope']
  if (scope !== 'user-global' && scope !== 'agents-global' && scope !== 'project') throw new Error(`unknown instruction scope "${String(scope)}"`)
  const directory = input['directory']
  if (typeof directory !== 'string' || directory === '') throw new Error('directory must be a non-empty string')
  if (isAbsolute(directory)) throw new Error('directory must be relative to the project root, not an absolute path')
  const candidate = input['candidate']
  if (typeof candidate !== 'string' || candidate === '') throw new Error('candidate must be a non-empty string')
  if (candidate.includes('/') || candidate.includes('\\') || candidate === '.' || candidate === '..') throw new Error(`"${candidate}" is not a candidate file name`)
  return `${scope}\u0000${directory}\u0000${candidate}`
}

/** Resolve the one target a request names, or refuse it. */
function resolveTarget(targets: CandidateTarget[], input: Record<string, unknown>): CandidateTarget {
  const key = targetKey(input)
  const target = targets.find(candidate => `${candidate.scope}\u0000${candidate.directory}\u0000${candidate.candidate}` === key)
  if (target === undefined) {
    throw new Error(`${String(input['scope'])} ${String(input['directory'])} ${String(input['candidate'])} is not an instruction candidate this session loads`)
  }
  return target
}

/** Resolve the chain a write runs against, refusing when the host module is absent. */
async function writableChain(cwd: string, limits: InstructionLimits): Promise<ChainContext> {
  const hosts = await loadHost()
  if (hosts === undefined) throw new Error(`This profile does not provide the ${INSTRUCTIONS_PACKAGE} package`)
  const homes = readHomes()
  const projectRoot = await projectRootOf(cwd)
  return chainContext(resolve(cwd), limits, hosts, projectRoot, homes)
}

/**
 * Create or replace one candidate file.
 *
 * The body names a candidate, never a path. The write is atomic and creates the
 * parent directory only for a location the server itself derived, so a request
 * cannot reach any file the session does not load.
 * @param cwd - the session's absolute working directory.
 * @param input - an untrusted request body.
 * @param limits - the byte caps in force.
 * @throws when the target is not a session candidate, or the text exceeds the per-file cap.
 */
export async function saveInstruction(cwd: string, input: Record<string, unknown>, limits: InstructionLimits): Promise<void> {
  const target = resolveTarget((await writableChain(cwd, limits)).targets, input)
  const text = input['text']
  if (typeof text !== 'string') throw new Error('text must be a string')
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > limits.maxSourceBytes) throw new Error(`${target.candidate} is ${bytes} bytes, over the ${limits.maxSourceBytes} byte per-file limit, so it would never load`)
  await writeFileAtomic(target.absolutePath, text, { mode: 0o644, dirMode: 0o700 })
}

/**
 * Attach one existing file's text so the editor opens on what is on disk.
 *
 * A file over the per-file cap would never load, and reading it here would
 * contradict that, so its content stays absent and the row says why.
 * @param row - the row built from the host's rendered answer.
 * @param limits - the byte caps in force.
 * @returns the row, with `content` when the file can carry it.
 */
async function withContent(row: InstructionRow, limits: InstructionLimits): Promise<InstructionRow> {
  if (!row.exists || (row.size !== undefined && row.size > limits.maxSourceBytes)) return row
  try {
    return { ...row, content: await readFile(row.path, 'utf8') }
  } catch {
    // An unreadable file keeps its status and simply offers no draft.
    return row
  }
}

/** One file's identity, as the platform reports it. */
interface FileIdentity {
  dev: number
  ino: number
}

/** The identity two paths share when they resolve to one file, when the platform reports one. */
async function identityOf(path: string): Promise<FileIdentity | undefined> {
  try {
    const info = await stat(path)
    return info.ino === 0 ? undefined : { dev: Number(info.dev), ino: Number(info.ino) }
  } catch {
    return undefined
  }
}

/**
 * Remove one candidate file and report what else resolves to it.
 *
 * A chain can carry two names for one file: `CLAUDE.md` symlinked to
 * `AGENTS.md` is the common shape, and a hard link is the other. Deleting one
 * name leaves the other in place, so the response names the aliases and says
 * whether this entry was itself a link.
 * @param cwd - the session's absolute working directory.
 * @param input - an untrusted request body.
 * @param limits - the byte caps in force.
 * @returns the alias display paths and whether the removed entry was a link.
 */
export async function deleteInstruction(cwd: string, input: Record<string, unknown>, limits: InstructionLimits): Promise<InstructionDeleteResult> {
  const context = await writableChain(cwd, limits)
  const target = resolveTarget(context.targets, input)
  // A path that cannot be stat is not a link, and the identity read below is
  // what decides whether this entry can be deleted at all.
  const targetIsLink = await lstat(target.absolutePath)
    .then(info => info.isSymbolicLink())
    .catch(() => false)
  const identity = await identityOf(target.absolutePath)
  if (identity === undefined) throw new Error(`${target.displayPath} is not a file this session can delete`)
  const aliases: string[] = []
  for (const candidate of context.targets) {
    if (candidate.absolutePath === target.absolutePath) continue
    const other = await identityOf(candidate.absolutePath)
    if (other !== undefined && other.dev === identity.dev && other.ino === identity.ino) aliases.push(candidate.displayPath)
  }
  await unlink(target.absolutePath)
  return { aliases, targetIsLink }
}
