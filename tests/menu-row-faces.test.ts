/**
 * The `/` menu faces: that a row shows the translation its panel already paid
 * for, and that nothing here translates it a second time.
 *
 * The cache-identity assertions are the point of this file. A row's face is only
 * free when its id and authored text are exactly the ones the panel used; an id
 * derived differently shows up as the same prose going to a provider twice.
 */
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Catalog } from '../packages/market-bundle/src/application/catalog.js'
import { createPanelResources, type PanelResourceStore } from '../packages/market-runtime/src/application/panel-resources.js'
import { createUserPanelStores } from '../packages/market-runtime/src/runtime/panels/user-panels.js'
import { bindHostLocale } from '../packages/market-runtime/src/runtime/host/host-locale.js'
import { UserCommandMountRegistry } from '../packages/market-runtime/src/runtime/panels/user-commands.js'
import { CommandMountRegistry } from '../packages/market-runtime/src/runtime/surfaces/commands-mounts.js'
import { collectMenuRowIdentities } from '../packages/market-runtime/src/runtime/host/menu-row-identities.js'
import { resetCircuitBreaker, type TranslationProvider } from '../packages/market-translation/src/application/translation/chain.js'
import type { MenuRowIdentity } from '../packages/market-contracts/src/ports/ports.js'

const roots: string[] = []

afterEach(async () => {
  resetCircuitBreaker()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A provider recording every text it is asked for, so a second translation is visible. */
function recordingProvider(answer: (text: string) => string): TranslationProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    id: 'microsoft',
    calls,
    available: () => true,
    translate: async ({ texts }) => {
      calls.push(...texts)
      return texts.map(answer)
    }
  }
}

/** A host whose `commands` registry records live definitions, as the real one does. */
function commandHost(registered: Map<string, string>): Context {
  return {
    commands: {
      register: (definition: { name: string; description: string }) => {
        registered.set(definition.name, definition.description)
        return () => {
          registered.delete(definition.name)
        }
      }
    }
  } as unknown as Context
}

/** One catalog over a seeded root with the fixture suite installed, and its panels. */
async function market(options: { locale?: string; provider?: TranslationProvider } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'market-menu-faces-'))
  roots.push(root)
  const source = join(root, '.sources', 'demo')
  await mkdir(source, { recursive: true })
  await cp(join(process.cwd(), 'tests', 'fixtures', 'v1-suite'), source, { recursive: true })
  await writeFile(
    join(root, 'state.json'),
    JSON.stringify({
      version: 1,
      sources: [{ id: 'demo', url: source, local: true }],
      installed: { 'demo/v1-suite': { enabled: true, installedAt: new Date(0).toISOString() } }
    })
  )
  const ports = {
    localePreference: () => options.locale ?? 'zh',
    ...(options.provider === undefined ? {} : { translationProviders: [options.provider], translationProviderIdentity: () => 'test-chain' })
  }
  const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), agentsRoot: join(root, 'agents'), onChanged: () => {}, ports })
  await catalog.load()
  const users = createUserPanelStores(root)
  return { root, catalog, users, panels: createPanelResources(catalog, users), source }
}

/** A second catalog over one root, serving whatever identities a test hands it. */
async function catalogOver(root: string, identities: readonly MenuRowIdentity[], options: { locale?: string; provider?: TranslationProvider } = {}) {
  const catalog = new Catalog({
    userRoot: root,
    dataRoot: join(root, 'data'),
    agentsRoot: join(root, 'agents'),
    onChanged: () => {},
    ports: {
      localePreference: () => options.locale ?? 'zh',
      menuRowIdentities: async () => identities,
      ...(options.provider === undefined ? {} : { translationProviders: [options.provider], translationProviderIdentity: () => 'test-chain' })
    }
  })
  await catalog.load()
  return catalog
}

/** The fixture suite's one command entry, as the panel lists it. */
async function fixtureCommand(panels: { commands: PanelResourceStore }) {
  const entry = (await panels.commands.list()).find(row => row.origin === 'plugin')
  if (entry === undefined) throw new Error('expected the fixture suite to ship a command')
  return entry
}

describe('menu row identities', () => {
  it('carries the call name and the panel identity of one registered command', async () => {
    const built = await market()
    const entry = await fixtureCommand(built.panels)
    const registered = new Map<string, string>()
    const registry = new CommandMountRegistry(commandHost(registered), bindHostLocale(undefined))
    await registry.reconcile([...(await built.catalog.enabledUserSuites())])
    const identities = await collectMenuRowIdentities({ panels: built.panels, commands: registry.registrations() })
    const command = identities.find(row => row.source === 'commands')
    expect(command).toMatchObject({ source: 'commands', name: 'deploy', id: entry.id ?? entry.name })
    expect(identities.some(row => row.source === 'skills')).toBe(true)
  })

  it('keeps the allocated call name while the id stays the panel entry', async () => {
    const built = await market()
    const entry = await fixtureCommand(built.panels)
    // What a suffixed registration reports: the name the menu row carries, and
    // the panel entry it came from.
    const identities = await collectMenuRowIdentities({ panels: built.panels, commands: [{ name: 'deploy-1', id: entry.id ?? entry.name }] })
    expect(identities.find(row => row.source === 'commands')).toMatchObject({ name: 'deploy-1', id: entry.id ?? entry.name })
  })

  it('skips a registration no panel entry backs', async () => {
    const built = await market()
    const identities = await collectMenuRowIdentities({ panels: built.panels, commands: [{ name: 'ghost', id: 'no-such-entry' }] })
    expect(identities.some(row => row.name === 'ghost')).toBe(false)
  })

  it('keeps the nested resource spelling the panel translates under', async () => {
    // A nested command is the case the two spellings diverge on: the menu row
    // carries the flattened call name the host grammar accepts, while the panel
    // (and so the translation cache) addresses the file by its path. Building
    // the id from the call name would miss the cache the panel filled.
    const built = await market()
    const source = join(built.root, '.sources', 'demo', 'com.deepseek.harness', 'commands', 'git')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'commit.md'), ['---', 'description: Commit changes', '---', 'Commit body'].join('\n'))
    const registered = new Map<string, string>()
    const registry = new CommandMountRegistry(commandHost(registered), bindHostLocale(undefined))
    await registry.reconcile([...(await built.catalog.enabledUserSuites())])
    const nested = registry.registrations().find(row => row.name === 'git-commit')
    if (nested === undefined) throw new Error(`expected the nested command to register, got ${JSON.stringify(registry.registrations())}`)
    // The panel lists the same document under its path, and that is the id.
    const entry = (await built.panels.commands.list()).find(row => row.name === 'git/commit')
    expect(nested.id).toBe(entry?.id)
  })

  it('gives two entries that flatten alike their own panel identity', async () => {
    const built = await market()
    const source = join(built.root, '.sources', 'demo', 'com.deepseek.harness', 'commands')
    await mkdir(join(source, 'dup'), { recursive: true })
    await writeFile(join(source, 'dup', 'run.md'), ['---', 'description: Nested duplicate', '---', 'Nested body'].join('\n'))
    await writeFile(join(source, 'dup-run.md'), ['---', 'description: Flat duplicate', '---', 'Flat body'].join('\n'))
    const registered = new Map<string, string>()
    const registry = new CommandMountRegistry(commandHost(registered), bindHostLocale(undefined))
    await registry.reconcile([...(await built.catalog.enabledUserSuites())])
    const rows = registry.registrations().filter(row => row.name.startsWith('dup-run'))
    // Both files flatten to one call name, so allocation suffixes the second and
    // each row keeps its own resource id rather than sharing one.
    expect(rows.map(row => row.name).sort()).toEqual(['dup-run', 'dup-run-1'])
    expect(new Set(rows.map(row => row.id)).size).toBe(2)
    expect(rows.some(row => row.id.includes('dup/run'))).toBe(true)
  })
})

describe('menu row faces', () => {
  it('serves the translated label and description from the panel cache', async () => {
    const provider = recordingProvider(text => `译:${text}`)
    const built = await market({ provider })
    const entry = await fixtureCommand(built.panels)
    // The panel read is what queues the translation; the menu only reads it back.
    await built.catalog.settleDescriptions(5_000)
    const catalog = await catalogOver(
      built.root,
      [
        {
          source: 'commands',
          name: 'deploy',
          id: entry.id ?? entry.name,
          authoredName: entry.name,
          ...(entry.description === '' ? {} : { authoredDescription: entry.description })
        }
      ],
      { provider }
    )
    const [face] = await catalog.menuRowFaces()
    expect(face).toMatchObject({ source: 'commands', name: 'deploy' })
    expect(face?.description).toBe(`译:${entry.description}`)
  })

  it('never pays a provider twice for one row', async () => {
    const provider = recordingProvider(text => `译:${text}`)
    const built = await market({ provider })
    const entry = await fixtureCommand(built.panels)
    await built.catalog.settleDescriptions(5_000)
    const paid = provider.calls.length
    const catalog = await catalogOver(
      built.root,
      [
        {
          source: 'commands',
          name: 'deploy',
          id: entry.id ?? entry.name,
          authoredName: entry.name,
          ...(entry.description === '' ? {} : { authoredDescription: entry.description })
        }
      ],
      { provider }
    )
    // The menu read answers from the cache the panel filled: no new provider call.
    expect((await catalog.menuRowFaces()).length).toBe(1)
    expect(provider.calls.length).toBe(paid)
  })

  it('answers with no face while a translation is still in flight', async () => {
    const provider = recordingProvider(text => `译:${text}`)
    const built = await market({ provider })
    const entry = await fixtureCommand(built.panels)
    const catalog = await catalogOver(
      built.root,
      [
        {
          source: 'commands',
          name: 'deploy',
          id: entry.id ?? entry.name,
          authoredName: entry.name,
          ...(entry.description === '' ? {} : { authoredDescription: entry.description })
        }
      ],
      { provider }
    )
    // Uncached: the row keeps the host's own text rather than a half-answer.
    expect(await catalog.menuRowFaces()).toEqual([])
  })

  it('omits a field whose translation is the authored text', async () => {
    const provider = recordingProvider(text => text)
    const built = await market({ provider })
    const entry = await fixtureCommand(built.panels)
    await built.catalog.settleDescriptions(5_000)
    const catalog = await catalogOver(
      built.root,
      [
        {
          source: 'commands',
          name: 'deploy',
          id: entry.id ?? entry.name,
          authoredName: entry.name,
          ...(entry.description === '' ? {} : { authoredDescription: entry.description })
        }
      ],
      { provider }
    )
    expect(await catalog.menuRowFaces()).toEqual([])
  })

  it('returns nothing when the deployment translates nothing', async () => {
    const built = await market()
    const catalog = await catalogOver(built.root, [
      {
        source: 'commands',
        name: 'deploy',
        id: 'whatever',
        authoredName: 'deploy',
        authoredDescription: 'Deploy the fixture'
      }
    ])
    expect(await catalog.menuRowFaces()).toEqual([])
  })

  it('returns nothing for an English deployment', async () => {
    const provider = recordingProvider(text => `译:${text}`)
    const built = await market({ provider })
    const catalog = await catalogOver(built.root, [{ source: 'commands', name: 'deploy', id: 'x', authoredName: 'deploy', authoredDescription: 'Deploy the fixture' }], {
      provider,
      locale: 'en'
    })
    expect(await catalog.menuRowFaces()).toEqual([])
  })
})

describe('the user command seat', () => {
  it('reports the entry name as the id and the allocation as the row name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-menu-user-'))
    roots.push(root)
    const users = createUserPanelStores(join(root, 'agents'))
    await users.commands.create('git-review', ['---', 'description: Review changes', '---', 'Review: $ARGUMENTS'].join('\n'))
    const registered = new Map<string, string>()
    const registry = new UserCommandMountRegistry(commandHost(registered), users.commands, bindHostLocale(undefined))
    await registry.reconcile()
    expect(registry.registrations()).toEqual([{ name: 'git-review', id: 'git-review' }])
  })
})
