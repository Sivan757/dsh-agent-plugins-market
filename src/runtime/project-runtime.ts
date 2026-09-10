/** Native project effects are owned by the receiving agent's scoped host context. */
import type { Context } from '@deepseek-ai/cordis'
import type { Catalog } from '../application/catalog.js'
import { CommandMountRegistry } from './commands-mounts.js'
import type { HostTranslate } from './host-locale.js'
import { McpMountRegistry } from './mcp-mounts.js'
import { HooksMountRegistry } from './hooks-mounts.js'
import type { Suite } from '../model/types.js'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { stripFrontmatter } from '../catalog/skills-parse.js'
import { parseFrontmatterRecord } from './user-store.js'

interface ProjectAgent {
  ctx: Context
  session: { id?: string; header: { cwd?: string } }
}

interface AgentMount {
  fiber: ReturnType<Context['inject']>
  refresh(): Promise<void>
}

/** Mount under existing and newly created agents; the caller owns refresh and teardown. */
export function mountProjectCommands(ctx: Context, catalog: Catalog, t: HostTranslate): { refresh(): Promise<void>; dispose(): Promise<void> } {
  return mountProjectSurface(ctx, catalog, 'commands', scope => new CommandMountRegistry(scope, t))
}

/** MCP uses a separate injected child so network startup cannot delay local commands. */
export function mountProjectMcp(ctx: Context, catalog: Catalog, dataRoot: string): { refresh(): Promise<void>; dispose(): Promise<void> } {
  return mountProjectSurface(ctx, catalog, 'tools', (scope, agent) => {
    const registry = new McpMountRegistry(scope, dataRoot, agent.session.id ?? randomUUID())
    registry.setBackendProvider(() => catalog.mcpBackend())
    return registry
  })
}

/** Wait for both bridge dependencies before attempting a scoped hook mount. */
export function mountProjectHooks(ctx: Context, catalog: Catalog): { refresh(): Promise<void>; dispose(): Promise<void> } {
  return mountProjectSurface(ctx, catalog, ['shell', 'sessionProjections'], scope => new HooksMountRegistry(scope))
}

/** Kimi's startup skill and system-prompt declarations use the existing scoped prompt service. */
export function mountSuiteInstructions(ctx: Context, catalog: Catalog): { refresh(): Promise<void>; dispose(): Promise<void> } {
  return mountProjectSurface(
    ctx,
    catalog,
    'systemPrompt',
    scope => {
      let text = ''
      const host = scope as unknown as { systemPrompt: { section(value: { name: string; order: number; text(): string }): () => void } }
      const dispose = host.systemPrompt.section({ name: 'agent-plugins:instructions', order: 500, text: () => text })
      return {
        async reconcile(projectSuites) {
          const result = await suiteInstructions([...(await catalog.enabledUserSuites()), ...projectSuites])
          text = result.text
          return result.errors
        },
        disposeAll() {
          text = ''
          dispose()
        }
      }
    },
    true
  )
}

export async function suiteInstructions(suites: readonly Suite[]): Promise<{ text: string; errors: Array<{ suiteId: string; reason: string }> }> {
  const chunks: string[] = []
  const errors: Array<{ suiteId: string; reason: string }> = []
  for (const suite of suites) {
    if (!suite.enabled || suite.activeSurfaces?.skills === false) continue
    if (suite.systemPrompt !== undefined) chunks.push(suite.systemPrompt)
    if (suite.manifest.startupSkill === undefined) continue
    const skill = suite.skills.find(skill => skill.name === suite.manifest.startupSkill)
    if (skill === undefined) {
      errors.push({ suiteId: `${suite.sourceId}/${suite.id}`, reason: `startup skill ${suite.manifest.startupSkill} was not discovered` })
      continue
    }
    try {
      const content = await readFile(skill.file, 'utf8')
      if (parseFrontmatterRecord(content).disabled === true) continue
      chunks.push(stripFrontmatter(content))
      if (suite.manifest.skillInstructions !== undefined) chunks.push(suite.manifest.skillInstructions)
    } catch {
      errors.push({ suiteId: `${suite.sourceId}/${suite.id}`, reason: `startup skill ${skill.name} is unreadable` })
    }
  }
  return { text: chunks.join('\n\n'), errors }
}

interface ProjectRegistry {
  reconcile(suites: Suite[]): Promise<Array<{ suiteId: string; reason: string }>>
  disposeAll(): void | Promise<void>
}

function mountProjectSurface(
  ctx: Context,
  catalog: Catalog,
  service: string | string[],
  create: (scope: Context, agent: ProjectAgent) => ProjectRegistry,
  withoutProject = false
): { refresh(): Promise<void>; dispose(): Promise<void> } {
  const host = ctx as unknown as { agents: { list(): ProjectAgent[] } }
  const mounts = new Map<ProjectAgent, AgentMount>()
  let disposed = false
  const warn = (error: unknown): void => ctx.logger?.warn(`[dsh-agent-plugins-market] project ${service}: ${String(error)}`)
  const attach = (agent: ProjectAgent): void => {
    const cwd = agent.session.header.cwd
    if (disposed || (cwd === undefined && !withoutProject) || mounts.has(agent)) return
    let refresh = async (): Promise<void> => {}
    const fiber = agent.ctx.inject(typeof service === 'string' ? [service] : service, scope => {
      const registry = create(scope, agent)
      let active = true
      let queue = Promise.resolve()
      refresh = (): Promise<void> => {
        queue = queue.catch(warn).then(async () => {
          if (!active) return
          const snapshot = cwd === undefined ? { enabledSuites: [] } : await catalog.readProjectCatalog(cwd)
          if (!active) return
          const diagnostics = await registry.reconcile([...snapshot.enabledSuites])
          if (!active) await registry.disposeAll()
          for (const diagnostic of diagnostics) warn(`${diagnostic.suiteId}: ${diagnostic.reason}`)
        })
        return queue
      }
      scope.effect(
        () => async () => {
          active = false
          await registry.disposeAll()
        },
        `dsh-agent-plugins-market: project ${service}`
      )
      void refresh().catch(warn)
    })
    mounts.set(agent, { fiber, refresh: () => refresh() })
  }
  const detach = async (agent: ProjectAgent): Promise<void> => {
    const mount = mounts.get(agent)
    mounts.delete(agent)
    await mount?.fiber.dispose()
  }
  const unwatchCreated = ctx.on('agent/created', ({ agent }) => attach(agent as unknown as ProjectAgent))
  const unwatchDisposed = ctx.on('agent/disposed', ({ agent }) => {
    void detach(agent as unknown as ProjectAgent).catch(warn)
  })
  const unwatchStart = ctx.on('agent/session-start', async ({ agent }) => {
    attach(agent as unknown as ProjectAgent)
    await mounts.get(agent as unknown as ProjectAgent)?.refresh()
  })
  for (const agent of host.agents.list()) attach(agent)
  return {
    refresh: async () => {
      await Promise.all([...mounts.values()].map(mount => mount.refresh()))
    },
    dispose: async () => {
      disposed = true
      unwatchCreated()
      unwatchDisposed()
      unwatchStart()
      await Promise.all([...mounts.keys()].map(detach))
    }
  }
}
