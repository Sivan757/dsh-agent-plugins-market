/**
 * End-to-end acceptance for the `.agents` layout: one project directory and
 * one user Agent layout root, each carrying every surface that layout can
 * hold, read through the same entry points the plugin runtime uses.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { projectAgentRoles } from '../src/application/project-agent-roles.js'
import { discoverNativeProjectSuites } from '../src/catalog/native-project.js'
import { readCommands } from '../src/runtime/commands-mounts.js'
import { bindHostLocale } from '../src/runtime/host-locale.js'
import { loadLspServers } from '../src/application/lsp-direct-config.js'
import { loadUserMcpSuite } from '../src/application/mcp-direct-config.js'
import { loadUserHooksSuite } from '../src/application/user-hooks.js'
import { UserCommandMountRegistry } from '../src/runtime/user-commands.js'
import { createUserPanelStores } from '../src/runtime/user-panels.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function root(prefix: string): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), prefix))
  roots.push(value)
  return value
}

const skill = '---\nname: greet\ndescription: Greet the caller.\n---\n\nGreet the caller.\n'
const command = '---\ndescription: Commit changes.\n---\nCommit: $ARGUMENTS'
const persona = '---\ndescription: Review code.\n---\nReview the change.'
const hook = (name: string) => JSON.stringify({ PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `echo ${name}` }] }] })
const mcp = JSON.stringify({ mcpServers: { shared: { command: 'shared-server' } } })
const lsp = JSON.stringify({ lspServers: { typescript: { command: 'typescript-language-server', args: ['--stdio'], extensionToLanguage: { '.ts': 'typescript' } } } })

describe('.agents layout acceptance: project directory', () => {
  it('reads every surface a project .agents directory can carry', async () => {
    const project = await root('market-agents-project-')
    const userRoot = await root('market-agents-project-user-')
    await mkdir(join(project, '.git'), { recursive: true })
    await mkdir(join(project, '.agents/skills/greet'), { recursive: true })
    await mkdir(join(project, '.agents/commands/git'), { recursive: true })
    await mkdir(join(project, '.agents/agents/review'), { recursive: true })
    await mkdir(join(project, '.agents/hooks'), { recursive: true })
    await writeFile(join(project, '.agents/skills/greet/SKILL.md'), skill)
    await writeFile(join(project, '.agents/commands/git/commit.md'), command)
    await writeFile(join(project, '.agents/agents/review/code.md'), persona)
    await writeFile(join(project, '.agents/hooks/hooks.json'), hook('project'))
    await writeFile(join(project, '.agents/mcp.json'), mcp)
    await writeFile(join(project, '.agents/lsp.json'), lsp)

    const suites = await discoverNativeProjectSuites(project, 'project')
    const suite = suites.find(entry => entry.id === 'agents-native')
    if (suite === undefined) throw new Error('expected the .agents directory to resolve to one native suite')
    expect(suites).toHaveLength(1)
    expect(suite.surfaces).toEqual({ skills: 1, commands: 1, agents: 1, mcp: 1, hooks: 1, lsp: 0 })
    expect(suite.skills.map(entry => entry.name)).toEqual(['greet'])
    expect(Object.keys(suite.mcp!.servers)).toEqual(['shared'])
    expect(suite.hooks?.events.PreToolUse?.[0]?.hooks[0]?.command).toBe('echo project')
    // Project LSP stays a diagnosed host boundary rather than a silent omission.
    expect(suite.errors).toEqual(['.agents/lsp.json: project LSP configuration is not mounted; the host LSP registry does not isolate projects'])

    // Commands flatten their path and agents keep it, matching project-native discovery.
    expect((await readCommands(suite.root, suite.resources?.commands)).map(spec => spec.name)).toEqual(['git-commit'])
    const parent = { session: { header: { cwd: project } } }
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
    await catalog.load()
    await catalog.setScanProjectLayouts(true)
    expect((await projectAgentRoles(catalog, parent)).map(entry => entry.title)).toEqual(['review/code'])
  })

  it('contributes nothing from the project .agents directory until the switch is on', async () => {
    const project = await root('market-agents-project-off-')
    const userRoot = await root('market-agents-project-off-user-')
    await mkdir(join(project, '.git'), { recursive: true })
    await mkdir(join(project, '.agents/commands/git'), { recursive: true })
    await writeFile(join(project, '.agents/commands/git/commit.md'), command)

    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
    await catalog.load()
    expect((await catalog.readProjectCatalog(project)).suites).toEqual([])
    await catalog.setScanProjectLayouts(true)
    expect((await catalog.readProjectCatalog(project)).suites.map(suite => suite.id)).toEqual(['agents-native'])
  })
})

describe('.agents layout acceptance: user Agent layout root', () => {
  async function userAgentsRoot(): Promise<string> {
    const agentsRoot = await root('market-agents-user-')
    await mkdir(join(agentsRoot, 'skills/greet'), { recursive: true })
    await mkdir(join(agentsRoot, 'commands/git'), { recursive: true })
    await mkdir(join(agentsRoot, 'agents/review'), { recursive: true })
    await mkdir(join(agentsRoot, 'hooks'), { recursive: true })
    await writeFile(join(agentsRoot, 'skills/greet/SKILL.md'), skill)
    await writeFile(join(agentsRoot, 'commands/git/commit.md'), command)
    await writeFile(join(agentsRoot, 'agents/review/code.md'), persona)
    await writeFile(join(agentsRoot, 'hooks/hooks.json'), hook('user'))
    // Hand-written declarations carry no DSH `$schema`; another tool wrote these.
    await writeFile(join(agentsRoot, 'mcp.json'), mcp)
    await writeFile(join(agentsRoot, 'lsp.json'), lsp)
    return agentsRoot
  }

  it('serves every surface under the root through the same entry points the runtime uses', async () => {
    const agentsRoot = await userAgentsRoot()
    const panels = createUserPanelStores(agentsRoot)

    expect((await panels.skills.list()).map(entry => entry.name)).toEqual(['greet'])
    expect((await panels.commands.list()).map(entry => entry.name)).toEqual(['git/commit'])
    expect((await panels.agents.list()).map(entry => entry.name)).toEqual(['review/code'])

    const registered: string[] = []
    const registry = new UserCommandMountRegistry(
      { commands: { register: (definition: { name: string }) => (registered.push(definition.name), () => {}) } } as unknown as Context,
      panels.commands,
      bindHostLocale(undefined)
    )
    try {
      expect(await registry.reconcile()).toEqual([])
      expect(registered).toEqual(['git-commit'])
    } finally {
      registry.disposeAll()
    }

    const hooks = await loadUserHooksSuite(agentsRoot)
    expect(hooks.surfaces.hooks).toBe(1)
    expect(hooks.activeSurfaces).toEqual({ skills: false, mcp: false, hooks: true, commands: false, agents: false, lsp: false })
    expect(hooks.hooks?.projectRoot).toBeUndefined()

    const mcpSuite = await loadUserMcpSuite(agentsRoot)
    expect(mcpSuite.errors).toEqual([])
    expect(Object.keys(mcpSuite.mcp.servers)).toEqual(['shared'])
    expect(mcpSuite.activeSurfaces).toEqual({ skills: false, mcp: true, hooks: false, commands: false, agents: false, lsp: false })

    const lspServers = await loadLspServers(agentsRoot)
    expect(lspServers.errors).toEqual([])
    expect(Object.keys(lspServers.servers)).toEqual(['typescript'])
  })

  it('merges the user hook and MCP declarations into the enabled suite set and nothing else', async () => {
    const agentsRoot = await userAgentsRoot()
    const userRoot = await root('market-agents-user-state-')
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot, onChanged: () => {} })
    await catalog.load()

    const suites = await catalog.enabledUserSuites()
    expect(suites.map(suite => `${suite.sourceId}/${suite.id}`)).toEqual(['@user-mcp/user-mcp', '@user-hooks/user-hooks'])
    // Neither direct suite claims a surface it does not declare, so the command
    // registry reads the root through the panel only.
    for (const suite of suites) {
      expect(suite.activeSurfaces.commands).toBe(false)
      expect(suite.skills).toEqual([])
    }
  })

  it('omits a direct suite whose file declares nothing', async () => {
    const agentsRoot = await root('market-agents-empty-')
    const userRoot = await root('market-agents-empty-state-')
    await writeFile(join(agentsRoot, 'mcp.json'), JSON.stringify({ mcpServers: {} }))
    await writeFile(join(agentsRoot, 'hooks.json'), JSON.stringify({ hooks: {} }))

    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot, onChanged: () => {} })
    await catalog.load()
    expect(await catalog.enabledUserSuites()).toEqual([])
  })
})
