/**
 * One module owns the host subagent member names.
 *
 * The 0.10.0 release left a bare `ctx.subagents.start` call in the role router
 * after the host removed that member, and no gate saw it. dependency-cruiser
 * analyses module edges, not property access, so the rule lives here: a file
 * outside the seam module that reaches a member of the subagent service fails
 * this test.
 *
 * The scan is textual, so it covers the spellings a defensive author writes: dot
 * access, optional chaining, bracket access, destructuring, a local alias bound
 * to the service, and a service lookup through `ctx.get`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
/** The one module allowed to name a host subagent member. */
const SEAM_MODULE = 'packages/market-runtime/src/runtime/agents/subagent-seam.ts'
/** Host members this plugin drives; naming one outside the seam is the defect. */
const HOST_MEMBERS = [
  'start',
  'startContinuable',
  'startActivation',
  'drainChildren',
  'drainContinuableChildren',
  'registerProvider',
  'getProvider',
  'waitForChildren',
  'sendMessage',
  'drainDescendants'
]
/** The service whose members stay behind the seam. */
const SERVICE = 'subagents'

/** One way a source text can reach a host subagent member. */
export interface MemberRead {
  /** The spelling that matched, so a failure says which shape got through. */
  shape: 'service member' | 'optional chaining' | 'bracket access' | 'local alias' | 'destructuring' | 'service lookup'
  /** The host member named. */
  member: string
}

/** Escape one literal for a regular expression. */
function escape(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Remove comments so prose that names a member is not a finding. */
function code(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, ' ').replaceAll(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Every local bound to the subagent service, so a later read through it is found. */
function aliases(source: string): string[] {
  const pattern = new RegExp('(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*[^;\\n]*?(?:\\b' + SERVICE + '\\b|\\.get\\(\\s*[\'"`]' + SERVICE + '[\'"`]\\s*\\))', 'g')
  return [...source.matchAll(pattern)].flatMap(match => (match[1] === undefined ? [] : [match[1]]))
}

/** The member alternation, so one pattern covers every host member. */
const MEMBERS = HOST_MEMBERS.map(escape).join('|')

/**
 * Find every read of a host subagent member in one source text.
 *
 * Each shape is checked separately so the failure names the spelling, and every
 * value name here is either the service itself or a local bound to it.
 * @param source - one TypeScript source file's text.
 * @returns one entry per spelling that reaches a host member.
 */
export function findMemberReads(source: string): MemberRead[] {
  const text = code(source)
  const findings: MemberRead[] = []
  const names = new Set([SERVICE, ...aliases(text)])
  for (const name of names) {
    const quoted = escape(name)
    // A dot or optional-chained read, with or without a `this.` prefix.
    const dot = new RegExp('(?:^|[^\\w$])(?:this\\s*\\.\\s*)?' + quoted + '\\s*(\\?\\.|\\.)\\s*(' + MEMBERS + ')\\b', 'g')
    for (const match of text.matchAll(dot)) {
      // A read through a local bound to the service is the same violation, one
      // indirection away, and the label says which spelling got through.
      const shape: MemberRead['shape'] = name !== SERVICE ? 'local alias' : match[1] === '?.' ? 'optional chaining' : 'service member'
      findings.push({ shape, member: match[2]! })
    }
    // A bracket read of one member name.
    const bracket = new RegExp('(?:^|[^\\w$])(?:this\\s*\\.\\s*)?' + quoted + '\\s*\\[\\s*[\'"`](' + MEMBERS + ')[\'"`]\\s*\\]', 'g')
    for (const match of text.matchAll(bracket)) findings.push({ shape: 'bracket access', member: match[1]! })
    // Destructuring one or more members out of the service or an alias of it.
    const destructure = new RegExp('\\{([^}]*)\\}\\s*=\\s*[^;\\n]*\\b' + quoted + '\\b', 'g')
    for (const match of text.matchAll(destructure)) {
      const body = match[1] ?? ''
      for (const member of HOST_MEMBERS) {
        if (new RegExp('\\b' + escape(member) + '\\b').test(body)) findings.push({ shape: 'destructuring', member })
      }
    }
  }
  // A member read straight off a service lookup chain.
  const lookup = new RegExp('\\.get\\(\\s*[\'"`]' + SERVICE + '[\'"`]\\s*\\)\\s*(?:\\?\\.|\\.)\\s*(' + MEMBERS + ')\\b', 'g')
  for (const match of text.matchAll(lookup)) findings.push({ shape: 'service lookup', member: match[1]! })
  // One entry per spelling and member, so a file reports each violation once.
  const unique = new Map(findings.map(finding => [finding.shape + ':' + finding.member, finding]))
  return [...unique.values()]
}

/** Every TypeScript source file under packages/<pkg>/src, relative to the repository root. */
async function sourceFiles(): Promise<string[]> {
  const visit = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true })
    const found = await Promise.all(
      entries.map(async entry => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return visit(path)
        return /[.]tsx?$/.test(entry.name) ? [path] : []
      })
    )
    return found.flat()
  }
  const packagesDirectory = join(ROOT, 'packages')
  const names = (await readdir(packagesDirectory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
  const files = (await Promise.all(names.map(name => visit(join(packagesDirectory, name, 'src'))))).flat()
  expect(files.length).toBeGreaterThan(0)
  return files.map(file => relative(ROOT, file).replaceAll('\\', '/'))
}

/** The spellings a source file can use to reach a host member, one sample each. */
const SHAPES: Record<string, { source: string; shape: MemberRead['shape']; member: string }> = {
  'dot access on a ctx receiver': { source: 'export const f = (ctx: Ctx) => ctx.subagents.start("spawn", {})', shape: 'service member', member: 'start' },
  'dot access on another receiver': { source: 'export const f = (runtime: Runtime) => runtime.subagents.start("spawn", {})', shape: 'service member', member: 'start' },
  'dot access on the owning field': {
    source: 'export class S { m(provider: P) { return this.subagents.registerProvider(provider) } }',
    shape: 'service member',
    member: 'registerProvider'
  },
  'optional chaining': { source: 'export const f = (ctx: Ctx) => ctx.subagents?.start("spawn", {})', shape: 'optional chaining', member: 'start' },
  'optional chaining on a lookup': { source: 'export const f = (ctx: Ctx) => ctx.get("subagents")?.startActivation({})', shape: 'service lookup', member: 'startActivation' },
  'local alias': { source: 'export const f = (ctx: Ctx) => {\n  const sub = ctx.subagents\n  return sub.start("spawn", {})\n}', shape: 'local alias', member: 'start' },
  'local alias of a lookup': {
    source: 'export const f = (ctx: Ctx) => {\n  const service = ctx.get("subagents")\n  return service?.startActivation({})\n}',
    shape: 'local alias',
    member: 'startActivation'
  },
  'local alias bracket access': {
    source: 'export const f = (ctx: Ctx) => {\n  const sub = ctx.subagents\n  return sub["start"]("spawn", {})\n}',
    shape: 'bracket access',
    member: 'start'
  },
  destructuring: { source: 'export const f = (ctx: Ctx) => {\n  const { start } = ctx.subagents\n  return start("spawn", {})\n}', shape: 'destructuring', member: 'start' },
  'renamed destructuring': {
    source: 'export const f = (ctx: Ctx) => {\n  const { start: run } = ctx.subagents\n  return run("spawn", {})\n}',
    shape: 'destructuring',
    member: 'start'
  },
  'destructuring an alias': {
    source: 'export const f = (ctx: Ctx) => {\n  const sub = ctx.subagents\n  const { startActivation } = sub\n  return startActivation({})\n}',
    shape: 'destructuring',
    member: 'startActivation'
  },
  'bracket access': { source: 'export const f = (ctx: Ctx) => ctx.subagents["start"]("spawn", {})', shape: 'bracket access', member: 'start' }
}

/** Source shapes that must stay clean, so the scan does not flag legitimate use. */
const CLEAN: Record<string, string> = {
  'passing the seam to a helper': 'export const f = (ctx: Ctx) => registerSubagentProvider(this.subagents, provider)',
  'a comment naming a removed member': '// never call ctx.subagents.start here\nexport const ok = 1',
  'binding the service without reading it': 'export class S { m(ctx: Ctx) { this.subagents = ctx.get("subagents") as SubagentSeam } }',
  'a similarly named service': 'export const f = (ctx: Ctx) => ctx.subagentCatalog.start()'
}

describe('host subagent member ownership', () => {
  it('finds every spelling that reaches a host subagent member', () => {
    for (const [name, sample] of Object.entries(SHAPES)) {
      expect(findMemberReads(sample.source), name).toContainEqual({ shape: sample.shape, member: sample.member })
    }
  })

  it('leaves legitimate seam use alone', () => {
    for (const [name, source] of Object.entries(CLEAN)) expect(findMemberReads(source), name).toEqual([])
  })

  it('reaches no subagent member from a file outside the seam module', async () => {
    const offenders: string[] = []
    for (const file of await sourceFiles()) {
      if (file === SEAM_MODULE) continue
      const reads = findMemberReads(await readFile(join(ROOT, file), 'utf8'))
      for (const read of reads) offenders.push(file + ' reads ' + read.member + ' through ' + read.shape)
    }
    expect(offenders).toEqual([])
  })

  it('names every driven host member in the seam module only', async () => {
    const seam = await readFile(join(ROOT, SEAM_MODULE), 'utf8')
    for (const member of HOST_MEMBERS.slice(0, 6)) expect(seam, member).toContain(member)
  })
})
