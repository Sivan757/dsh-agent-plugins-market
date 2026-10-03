/**
 * The sibling contributors to a gated surface answer the same switch.
 *
 * The reconciler covers the suite mounts, but commands and MCP also mount from
 * the project dimension and skills from the user's own panel. Those seats stay
 * attached — re-registering them per toggle would churn the host registry — so
 * the switch has to reach the data each one serves.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Catalog } from '../src/application/catalog.js'
import { mountProjectCommands, mountProjectMcp } from '../src/runtime/surfaces/project-runtime.js'
import { bindHostLocale } from '../src/runtime/host/host-locale.js'
import { ToggledSkillProvider } from '../src/runtime/surfaces/skills-provider.js'
import { UserPanelSkillProvider, createUserPanelStores } from '../src/runtime/panels/user-panels.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A project carrying one command and one MCP server. */
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'surface-gate-project-'))
  roots.push(root)
  await mkdir(join(root, '.git'))
  await mkdir(join(root, '.qoder', 'commands'), { recursive: true })
  await writeFile(join(root, '.qoder', 'commands', 'review.md'), '---\ndescription: Review changes\n---\nReview $ARGUMENTS')
  await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { example: { command: 'server' } } }))
  return root
}

interface ProjectAgent {
  session: { header: { cwd: string } }
  definitions: Map<string, unknown>
  mounts: Map<string, unknown>
}

/** An agent whose scope registers commands and records MCP mounts. */
function agent(cwd: string): ProjectAgent {
  const definitions = new Map<string, unknown>()
  const mounts = new Map<string, unknown>()
  return {
    session: { header: { cwd } },
    definitions,
    mounts,
    ctx: {
      inject: (_services: string[], callback: (scope: unknown) => void) => {
        const cleanups: Array<() => void> = []
        callback({
          get: () => undefined,
          commands: {
            register: (definition: { name: string }) => {
              definitions.set(definition.name, definition)
              return () => definitions.delete(definition.name)
            }
          },
          plugin: (_plugin: unknown, config: { serverName: string }) => {
            mounts.set(config.serverName, config)
            return { await: async () => {}, dispose: async () => mounts.delete(config.serverName) }
          },
          effect: (setup: () => () => void) => {
            cleanups.push(setup())
          }
        })
        return {
          dispose: async () => {
            cleanups.splice(0).forEach(cleanup => cleanup())
          }
        }
      }
    }
  } as ProjectAgent & { ctx: unknown }
}

/** A host whose agent list carries the one project agent under test. */
function host(current: ProjectAgent): Context {
  return { agents: { list: () => [current] }, on: () => () => {}, logger: { warn: () => {} } } as unknown as Context
}

async function projectCatalog(userRoot: string, onChanged: () => Promise<void>): Promise<Catalog> {
  const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged })
  await catalog.load()
  await catalog.setScanProjectLayouts(true)
  return catalog
}

describe('project commands answer the commands switch', () => {
  it('unregisters the project commands while off and restores them when on', async () => {
    const root = await project()
    const userRoot = await project()
    const current = agent(root)
    let commandsOn = true
    const live = mountProjectCommands(host(current), await projectCatalog(userRoot, async () => live.refresh()), bindHostLocale(undefined), undefined, () => commandsOn)
    try {
      await live.refresh()
      expect([...current.definitions.keys()]).toEqual(['review'])

      // Off reconciles against no project suites, so the live registration is
      // released rather than left mounted behind a skipped pass.
      commandsOn = false
      await live.refresh()
      expect([...current.definitions.keys()]).toEqual([])

      commandsOn = true
      await live.refresh()
      expect([...current.definitions.keys()]).toEqual(['review'])
    } finally {
      await live.dispose()
    }
  })
})

describe('project MCP answers the mcp switch', () => {
  it('mounts no project server while off and mounts it again when on', async () => {
    const root = await project()
    const userRoot = await project()
    const current = agent(root)
    let mcpOn = true
    const live = mountProjectMcp(host(current), await projectCatalog(userRoot, async () => live.refresh()), join(userRoot, 'data'), () => mcpOn)
    try {
      await live.refresh()
      // The mount key is suite-qualified: the project suite's own name prefixes
      // the declared server, exactly as a user-dimension suite's does.
      expect([...current.mounts.keys()]).toEqual(['claude-native__example'])

      mcpOn = false
      await live.refresh()
      expect([...current.mounts.keys()]).toEqual([])

      mcpOn = true
      await live.refresh()
      expect([...current.mounts.keys()]).toEqual(['claude-native__example'])
    } finally {
      await live.dispose()
    }
  })
})

/** The candidate names one provider serves, from either list() return shape. */
async function listedNames(provider: ToggledSkillProvider): Promise<string[]> {
  const listed = await provider.list({})
  const candidates = 'candidates' in listed ? listed.candidates : listed
  return candidates.map(candidate => candidate.name)
}

describe('user panel skills answer the skills switch', () => {
  it('serves no panel entries while off, without losing the provider seat', async () => {
    const agentsRoot = await mkdtemp(join(tmpdir(), 'surface-gate-panel-'))
    roots.push(agentsRoot)
    const stores = createUserPanelStores(agentsRoot)
    await stores.skills.create('my-skill', '---\nname: my-skill\ndescription: Mine\n---\nBody')

    let skillsOn = true
    const provider = new ToggledSkillProvider(new UserPanelSkillProvider(stores.skills), () => skillsOn)
    // The wrapped provider keeps its own registry name, so the seat identity a
    // re-registration would change stays stable across a toggle.
    expect(provider.name).toBe('user-panel')
    expect(await listedNames(provider)).toEqual(['my-skill'])

    skillsOn = false
    expect(await listedNames(provider)).toEqual([])

    skillsOn = true
    expect(await listedNames(provider)).toEqual(['my-skill'])
  })
})
