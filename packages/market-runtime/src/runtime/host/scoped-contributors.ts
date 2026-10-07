/** Agent-owned extension registrations; pending targets prepare data, committed policy authorizes effects. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SkillProviderControl } from '@deepseek-ai/dsh-skill'
import type { CatalogPort as Catalog } from '../../catalog-port.js'
import { pluginResourceId } from '../../application/panel-resources.js'
import { hookResourceId, type ExtensionSelection } from '../../../../market-contracts/src/contracts/extension-presets.js'
import { exposesIndividualHooks } from '../../application/extension-hook-selection.js'
import type { Suite } from '../../../../market-contracts/src/model/types.js'
import { SuiteSkillProvider } from '../surfaces/skills-provider.js'
import type { ShellSeam } from '../surfaces/dynamic-context.js'
import { CommandMountRegistry } from '../surfaces/commands-mounts.js'
import { UserCommandMountRegistry } from '../panels/user-commands.js'
import { UserPanelSkillProvider, type UserPanelStore } from '../panels/user-panels.js'
import { ExtensionHooks } from '../surfaces/extension-hooks.js'
import { suiteInstructions } from '../surfaces/project-runtime.js'
import { bindHostLocale, type HostTranslate } from './host-locale.js'
import type { McpMountFactory, McpMountPort } from '../../adapter-contracts.js'
import type { ExtensionMcpTool } from './extension-tool-gates.js'
import type { MenuRowRegistration } from './menu-row-identities.js'
import { inspectToolRegistry } from './tool-registry-observer.js'

export interface ScopedContributorPorts {
  dataRoot: string
  catalog: Catalog
  /** Validated selected projections; may read pending selection during registration, never grants execution. */
  suites?(agent: Agent): Promise<Suite[]>
  shell: () => ShellSeam | undefined
  allows(agent: Agent, resourceId: string, suiteId?: string): boolean
  registrationAllows?(agent: Agent, resourceId: string): boolean
  /**
   * Creates one MCP mount over the context it is given. The composition root
   * supplies the adapter, so this module never imports a transport package; the
   * agent-scoped mount and the workspace-pooled host bridge both come from it.
   */
  mcpMounts: McpMountFactory
  /** Production supplies panels; omission supports a skill-provider-only consumer. */
  panels?: { commands: UserPanelStore; skills?: UserPanelStore }
  t?: HostTranslate
  /** Plugin-owned root context for workspace-pooled host-compatibility MCP. */
  hostContext?: Context
}
interface Mount {
  controls: SkillProviderControl[]
  releaseSkills: Array<() => void>
  fiber?: ReturnType<Context['inject']>
  hookFiber?: ReturnType<Context['inject']>
  commands?: CommandMountRegistry
  users?: UserCommandMountRegistry
  hooks?: ExtensionHooks
  mcp?: McpMountPort
  instructions: Array<{ id: string; parent: string; text: string }>
  active: boolean
  hostMcpWorkspace?: string
}
const suiteId = (suite: Suite): string => 'market:' + suite.sourceId + '/' + suite.id
const entryId = (suite: Suite, kind: 'skills' | 'commands', name: string): string => kind + ':' + pluginResourceId(suite.sourceId, suite.id, kind, name)

export class ScopedExtensionContributors {
  private readonly mounted = new Map<Agent, Mount>()
  private readonly hostMcp = new Map<string, { fiber: ReturnType<Context['inject']>; registry: McpMountPort; agents: Set<Agent> }>()
  private readonly hostQueues = new Map<string, Promise<void>>()
  constructor(private readonly ports: ScopedContributorPorts) {}
  private registrationAllows(agent: Agent, id: string): boolean {
    return (this.ports.registrationAllows ?? this.ports.allows)(agent, id)
  }
  private registerSkills(agent: Agent, scope: Context, mount: Mount): void {
    mount.releaseSkills.push(
      scope.skills.registerProvider(control => {
        mount.controls.push(control)
        return new SuiteSkillProvider(this.ports.catalog, {
          dataRoot: this.ports.dataRoot,
          shell: this.ports.shell,
          ...(this.ports.suites === undefined
            ? {}
            : {
                suites: () => this.ports.suites!(agent),
                overrideDisabled: (suite: Suite, skill: Suite['skills'][number]) => mount.active && this.ports.allows(agent, entryId(suite, 'skills', skill.name))
              }),
          suiteAllowed: suite => mount.active && this.ports.allows(agent, suiteId(suite)),
          entryAllowed: (suite, skill) => mount.active && this.ports.allows(agent, entryId(suite, 'skills', skill.name))
        })
      })
    )
    const skills = this.ports.panels?.skills
    if (skills) {
      mount.releaseSkills.push(
        scope.skills.registerProvider(control => {
          mount.controls.push(control)
          return new UserPanelSkillProvider(skills, {
            enabled: entry => mount.active && this.ports.allows(agent, 'skills:' + entry.name)
          })
        })
      )
    }
  }
  private async attach(agent: Agent): Promise<Mount> {
    const current = this.mounted.get(agent)
    if (current) return current
    const mount: Mount = { controls: [], releaseSkills: [], instructions: [], active: true }
    this.mounted.set(agent, mount)
    if (!this.ports.panels) {
      const fiber = agent.ctx.inject(['skills'], scope => this.registerSkills(agent, scope, mount))
      mount.fiber = fiber
      await fiber
      return mount
    }
    const fiber = agent.ctx.inject(['skills', 'commands', 'tools', 'systemPrompt'], scope => {
      this.registerSkills(agent, scope, mount)
      const t = this.ports.t ?? bindHostLocale(undefined)
      mount.commands = new CommandMountRegistry(scope, t, this.ports.dataRoot)
      mount.users = new UserCommandMountRegistry(scope, this.ports.panels!.commands, t)
      mount.commands.setSelectionPolicy(
        (suite, name) => mount.active && this.ports.allows(agent, entryId(suite, 'commands', name)),
        (suite, name) => mount.active && this.registrationAllows(agent, entryId(suite, 'commands', name)),
        { allowDisabled: this.ports.suites !== undefined }
      )
      mount.users.setSelectionPolicy(
        name => mount.active && this.ports.allows(agent, 'commands:' + name),
        name => mount.active && this.registrationAllows(agent, 'commands:' + name),
        { allowDisabled: this.ports.suites !== undefined }
      )
      mount.hookFiber = scope.inject(['shell', 'sessionProjections'], hookScope => {
        // The suite grant covers every hook of a suite that publishes no individual
        // row; a suite that does publish them is decided hook by hook, on the exact
        // identity the inventory exposed.
        mount.hooks = new ExtensionHooks(
          hookScope,
          agent,
          suite => mount.active && this.ports.allows(agent, suiteId(suite)),
          (suite, event, index) => !exposesIndividualHooks(suite) || (mount.active && this.ports.allows(agent, hookResourceId(suite.sourceId, suite.id, event, index)))
        )
        hookScope.effect(() => () => mount.hooks!.dispose(), 'dsh-agent-plugins-market: scoped hooks')
      })
      mount.mcp = this.ports.mcpMounts(scope, this.ports.dataRoot)
      mount.mcp.setBackendProvider(() => this.ports.catalog.mcpBackend())
      mount.mcp.setOverridesProvider(async () => {
        const suites =
          this.ports.suites === undefined
            ? (await this.ports.catalog.readProjectCatalog(agent.session.header.cwd!)).enabledSuites
            : (await this.ports.suites(agent)).filter(suite => suite.dimension === 'project')
        const overrides = await this.ports.catalog.allMcpOverrides(suites)
        if (this.ports.suites === undefined) return overrides
        const projected = new Map(overrides)
        for (const suite of suites) {
          const owner = suite.sourceId + '/' + suite.id
          const rows = { ...overrides.get(owner) }
          for (const key of Object.keys(suite.mcp?.servers ?? {})) {
            if (this.registrationAllows(agent, 'mcp:plugin:' + owner + '/' + key)) rows[key] = { ...rows[key], enabled: true }
          }
          projected.set(owner, rows)
        }
        return projected
      })
      scope.systemPrompt.section({
        name: 'agent-plugins:instructions',
        order: 500,
        text: () =>
          mount.active
            ? mount.instructions
                .filter(row => this.ports.allows(agent, row.parent) && this.ports.allows(agent, row.id))
                .map(row => row.text)
                .join('\n\n')
            : ''
      })
      scope.effect(
        () => async () => {
          mount.active = false
          mount.instructions = []
          await mount.hooks?.dispose()
          mount.commands?.disposeAll()
          mount.users?.disposeAll()
          await mount.mcp?.disposeAll()
        },
        'dsh-agent-plugins-market: scoped contributors'
      )
    })
    mount.fiber = fiber
    try {
      await fiber
      if (!mount.commands || !mount.mcp) throw new Error('extension-contributors-not-ready')
      return mount
    } catch (error) {
      await this.dispose(agent)
      throw error
    }
  }
  /** Called inside the session maintenance transaction, before its committed record. */
  async reconcile(agent: Agent, selection: ExtensionSelection): Promise<void> {
    if (!this.ports.panels && !selection.enabledIds.some(id => id.startsWith('market:'))) {
      await this.dispose(agent)
      return
    }
    const mount = await this.attach(agent)
    for (const control of mount.controls) control.invalidate()
    if (!this.ports.panels) return
    const [suites, backend] = await Promise.all([
      this.ports.suites?.(agent) ??
        Promise.all([this.ports.catalog.enabledUserSuites(), this.ports.catalog.readProjectCatalog(agent.session.header.cwd!)]).then(([user, project]) => [
          ...user,
          ...project.enabledSuites
        ]),
      this.ports.catalog.mcpBackend()
    ])
    const selected = suites.filter(suite => this.registrationAllows(agent, suiteId(suite)))
    if (selected.some(suite => suite.activeSurfaces.hooks && suite.surfaces.hooks > 0) && !mount.hooks) throw new Error('extension-hooks-require-shell-and-session-projections')
    const diagnostics = await Promise.all([mount.commands!.reconcile(selected), mount.users!.reconcile(), mount.hooks?.reconcile(selected) ?? []])
    for (const group of diagnostics)
      for (const diagnostic of group) agent.ctx.logger.warn('[dsh-agent-plugins-market] ' + (typeof diagnostic === 'string' ? diagnostic : diagnostic.reason))
    const instructions: Mount['instructions'] = []
    for (const suite of selected) {
      const parent = suiteId(suite)
      const { startupSkill, ...manifest } = suite.manifest
      const paths = { dataRoot: this.ports.dataRoot, projectDir: agent.session.header.cwd! }
      const system = await suiteInstructions([{ ...suite, manifest }], paths)
      if (system.text) instructions.push({ id: parent, parent, text: system.text })
      if (startupSkill && this.registrationAllows(agent, entryId(suite, 'skills', startupSkill))) {
        const withoutSystem = { ...suite }
        delete withoutSystem.systemPrompt
        const startup = await suiteInstructions([withoutSystem], paths)
        if (startup.text) instructions.push({ id: entryId(suite, 'skills', startupSkill), parent, text: startup.text })
      }
    }
    mount.instructions = instructions
    if (backend === 'host') {
      await mount.mcp!.reconcile([])
      // Host compatibility remains global-managed, independent of session projection.
      await this.reconcileHostMcp(agent, mount, (await this.ports.catalog.readProjectCatalog(agent.session.header.cwd!)).enabledSuites)
    } else {
      await this.releaseHostMcp(agent, mount)
      const projectMcp = selected
        .filter(suite => suite.dimension === 'project')
        .map(suite =>
          suite.mcp === undefined
            ? suite
            : {
                ...suite,
                mcp: {
                  ...suite.mcp,
                  servers: Object.fromEntries(
                    Object.entries(suite.mcp.servers).filter(([key]) => this.registrationAllows(agent, 'mcp:plugin:' + suite.sourceId + '/' + suite.id + '/' + key))
                  )
                }
              }
        )
      for (const diagnostic of await mount.mcp!.reconcile(projectMcp)) agent.ctx.logger.warn('[dsh-agent-plugins-market] project MCP: ' + diagnostic.reason)
    }
  }
  private async hostOperation(cwd: string, work: () => Promise<void>): Promise<void> {
    const pending = (this.hostQueues.get(cwd) ?? Promise.resolve()).catch(() => {}).then(work)
    this.hostQueues.set(cwd, pending)
    try {
      await pending
    } finally {
      if (this.hostQueues.get(cwd) === pending) this.hostQueues.delete(cwd)
    }
  }
  private async reconcileHostMcp(agent: Agent, mount: Mount, suites: Suite[]): Promise<void> {
    const cwd = agent.session.header.cwd!
    await this.hostOperation(cwd, async () => {
      let shared = this.hostMcp.get(cwd)
      if (!shared) {
        const host = this.ports.hostContext
        if (!host) throw new Error('extension-host-mcp-owner-unavailable')
        let registry: McpMountPort | undefined
        const fiber = host.inject(['tools'], scope => {
          registry = this.ports.mcpMounts(scope, this.ports.dataRoot)
          registry.setBackendProvider(async () => 'host')
          registry.setToolNamesProvider(() => inspectToolRegistry(scope.tools).map(tool => tool.name))
          registry.setOverridesProvider(async () => this.ports.catalog.allMcpOverrides((await this.ports.catalog.readProjectCatalog(cwd)).enabledSuites))
          scope.effect(() => () => registry!.disposeAll(), 'dsh-agent-plugins-market: shared project MCP')
        })
        try {
          await fiber
        } catch (error) {
          await fiber.dispose()
          throw error
        }
        if (!registry) {
          await fiber.dispose()
          throw new Error('extension-host-mcp-owner-unavailable')
        }
        shared = { fiber, registry, agents: new Set() }
        this.hostMcp.set(cwd, shared)
      }
      shared.agents.add(agent)
      mount.hostMcpWorkspace = cwd
      for (const diagnostic of await shared.registry.reconcile(suites)) agent.ctx.logger.warn('[dsh-agent-plugins-market] project MCP: ' + diagnostic.reason)
    })
  }
  private async releaseHostMcp(agent: Agent, mount: Mount): Promise<void> {
    const cwd = mount.hostMcpWorkspace
    if (cwd === undefined) return
    delete mount.hostMcpWorkspace
    await this.hostOperation(cwd, async () => {
      const shared = this.hostMcp.get(cwd)
      if (!shared) return
      shared.agents.delete(agent)
      if (shared.agents.size > 0) return
      try {
        await shared.fiber.dispose()
      } finally {
        this.hostMcp.delete(cwd)
      }
    })
  }
  committed(agent: Agent): void {
    for (const control of this.mounted.get(agent)?.controls ?? []) control.invalidate()
  }
  /** Invalidate cached summaries and run startup hooks only after the session is durably ready. */
  async ready(agent: Agent, source?: string): Promise<void> {
    const mount = this.mounted.get(agent)
    for (const control of mount?.controls ?? []) control.invalidate()
    if (source === 'clear' || source === 'compact' || source === undefined) return
    try {
      await mount?.hooks?.start(source === 'resume' || source === 'legacy' ? 'resume' : 'startup')
    } catch (error) {
      agent.ctx.logger.warn('[dsh-agent-plugins-market] SessionStart hook failed: ' + String(error))
    }
  }
  invalidateAll(): void {
    for (const mount of this.mounted.values()) for (const control of mount.controls) control.invalidate()
  }
  toolOwnership(agent: Agent): ExtensionMcpTool[] {
    return this.mounted.get(agent)?.mcp?.toolOwnership() ?? []
  }
  registrations(): MenuRowRegistration[] {
    return [...this.mounted.values()].flatMap(mount => [...(mount.commands?.registrations() ?? []), ...(mount.users?.registrations() ?? [])])
  }
  async dispose(agent: Agent): Promise<void> {
    const mount = this.mounted.get(agent)
    if (!mount) return
    this.mounted.delete(agent)
    mount.active = false
    for (const release of mount.releaseSkills.splice(0)) release()
    await mount.fiber?.dispose()
    await this.releaseHostMcp(agent, mount)
  }
  async disposeAll(): Promise<void> {
    await Promise.all([...this.mounted.keys()].map(agent => this.dispose(agent)))
  }
}
