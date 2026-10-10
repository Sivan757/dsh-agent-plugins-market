/**
 * The agent-scoped extension contributions.
 *
 * Two sessions in the same workspace may select opposite suites, so the suite
 * provider is registered on each agent's own scope and closes over that agent.
 * Suite and per-skill authorization are answered at call time by the runtime,
 * never frozen into the registration.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scanSource } from '../packages/market-catalog/src/scanning/suite-scanner.js'
import { captureExtensionSelection } from '../packages/market-contracts/src/contracts/extension-presets.js'
import { ScopedExtensionContributors } from '../packages/market-runtime/src/runtime/host/scoped-contributors.js'
import type { SuiteSkillProvider } from '../packages/market-runtime/src/runtime/surfaces/skills-provider.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'
import { createMcpMount } from '../packages/market-bundle/src/runtime-adapters.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

/** One agent whose own scope keeps the providers registered on it. */
function fakeAgent() {
  const registered: Array<() => SuiteSkillProvider> = []
  const released: string[] = []
  const agent = {
    ctx: {
      inject: (_dependencies: string[], apply: (scope: unknown) => void) => {
        apply({
          skills: {
            registerProvider: (create: (control: { invalidate(): void; signal: AbortSignal }) => SuiteSkillProvider) => {
              const provider = create({ invalidate() {}, signal: new AbortController().signal })
              registered.push(() => provider)
              return () => {
                released.push('provider')
              }
            }
          }
        })
        return { dispose: async () => {} }
      }
    }
  } as unknown as Agent
  return { agent, registered, released }
}

async function fixtureSuite() {
  const [scanned] = (await scanSource(join(fixtures, 'v1-suite'), 'demo', 'user')).suites
  if (scanned === undefined) throw new Error('expected the fixture suite to scan')
  return withDefaultSurfaces({ ...scanned, enabled: true })
}

const SUITE = 'market:demo/v1-suite'
const SKILL = 'skills:' + JSON.stringify(['demo', 'v1-suite', 'skills', 'greet'])

describe('agent-scoped extension contributions', () => {
  it('answers suite and per-skill authorization on every read, body included', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scoped-contributors-'))
    roots.push(root)
    const catalog = { enabledUserSuites: async () => [await fixtureSuite()] } as never
    const granted = new Set<string>([SUITE, SKILL])
    const contributors = new ScopedExtensionContributors({
      mcpMounts: createMcpMount,
      dataRoot: root,
      catalog,
      shell: () => undefined,
      allows: (_agent, resourceId) => granted.has(resourceId)
    })
    const session = fakeAgent()
    await contributors.reconcile(session.agent, captureExtensionSelection(null, [SUITE]))
    expect(session.registered).toHaveLength(1)
    const provider = session.registered[0]!()
    const [listed] = await provider.list({})
    expect(listed?.name).toBe('greet')
    if (listed === undefined) throw new Error('expected the fixture suite to list its skill')
    expect((await provider.get(listed, {}))?.content).toContain('greet')
    // The suite stays on while its single skill is switched off: the entry decides.
    granted.delete(SKILL)
    expect(await provider.list({})).toEqual([])
    expect(await provider.get(listed, {})).toBeUndefined()
    granted.add(SKILL)
    expect((await provider.list({})).map(candidate => candidate.name)).toEqual(['greet'])
    // The whole suite off denies both paths, on the same provider instance.
    granted.delete(SUITE)
    expect(await provider.list({})).toEqual([])
    expect(await provider.get(listed, {})).toBeUndefined()
  })

  it('keeps opposite selections in one workspace independent and re-registers only on a change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scoped-contributors-'))
    roots.push(root)
    const catalog = { enabledUserSuites: async () => [await fixtureSuite()] } as never
    // Authorization is per session, as the runtime answers it: a grant belongs to
    // one agent, never to the process.
    const grants = new Map<Agent, Set<string>>()
    const contributors = new ScopedExtensionContributors({
      mcpMounts: createMcpMount,
      dataRoot: root,
      catalog,
      shell: () => undefined,
      allows: (agent, resourceId) => grants.get(agent)?.has(resourceId) === true
    })
    const selected = fakeAgent()
    const other = fakeAgent()
    grants.set(selected.agent, new Set([SUITE, SKILL]))
    grants.set(other.agent, new Set())
    await contributors.reconcile(selected.agent, captureExtensionSelection(null, [SUITE]))
    await contributors.reconcile(other.agent, captureExtensionSelection(null, []))
    expect(selected.registered).toHaveLength(1)
    expect(other.registered).toHaveLength(0)
    expect((await selected.registered[0]!().list({})).map(candidate => candidate.name)).toEqual(['greet'])
    // The same selection is idempotent: no second registration, no dropped state.
    await contributors.reconcile(selected.agent, captureExtensionSelection(null, [SUITE]))
    expect(selected.registered).toHaveLength(1)
    // A changed selection releases the old registration; the replacement answers
    // nothing now that the grant is gone.
    grants.get(selected.agent)!.clear()
    await contributors.reconcile(selected.agent, captureExtensionSelection(null, []))
    expect(selected.released).toEqual(['provider'])
    expect(selected.registered).toHaveLength(1)
    expect(await selected.registered[0]!().list({})).toEqual([])
    // Disposing one session releases exactly that session.
    // The empty reconcile already released it, so the final dispose finds nothing.
    await contributors.dispose(selected.agent)
    expect(selected.released).toEqual(['provider'])
    expect(other.registered).toHaveLength(0)
  })
})
