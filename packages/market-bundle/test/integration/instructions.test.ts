import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { INSTRUCTION_ROUTES } from '../../../../packages/market-contracts/src/contracts/instructions.js'
import type { InstructionsPayload } from '../../../../packages/market-contracts/src/contracts/instructions.js'
import { mountInstructionRoutes, type InstructionRouteDeps } from '../../../../packages/market-bundle/src/routes-instructions.js'
import { readInstructions, resolveInstructionLimits } from '../../../../packages/market-bundle/src/application/instructions.js'

/**
 * The published host module is the oracle. It is imported here, never through
 * the harness checkout: that checkout ships an older build of this package,
 * which knows only one user-global root and would prove the wrong rules.
 */
const host = await import('@deepseek-ai/dsh-agent-instructions')

type Handler = (req: unknown, res: unknown) => void | Promise<void>
interface Answer {
  status: number
  body: Record<string, unknown>
}

const roots: string[] = []
const savedEnv = { DSH_HOME: process.env['DSH_HOME'], DSH_AGENTS_HOME: process.env['DSH_AGENTS_HOME'] }

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

/** One fixture tree, described as a path to content map. */
async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'market-instructions-'))
  roots.push(root)
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
  return root
}

/** Point the two user-global roots at fixture directories and return their labels. */
function useHomes(dshHome: string, agentsHome: string): void {
  process.env['DSH_HOME'] = dshHome
  process.env['DSH_AGENTS_HOME'] = agentsHome
}

function routeHost(): { host: Record<string, unknown>; routes: Map<string, Handler> } {
  const routes = new Map<string, Handler>()
  return {
    host: {
      webServer: {
        register(entry: { path: string; handler: Handler }): () => void {
          routes.set(entry.path, entry.handler)
          return () => routes.delete(entry.path)
        }
      }
    },
    routes
  }
}

function fakeResponse(): { response: unknown; read: () => { status: number; body: Record<string, unknown> } } {
  let status = 0
  let payload = ''
  return {
    response: { writeHead: (code: number) => (status = code), end: (text: string) => (payload = text) },
    read: () => ({ status, body: JSON.parse(payload) as Record<string, unknown> })
  }
}

async function get(routes: Map<string, Handler>, url: string): Promise<Answer> {
  const { response, read } = fakeResponse()
  // The query string selects a session; the exact route is the pathname. The
  // read handler is async, so the request settles when it does.
  await routes.get(url.split('?')[0] ?? url)?.({ method: 'GET', url, headers: { host: '127.0.0.1' } }, response)
  return read()
}

/** Poll one recorded response until the fire-and-forget handler writes it. */
async function settled(read: () => Answer): Promise<Answer> {
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      const answer = read()
      if (answer.body !== undefined) return answer
    } catch {
      // The handler has not written its body yet.
    }
    if (Date.now() > deadline) return read()
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function post(routes: Map<string, Handler>, path: string, body: Record<string, unknown>): Promise<Answer> {
  const { response, read } = fakeResponse()
  const request = {
    method: 'POST',
    url: path,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
    on: (event: string, listener: (chunk?: unknown) => void) => {
      if (event === 'data') listener(Buffer.from(JSON.stringify(body), 'utf8'))
      if (event === 'end') listener()
    },
    destroy: () => {}
  }
  void routes.get(path.split('?')[0] ?? path)?.(request, response)
  return settled(read)
}

/** The session id every request names, so the read answers for a fixture workspace. */
const SESSION = 'fixture'

/**
 * Refuse any workspace outside a temporary root.
 *
 * These routes delete files. A helper that defaulted to the process working
 * directory once pointed a delete test at this repository's own `AGENTS.md`
 * and removed it, so the guard is not decoration: every fixture must be a
 * `mkdtemp` tree, and a test that reaches any other directory fails loudly
 * before the first request.
 * @param cwd - the workspace a request would answer for.
 * @returns the same directory.
 * @throws when the directory is not under the OS temporary root.
 */
function fixtureOnly(cwd: string): string {
  const temp = resolve(tmpdir())
  const target = resolve(cwd)
  if (target !== temp && !target.startsWith(temp + sep)) throw new Error(`refusing to run instruction routes against "${target}": every fixture must live under ${temp}`)
  return target
}

/**
 * Mount the routes against one fixture workspace.
 *
 * The read is session-aware by design, and a fixture tree is not the process
 * working directory, so every request names this session. `cwd` is required:
 * a default would let a write test target whatever directory the suite happens
 * to run in.
 */
function mounted(deps: Omit<InstructionRouteDeps, 'session'> & { cwd: string }): { routes: Map<string, Handler>; dispose: () => void } {
  const cwd = fixtureOnly(deps.cwd)
  const { host, routes } = routeHost()
  const session = { agent: (id: string) => (id === SESSION ? ({ session: { header: { cwd } } } as never) : undefined) }
  return { routes, dispose: mountInstructionRoutes(host, { limits: deps.limits, session }) }
}

/** One read path carrying the fixture session. */
function readPath(): string {
  return `${INSTRUCTION_ROUTES.read}?sessionId=${SESSION}`
}

/** One write path carrying the fixture session. */
function writePath(route: string): string {
  return `${route}?sessionId=${SESSION}`
}

const LIMITS = resolveInstructionLimits({})

/** The three host calls a parity assertion compares against. */
async function hostAnswer(cwd: string, options: { maxBytes?: number; maxSourceBytes?: number } = {}) {
  const discovery = {
    cwd,
    dshHome: process.env['DSH_HOME'],
    agentsHome: process.env['DSH_AGENTS_HOME']
  }
  const discovered = await host.discoverBaselineInstructionFiles(discovery)
  const rendered = await host.loadBaselineInstructions({
    ...discovery,
    maxBytes: options.maxBytes ?? LIMITS.maxBytes,
    maxSourceBytes: options.maxSourceBytes ?? LIMITS.maxSourceBytes
  })
  return { discovered, rendered }
}

describe('instruction test harness', () => {
  it('refuses a workspace outside a temporary root, so a write test can never reach this repository', () => {
    // A helper that defaulted to the process directory once pointed a delete
    // test at this repository's own AGENTS.md. That must fail before any
    // request, not delete a tracked file.
    expect(() => mounted({ limits: resolveInstructionLimits({}), cwd: process.cwd() })).toThrow('every fixture must live under')
  })
})

describe('instruction chain parity with the host module', () => {
  it('reports the host own chain, order, dedupe and render', async () => {
    const root = await tree({
      '.git/HEAD': 'ref: refs/heads/main\n',
      'AGENTS.md': '# Root\n',
      // Same trimmed content as AGENTS.md, so the host renders it once.
      'CLAUDE.md': '# Root\n\n',
      'AGENTS.local.md': '# Root local\n',
      'apps/site/AGENTS.md': '# Site\n',
      'home/AGENTS.md': '# Global\n',
      'agents/AGENTS.md': '# Global\n'
    })
    useHomes(join(root, 'home'), join(root, 'agents'))
    const cwd = join(root, 'apps', 'site')

    const { routes } = mounted({ limits: LIMITS, cwd })
    const answer = await get(routes, readPath())
    const payload = answer.body as unknown as InstructionsPayload
    const oracle = await hostAnswer(cwd)

    expect(payload.available).toBe(true)
    expect(payload.cwd).toBe(cwd)
    expect(payload.projectRoot).toBe(root)
    // The rendered prompt is the host's own answer, byte for byte.
    expect(payload.rendered).toEqual(oracle.rendered)
    expect(payload.total).toBe(Buffer.byteLength(oracle.rendered?.text ?? '', 'utf8'))
    expect(payload.budget).toBe(LIMITS.maxBytes)

    // Every discovered file appears once, in the host's discovery order.
    const discoveredRows = payload.rows.filter(row => row.exists)
    expect(discoveredRows.map(row => row.displayPath)).toEqual(oracle.discovered.map(file => file.displayPath))
    expect(discoveredRows.map(row => row.displayPath)).toEqual([
      '$DSH_HOME/AGENTS.md',
      '$DSH_AGENTS_HOME/AGENTS.md',
      'AGENTS.md',
      'CLAUDE.md',
      'AGENTS.local.md',
      'apps/site/AGENTS.md'
    ])

    // Dedupe is the host's rule, reported with the earlier candidate that won.
    expect(payload.rows.find(row => row.displayPath === '$DSH_AGENTS_HOME/AGENTS.md')?.status).toBe('duplicate')
    expect(payload.rows.find(row => row.displayPath === '$DSH_AGENTS_HOME/AGENTS.md')?.duplicateOf).toBe('$DSH_HOME/AGENTS.md')
    expect(payload.rows.find(row => row.displayPath === 'CLAUDE.md')?.status).toBe('duplicate')
    expect(payload.rows.find(row => row.displayPath === 'CLAUDE.md')?.duplicateOf).toBe('AGENTS.md')
    for (const shown of ['$DSH_HOME/AGENTS.md', 'AGENTS.md', 'AGENTS.local.md', 'apps/site/AGENTS.md']) {
      expect(payload.rows.find(row => row.displayPath === shown)?.status).toBe('loaded')
    }
  })

  it('reads a truncation before the rendered header', async () => {
    const root = await tree({
      '.git/HEAD': 'x\n',
      'AGENTS.md': '# Root\n',
      'apps/site/AGENTS.md': '# Site body that will not fit\n'
    })
    useHomes(join(root, 'home'), join(root, 'agents'))
    const cwd = join(root, 'apps', 'site')
    // A budget that omits every broader file and truncates the most specific one.
    const limits = resolveInstructionLimits({ instructionMaxBytes: 120 })

    const { routes } = mounted({ limits, cwd })
    const payload = (await get(routes, readPath())).body as unknown as InstructionsPayload
    const oracle = await hostAnswer(cwd, { maxBytes: 120 })

    expect(payload.rendered).toEqual(oracle.rendered)
    // At this budget the renderer emits no "Instructions from:" header at all,
    // so a header-first rule would call this file a duplicate.
    expect(oracle.rendered?.text).not.toContain('Instructions from: apps/site/AGENTS.md')
    expect(oracle.rendered?.truncated.map(item => item.displayPath)).toEqual(['apps/site/AGENTS.md'])
    expect(payload.rows.find(row => row.displayPath === 'apps/site/AGENTS.md')).toMatchObject({ status: 'truncated', includedBytes: 0 })
    for (const omitted of oracle.rendered?.omitted ?? []) {
      expect(payload.rows.find(row => row.displayPath === omitted.displayPath)?.status).toBe('over-budget')
    }
  })

  it('names the source cap when a file is too large to load at all', async () => {
    const body = '# ' + 'x'.repeat(40) + '\n'
    const root = await tree({ '.git/HEAD': 'x\n', 'AGENTS.md': body })
    useHomes(join(root, 'home'), join(root, 'agents'))
    const limits = resolveInstructionLimits({ instructionMaxSourceBytes: 30 })

    const { routes } = mounted({ limits, cwd: root })
    const payload = (await get(routes, readPath())).body as unknown as InstructionsPayload
    const oracle = await hostAnswer(root, { maxSourceBytes: 30 })

    // Invisible in all three host arrays, so no header, omission or truncation
    // names it. Its size is what tells the page which rule dropped it.
    expect(oracle.rendered).toBeUndefined()
    const row = payload.rows.find(candidate => candidate.displayPath === 'AGENTS.md')
    expect(row).toMatchObject({ status: 'source-over-budget', size: body.length })
    expect(payload.maxSourceBytes).toBe(30)
  })

  it('reports a local overlay that repeats its sibling rather than looking broken', async () => {
    const root = await tree({ '.git/HEAD': 'x\n', 'AGENTS.md': '# Same\n', 'AGENTS.local.md': '# Same\n' })
    useHomes(join(root, 'home'), join(root, 'agents'))

    const { routes } = mounted({ limits: LIMITS, cwd: root })
    const payload = (await get(routes, readPath())).body as unknown as InstructionsPayload

    expect(payload.rows.find(row => row.displayPath === 'AGENTS.md')?.status).toBe('loaded')
    expect(payload.rows.find(row => row.displayPath === 'AGENTS.local.md')).toMatchObject({ status: 'duplicate', duplicateOf: 'AGENTS.md' })
  })

  it('names the earlier candidate when a repeated file is itself omitted for budget', async () => {
    // The host deduplicates before it applies the budget, so a duplicate of an
    // omitted file is in neither array. It still repeats the file before it.
    const body = '# Shared\n'
    const root = await tree({ '.git/HEAD': 'x\n', 'AGENTS.md': body, 'CLAUDE.md': body, 'apps/site/AGENTS.md': '# Site\n' + 's'.repeat(200) })
    useHomes(join(root, 'home'), join(root, 'agents'))
    const limits = resolveInstructionLimits({ instructionMaxBytes: 400 })

    const payload = await readInstructions(join(root, 'apps', 'site'), limits)

    expect(payload.rows.find(row => row.displayPath === 'AGENTS.md')?.status).toBe('over-budget')
    expect(payload.rows.find(row => row.displayPath === 'CLAUDE.md')).toMatchObject({ status: 'duplicate', duplicateOf: 'AGENTS.md' })
  })

  it('offers creation for every directory on the chain, including ones with no file', async () => {
    const root = await tree({ '.git/HEAD': 'x\n', 'apps/site/AGENTS.md': '# Site\n' })
    useHomes(join(root, 'home'), join(root, 'agents'))

    const { routes } = mounted({ limits: LIMITS, cwd: join(root, 'apps', 'site') })
    const payload = (await get(routes, readPath())).body as unknown as InstructionsPayload

    // Both user-global roots are offered even though neither file exists.
    expect(payload.rows.slice(0, 2).map(row => row.displayPath)).toEqual(['$DSH_HOME/AGENTS.md', '$DSH_AGENTS_HOME/AGENTS.md'])
    expect(payload.rows.slice(0, 2).map(row => row.status)).toEqual(['missing', 'missing'])
    // Only AGENTS.md is a candidate in either root: no CLAUDE.md, no overlay.
    expect(payload.rows.some(row => row.scope !== 'project' && row.candidate !== 'AGENTS.md')).toBe(false)
    // The chain is root -> cwd, and every directory carries the four candidates.
    const directories = [...new Set(payload.rows.filter(row => row.scope === 'project').map(row => row.directory))]
    expect(directories).toEqual(['.', 'apps', 'apps/site'])
    expect(payload.rows.filter(row => row.scope === 'project')).toHaveLength(12)
    expect(payload.rows.find(row => row.displayPath === 'apps/site/AGENTS.md')?.status).toBe('loaded')
    expect(payload.rows.find(row => row.displayPath === 'apps/AGENTS.md')).toMatchObject({ status: 'missing', scope: 'project', candidate: 'AGENTS.md' })
  })

  it('treats a .git file as a project marker, the linked-worktree case', async () => {
    const root = await tree({ '.git': 'gitdir: /elsewhere/.git/worktrees/x\n', 'apps/AGENTS.md': '# App\n' })
    useHomes(join(root, 'home'), join(root, 'agents'))

    const payload = await readInstructions(join(root, 'apps'), LIMITS)
    expect(payload.projectRoot).toBe(root)
    expect(payload.rows.filter(row => row.scope === 'project').map(row => row.directory)[0]).toBe('.')
  })

  it('starts the chain at cwd when no marker exists', async () => {
    const root = await tree({ 'AGENTS.md': '# Here\n' })
    useHomes(join(root, 'home'), join(root, 'agents'))

    const payload = await readInstructions(root, LIMITS)
    expect(payload.projectRoot).toBe(root)
    expect([...new Set(payload.rows.filter(row => row.scope === 'project').map(row => row.directory))]).toEqual(['.'])
  })

  it('reports a probe failure instead of throwing out of the route', async () => {
    const root = await tree({ 'AGENTS.md': '# Here\n' })
    // A .git symlink that points at itself fails the marker probe with ELOOP.
    await symlink(join(root, '.git'), join(root, '.git'))
    useHomes(join(root, 'home'), join(root, 'agents'))

    const { routes } = mounted({ limits: LIMITS, cwd: root })
    const answer = await get(routes, readPath())
    const payload = answer.body as unknown as InstructionsPayload

    expect(answer.status).toBe(200)
    expect(payload.error).toBeDefined()
    expect(payload.error).toContain('ELOOP')
    expect(payload.rows).toEqual([])
  })

  it('says so when the byte budget disables loading entirely', async () => {
    const root = await tree({ '.git/HEAD': 'x\n', 'AGENTS.md': '# Root\n' })
    useHomes(join(root, 'home'), join(root, 'agents'))
    const limits = resolveInstructionLimits({ instructionMaxBytes: 0 })

    const payload = await readInstructions(root, limits)
    const oracle = await hostAnswer(root, { maxBytes: 0 })

    expect(oracle.rendered).toBeUndefined()
    expect(payload.budget).toBe(0)
    expect(payload.rendered.text).toBe('')
    expect(payload.total).toBe(0)
  })

  it('answers for the named session workspace', async () => {
    const root = await tree({ '.git/HEAD': 'x\n', 'AGENTS.md': '# Root\n' })
    useHomes(join(root, 'home'), join(root, 'agents'))
    const { routes } = mounted({ limits: LIMITS, cwd: root })

    const live = (await get(routes, readPath())).body as unknown as InstructionsPayload
    expect(live.cwd).toBe(root)

    const unknown = await get(routes, `${INSTRUCTION_ROUTES.read}?sessionId=gone`)
    expect(unknown.status).toBe(404)
    expect(unknown.body['error']).toContain('no live session')
  })
})

describe('instruction writes', () => {
  /** A tree whose session runs two directories below its project root. */
  async function writeTree(): Promise<{ root: string; routes: Map<string, Handler> }> {
    const root = await tree({ '.git/HEAD': 'x\n' })
    useHomes(join(root, 'home'), join(root, 'agents'))
    return { root, routes: mounted({ limits: LIMITS, cwd: join(root, 'apps', 'site') }).routes }
  }

  it('creates a candidate in a directory that has no file, parents included', async () => {
    const { root, routes } = await writeTree()
    const answer = await post(routes, writePath(INSTRUCTION_ROUTES.save), { scope: 'project', directory: 'apps/site', candidate: 'AGENTS.md', text: '# Site\n' })

    expect(answer.status).toBe(200)
    expect(await readFile(join(root, 'apps', 'site', 'AGENTS.md'), 'utf8')).toBe('# Site\n')
    // The atomic write leaves the target and nothing else behind.
    expect(await readdir(join(root, 'apps', 'site'))).toEqual(['AGENTS.md'])
  })

  it('writes a user-global root file', async () => {
    const { root, routes } = await writeTree()
    const answer = await post(routes, writePath(INSTRUCTION_ROUTES.save), { scope: 'agents-global', directory: '.', candidate: 'AGENTS.md', text: '# Shared\n' })

    expect(answer.status).toBe(200)
    expect(await readFile(join(root, 'agents', 'AGENTS.md'), 'utf8')).toBe('# Shared\n')
  })

  it('refuses an absolute path, an unknown candidate and an unknown scope', async () => {
    const { routes } = await writeTree()
    const absolute = await post(routes, writePath(INSTRUCTION_ROUTES.save), { scope: 'project', directory: '/etc', candidate: 'AGENTS.md', text: 'x' })
    expect(absolute.status).toBe(400)
    expect(absolute.body['error']).toContain('relative to the project root')

    const outside = await post(routes, writePath(INSTRUCTION_ROUTES.save), { scope: 'project', directory: '..', candidate: 'AGENTS.md', text: 'x' })
    expect(outside.status).toBe(400)
    expect(outside.body['error']).toContain('not an instruction candidate')

    // Neither user-global root loads a CLAUDE.md, so it is not a target there.
    const global = await post(routes, writePath(INSTRUCTION_ROUTES.save), { scope: 'user-global', directory: '.', candidate: 'CLAUDE.md', text: 'x' })
    expect(global.status).toBe(400)
    expect(global.body['error']).toContain('not an instruction candidate')

    const scope = await post(routes, writePath(INSTRUCTION_ROUTES.save), { scope: 'elsewhere', directory: '.', candidate: 'AGENTS.md', text: 'x' })
    expect(scope.status).toBe(400)
    expect(scope.body['error']).toContain('unknown instruction scope')
  })

  it('refuses text over the per-file cap, because it would never load', async () => {
    const root = await tree({ '.git/HEAD': 'x\n' })
    useHomes(join(root, 'home'), join(root, 'agents'))
    const limits = resolveInstructionLimits({ instructionMaxSourceBytes: 16 })
    const { routes } = mounted({ limits, cwd: root })

    const answer = await post(routes, writePath(INSTRUCTION_ROUTES.save), { scope: 'project', directory: '.', candidate: 'AGENTS.md', text: 'x'.repeat(32) })
    expect(answer.status).toBe(400)
    expect(answer.body['error']).toContain('per-file limit')
    expect(await readdir(root)).toEqual(['.git'])
  })

  it('names the aliases a delete leaves behind', async () => {
    const root = await tree({ '.git/HEAD': 'x\n', 'AGENTS.md': '# Root\n' })
    await symlink(join(root, 'AGENTS.md'), join(root, 'CLAUDE.md'))
    useHomes(join(root, 'home'), join(root, 'agents'))
    const { routes } = mounted({ limits: LIMITS, cwd: root })

    const answer = await post(routes, writePath(INSTRUCTION_ROUTES.remove), { scope: 'project', directory: '.', candidate: 'AGENTS.md' })
    expect(answer.status).toBe(200)
    expect(answer.body['aliases']).toEqual(['CLAUDE.md'])
    expect(answer.body['targetIsLink']).toBe(false)
    await expect(readFile(join(root, 'AGENTS.md'), 'utf8')).rejects.toThrow()
  })

  it('reports that deleting a link removes only the link', async () => {
    const root = await tree({ '.git/HEAD': 'x\n', 'AGENTS.md': '# Root\n' })
    await symlink(join(root, 'AGENTS.md'), join(root, 'CLAUDE.md'))
    useHomes(join(root, 'home'), join(root, 'agents'))
    const { routes } = mounted({ limits: LIMITS, cwd: root })

    const answer = await post(routes, writePath(INSTRUCTION_ROUTES.remove), { scope: 'project', directory: '.', candidate: 'CLAUDE.md' })
    expect(answer.body['targetIsLink']).toBe(true)
    expect(answer.body['aliases']).toEqual(['AGENTS.md'])
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('# Root\n')
  })
})
