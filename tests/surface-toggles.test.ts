import { cp, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { SuiteSkillProvider } from '../src/runtime/skills-provider.js'
import { RuntimeReconciler } from '../src/runtime/reconciler.js'
import { effectiveSurfaces } from '../src/model/types.js'
import type { Context } from '@deepseek-ai/cordis'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, 'fixtures', 'v1-suite')

async function installFixture(manager: Catalog, sourceId = 'demo', suiteId = 'v1-suite'): Promise<void> {
  const checkout = join(manager.userRoot, '.sources', sourceId)
  await mkdir(checkout, { recursive: true })
  await cp(fixture, checkout, { recursive: true })
  await manager.mergeSources([{ id: sourceId, url: 'https://example.test/demo.git' }])
  await manager.install(sourceId, suiteId)
}

describe('effectiveSurfaces', () => {
  it('defaults every surface to enabled without overrides', () => {
    expect(effectiveSurfaces(undefined)).toEqual({ skills: true, mcp: true, hooks: true, commands: true, agents: true, lsp: true })
  })

  it('merges overrides over the enabled default', () => {
    expect(effectiveSurfaces({ mcp: false, hooks: false })).toEqual({ skills: true, mcp: false, hooks: false, commands: true, agents: true, lsp: true })
  })
})

describe('Catalog.setSurface', () => {
  it('persists per-surface overrides and reflects them in the snapshot', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-surface-'))
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await manager.load()
    await installFixture(manager)

    await manager.setSurface('demo', 'v1-suite', 'mcp', false)
    const suites = (await manager.readUserCatalog()).suites
    expect(suites.find(suite => suite.id === 'v1-suite')!.activeSurfaces).toEqual({ skills: true, mcp: false, hooks: true, commands: true, agents: true, lsp: true })

    await manager.setSurface('demo', 'v1-suite', 'mcp', true)
    expect((await manager.readUserCatalog()).suites.find(suite => suite.id === 'v1-suite')!.activeSurfaces.mcp).toBe(true)
  })

  it('rejects unknown surfaces and uninstalled suites', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-surface-bad-'))
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await manager.load()
    await installFixture(manager)

    await expect(manager.setSurface('demo', 'v1-suite', 'nope' as never, false)).rejects.toThrow('not toggleable')
    await expect(manager.setSurface('demo', 'missing', 'mcp', false)).rejects.toThrow('not installed')
  })

  it('shows surface toggles on installed overview cards only', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-surface-overview-'))
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await manager.load()
    await installFixture(manager)
    await manager.setSurface('demo', 'v1-suite', 'hooks', false)

    const overview = await manager.overview()
    const card = overview.suites.find(suite => suite.suiteId === 'v1-suite')!
    expect(card.installed).toBe(true)
    expect(card.surfaceToggles).toEqual({ skills: true, mcp: true, hooks: false, commands: true, agents: true, lsp: true })
  })

  it('survives state reload (persisted overrides)', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-surface-persist-'))
    const first = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await first.load()
    await installFixture(first)
    await first.setSurface('demo', 'v1-suite', 'commands', false)

    const second = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await second.load()
    const suite = (await second.readUserCatalog()).suites.find(entry => entry.id === 'v1-suite')!
    expect(suite.activeSurfaces.commands).toBe(false)
    expect(suite.activeSurfaces.skills).toBe(true)
  })
})

describe('surface filtering at runtime', () => {
  it('hides skills of a suite with skills disabled', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-surface-skills-'))
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await manager.load()
    await installFixture(manager)
    await manager.setSurface('demo', 'v1-suite', 'skills', false)

    const provider = new SuiteSkillProvider(manager)
    expect(await provider.list({})).toEqual([])
  })

  it('keeps skills when other surfaces are disabled', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-surface-mixed-'))
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await manager.load()
    await installFixture(manager)
    await manager.setSurface('demo', 'v1-suite', 'mcp', false)
    await manager.setSurface('demo', 'v1-suite', 'hooks', false)

    const provider = new SuiteSkillProvider(manager)
    const candidates = await provider.list({})
    expect(candidates.map(candidate => candidate.name)).toContain('greet')
  })

  it('skips MCP mounting for suites with mcp disabled', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-surface-mcp-'))
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await manager.load()
    await installFixture(manager)
    await manager.setSurface('demo', 'v1-suite', 'mcp', false)

    const reconciler = new RuntimeReconciler({} as Context, join(userRoot, 'data'))
    const enabled = (await manager.readUserCatalog()).enabledSuites
    const diagnostics = await reconciler.reconcile(enabled)
    // The disabled suite's servers never even reach the mount adapter.
    expect(diagnostics.mcp.filter(diagnostic => diagnostic.suiteId === 'v1-suite')).toEqual([])
  })
})
