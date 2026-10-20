/**
 * One module owns the host subagent member names.
 *
 * The 0.10.0 release left a bare `ctx.subagents.start` call in the role router
 * after the host removed that member, and no gate saw it. dependency-cruiser
 * analyses module edges, not property access, so the rule lives here: a file
 * outside the seam module that reads a member of `ctx.subagents` fails this
 * test.
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
/** A read of a member on a value named `subagents`. */
const MEMBER_READ = /(?:ctx|host|seam|service|this)\\s*\\.\\s*subagents\\s*\\.\\s*[A-Za-z_$]/
/** A direct call of one host subagent member. */
const MEMBER_CALL = new RegExp('\\bsubagents\\s*\\.\\s*(?:' + HOST_MEMBERS.join('|') + ')\\s*\\(')

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

describe('host subagent member ownership', () => {
  it('reads no ctx.subagents member outside the seam module', async () => {
    const offenders: string[] = []
    for (const file of await sourceFiles()) {
      if (file === SEAM_MODULE) continue
      const source = await readFile(join(ROOT, file), 'utf8')
      // Narrowing a seam type is fine; naming the host member is not.
      if (MEMBER_READ.test(source)) offenders.push(file + ' reads a subagents member')
      if (MEMBER_CALL.test(source)) offenders.push(file + ' calls a host subagent member')
    }
    expect(offenders).toEqual([])
  })

  it('names every driven host member in the seam module only', async () => {
    const seam = await readFile(join(ROOT, SEAM_MODULE), 'utf8')
    for (const member of HOST_MEMBERS.slice(0, 6)) expect(seam, member).toContain(member)
  })
})
