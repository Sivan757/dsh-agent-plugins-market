/**
 * One module owns the host subagent member names.
 *
 * The 0.10.0 release left a bare `ctx.subagents.start` call in the role router
 * after the host removed that member, and no gate saw it. dependency-cruiser
 * analyses module edges, not property access, so the rule lives here: a file
 * outside the seam module that reaches a member of the subagent service fails
 * this test.
 *
 * The scan walks the syntax tree and resolves the receiver by type, so it is not
 * a list of spellings. A receiver is a seam when its written type annotation
 * names the seam type (`SubagentSeam`, `ContinuableSubagentSeam`,
 * `SubagentRuntime`), or when it is derived from the host subagent service. Any
 * host-member read on that receiver is a finding, whatever the surrounding
 * syntax: dot access, optional chaining, bracket access, a local alias, a
 * destructuring pattern, a service lookup, a typed variable, a typed parameter,
 * a typed field, or a chain split across lines.
 *
 * The boundary, stated rather than implied: the scan parses, it does not
 * type-check. A receiver whose seam type is only INFERRED and never written (for
 * example `const seam = makeSeam()` where `makeSeam` has no declared return
 * type) is not resolved. Written annotations, service derivations, and declared
 * return types are. Running the checker would close that last case at the cost
 * of a Program over the whole project, which the fixture samples cannot join.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DRIVEN_MEMBERS, findMemberReads, ROOT, SEAM_MODULE, SERVICE, sourceFiles, type ReadShape } from './helpers/subagent-member-scan.js'

/** The spellings a source file can use to reach a host member, one sample each. */
const SHAPES: Record<string, { source: string; shape: ReadShape; member: string }> = {
  'dot access on a ctx receiver': { source: 'export const f = (ctx: Ctx) => ctx.subagents.start("spawn", {})', shape: 'service member', member: 'start' },
  'dot access on another receiver': { source: 'export const f = (runtime: Runtime) => runtime.subagents.start("spawn", {})', shape: 'service member', member: 'start' },
  'dot access on the owning field': {
    source: 'export class S { m(provider: P) { return this.subagents.registerProvider(provider) } }',
    shape: 'service member',
    member: 'registerProvider'
  },
  'optional chaining': { source: 'export const f = (ctx: Ctx) => ctx.subagents?.start("spawn", {})', shape: 'optional chaining', member: 'start' },
  'optional chaining on a lookup': { source: 'export const f = (ctx: Ctx) => ctx.get("subagents")?.startActivation({})', shape: 'optional chaining', member: 'startActivation' },
  'lookup without optional chaining': { source: 'export const f = (ctx: Ctx) => ctx.get("subagents").startActivation({})', shape: 'service lookup', member: 'startActivation' },
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
  'bracket access': { source: 'export const f = (ctx: Ctx) => ctx.subagents["start"]("spawn", {})', shape: 'bracket access', member: 'start' },
  // The shapes a review round slipped past the earlier, name-based scan.
  'typed variable': {
    source: 'export function f(ctx: Ctx) {\n  const seam: SubagentSeam = ctx.subagents as SubagentSeam\n  seam.start("spawn", {})\n}',
    shape: 'typed variable',
    member: 'start'
  },
  'typed parameter': { source: 'export function f(seam: SubagentSeam) {\n  seam.start("spawn", {})\n}', shape: 'typed parameter', member: 'start' },
  'typed field': {
    source: 'export class Host {\n  private readonly seam: SubagentSeam\n  run() { this.seam.start("spawn", {}) }\n}',
    shape: 'typed field',
    member: 'start'
  },
  'typed constructor parameter property': {
    source: 'export class Host {\n  constructor(private readonly seam: SubagentSeam) {}\n  run() { this.seam.start("spawn", {}) }\n}',
    shape: 'typed field',
    member: 'start'
  },
  'service in brackets, optional chained': {
    source: 'export function f(ctx: Ctx) {\n  ctx["subagents"]?.start("spawn", {})\n}',
    shape: 'optional chaining',
    member: 'start'
  },
  'renamed service destructuring': {
    source: 'export function f(ctx: Ctx) {\n  const { subagents: service } = ctx\n  service?.start("spawn", {})\n}',
    shape: 'destructuring',
    member: 'start'
  },
  'chain split across lines': {
    source: 'export function f(ctx: Ctx) {\n  ctx\n    .subagents\n    ?.start("spawn", {})\n}',
    shape: 'optional chaining',
    member: 'start'
  },
  'declared return type': {
    source:
      'export function seamOf(ctx: Ctx): SubagentSeam { return ctx.subagents as SubagentSeam }\nexport function f(ctx: Ctx) {\n  const seam = seamOf(ctx)\n  seam.start("spawn", {})\n}',
    shape: 'typed variable',
    member: 'start'
  }
}

/** Source shapes that must stay clean, so the scan does not flag legitimate use. */
const CLEAN: Record<string, string> = {
  'passing the seam to a helper': 'export const f = (ctx: Ctx) => registerSubagentProvider(this.subagents, provider)',
  'a comment naming a removed member': '// never call ctx.subagents.start here\nexport const ok = 1',
  'a comment inside a body': 'export function f(ctx: Ctx) {\n  // ctx.subagents.start is gone\n  return ctx\n}',
  'binding the service without reading it': 'export class S { m(ctx: Ctx) { this.subagents = ctx.get("subagents") as SubagentSeam } }',
  'returning a typed seam without a member read': 'export function f(seam: SubagentSeam) {\n  return seam\n}',
  'a similarly named service': 'export const f = (ctx: Ctx) => ctx.subagentCatalog.start()',
  'a local named like the service': 'export function f(ctx: Ctx) {\n  const subagents = new Map()\n  return subagents.get("spawn")\n}',
  'a member read on an unrelated typed value': 'export function f(prompt: SystemPrompt) {\n  return prompt.getSectionOrder("DEPLOYMENT_PERSONA_PREFIX")\n}'
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
    const files = await sourceFiles()
    expect(files.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of files) {
      if (file === SEAM_MODULE) continue
      const reads = findMemberReads(await readFile(join(ROOT, file), 'utf8'))
      for (const read of reads) offenders.push(file + ' reads ' + read.member + ' through ' + read.shape)
    }
    expect(offenders).toEqual([])
  })

  it('names every driven host member in the seam module only', async () => {
    const seam = await readFile(join(ROOT, SEAM_MODULE), 'utf8')
    // The seam module is the one exception, and it must carry every member the
    // table drives; a member it stopped naming is a member the guard cannot see.
    for (const member of DRIVEN_MEMBERS) expect(seam, member).toContain(member)
    expect(SERVICE).toBe('subagents')
  })
})
