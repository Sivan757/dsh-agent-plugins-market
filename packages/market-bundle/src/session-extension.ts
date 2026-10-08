/** Session-owned selection, cached project readers, tool gates and scoped registration. */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ExtensionHooksOverview, ExtensionSelection } from '../../market-contracts/src/contracts/extension-presets.js'
import type { Suite } from '../../market-contracts/src/model/types.js'
import { loadDisabledLspServers } from '../../market-lsp/src/index.js'
import {
  ExtensionRuntime,
  ScopedExtensionContributors,
  attachExtensionToolGates,
  extensionWorkspace,
  projectExtensionSuites,
  readExtensionSuiteDeclarations,
  shellSeamOf,
  projectAgentRoles,
  type ExtensionToolGates,
  type ExtensionSuiteCandidate,
  type RuntimeReconciler,
  type HostTranslate,
  type createUserPanelStores,
  type createPanelResources
} from '../../market-runtime/src/index.js'
import type { Catalog } from './application/catalog.js'
import { createProjectExtensionResources } from './application/extension-project.js'
import { readExtensionInventory } from './application/extension-inventory.js'
import { mountExtensionPresetRoutes } from './routes-extension-presets.js'
import type { SuiteRouteSessionResolver } from './routes.js'
import { createMcpMount } from './runtime-adapters.js'

interface SessionExtensionOptions {
  ctx: Context
  dataRoot: string
  agentsRoot: string
  runtime: RuntimeReconciler
  hostLocale: { t: HostTranslate }
}

interface SessionExtensionSources {
  catalog: Catalog
  panels: ReturnType<typeof createUserPanelStores>
  resources: ReturnType<typeof createPanelResources>
  readUserDeclarations: () => Promise<ExtensionSuiteCandidate[]>
}

interface SessionExtensions {
  mount(sources: SessionExtensionSources): void
  invalidate(invalidateDefaultSkills: () => void): void
  refresh(): Promise<void> | undefined
  commandRegistrations(): ReturnType<ScopedExtensionContributors['registrations']>
  roles: (parent?: unknown) => ReturnType<typeof projectAgentRoles>
  session(): SuiteRouteSessionResolver | undefined
}

/** The catalog reads the settings Hooks page needs. */
type HooksOverviewCatalog = Pick<Catalog, 'enabledUserSuites' | 'overview' | 'mcpStatus' | 'lspStatus'>

/**
 * The settings Hooks page's read: one row per declared command hook.
 *
 * `enabledUserSuites()` already carries the Agent layout root's synthetic hook
 * suite whenever it declares events, so this read lists that result as it
 * stands: the suite enters once and each declaration publishes one id.
 */
export async function readHooksOverview(catalog: HooksOverviewCatalog): Promise<ExtensionHooksOverview> {
  const suites = await catalog.enabledUserSuites()
  const rows = await readExtensionInventory(
    {
      catalog: { overview: () => catalog.overview(), mcpStatus: async () => catalog.mcpStatus(), lspStatus: async () => catalog.lspStatus() },
      panels: { skills: { list: async () => [] }, commands: { list: async () => [] }, agents: { list: async () => [] } }
    },
    { projectSuites: suites }
  )
  return { rows: rows.filter(row => row.face === 'hooks') }
}

/**
 * Create the stable readers before catalog initialization. Mount only after its sources are loaded.
 * Call mount once. Host injection owns start and disposal; construction registers nothing.
 */
export function createSessionExtensions({ ctx, dataRoot, runtime, hostLocale }: SessionExtensionOptions): SessionExtensions {
  let extensionPresets: ExtensionRuntime | undefined
  let scopedContributors: ScopedExtensionContributors | undefined
  let selectedRoleSuites: ((agent: Agent) => Promise<Suite[]>) | undefined
  let suiteSession: SuiteRouteSessionResolver | undefined
  let listRoles: (parent?: unknown) => ReturnType<typeof projectAgentRoles> = async () => []

  const mount = ({ catalog, panels, resources, readUserDeclarations }: SessionExtensionSources): void => {
    ctx.inject(['agents', 'sessions', 'sessionQuery', 'tools'], hostCtx => {
      const eligible = (agent: Agent): boolean => {
        const cwd = agent.session.header.cwd
        return typeof cwd === 'string' && isAbsolute(cwd)
      }
      const gates = new Map<Agent, ExtensionToolGates>()
      const attachGate = (agent: Agent): ExtensionToolGates | undefined => {
        // An ineligible agent is never gated: the service does not own an agent
        // whose workspace it cannot even read.
        if (!eligible(agent)) return undefined
        const mounted = gates.get(agent)
        if (mounted) return mounted
        const gate = attachExtensionToolGates(
          agent,
          {
            mcpTools: () => [...runtime.mcpToolOwnership(), ...(scopedContributors?.toolOwnership(agent) ?? [])],
            lspProviders: () => runtime.lsp.providerOwnership(),
            ownsLspTool: () => runtime.lsp.ownsTool()
          },
          {
            ready: candidate => extensionRuntime.ready(candidate),
            allows: (candidate, resourceId, suiteId) => extensionRuntime.allows(candidate, resourceId, suiteId)
          }
        )
        gates.set(agent, gate)
        return gate
      }
      const projectReaders = new Map<Agent, ReturnType<typeof createProjectExtensionResources>>()
      const getProjectReader = (agent: Agent): ReturnType<typeof createProjectExtensionResources> => {
        const existing = projectReaders.get(agent)
        if (existing !== undefined) return existing
        const created = createProjectExtensionResources(catalog, panels, extensionWorkspace(agent))
        projectReaders.set(agent, created)
        return created
      }
      const pendingSelections = new Map<Agent, ExtensionSelection>()
      const readCandidates = async (agent: Agent): Promise<ExtensionSuiteCandidate[]> => {
        const [user, project] = await Promise.all([readUserDeclarations(), catalog.readProjectCatalog(extensionWorkspace(agent))])
        return [...user, ...(await readExtensionSuiteDeclarations(project.enabledSuites))]
      }
      const selectedSuites = async (agent: Agent, selection?: ExtensionSelection) => {
        const chosen = selection ?? pendingSelections.get(agent) ?? extensionRuntime.state.read(agent)?.selection
        if (!chosen) return []
        const enabledIds = [...chosen.enabledIds]
        if (enabledIds.some(id => id.startsWith('mcp:plugin:@user-mcp/user-mcp/'))) enabledIds.push('market:@user-mcp/user-mcp')
        return projectExtensionSuites(await readCandidates(agent), { ...chosen, enabledIds }).map(row => row.suite)
      }
      const extensionRuntime = new ExtensionRuntime(hostCtx, {
        dataRoot,
        // Only an agent with a real absolute workspace is governed. Every other
        // agent keeps the host's own lifecycle: no selection, no gate, no delay.
        eligible,
        // One reader per agent: it owns panel stores whose row caches must survive
        // across reads, so every caller shares the same instance.
        inventory: async agent => {
          const project = getProjectReader(agent)
          const [projectSuites, candidates, backend, lspDisabledIds] = await Promise.all([
            project.suites(),
            readCandidates(agent),
            catalog.mcpBackend(),
            loadDisabledLspServers(dataRoot)
          ])
          const listedSuites = [...projectSuites, ...candidates.map(row => row.suite).filter(suite => suite.sourceId === '@user-hooks')]
          const mcpOverrides = await catalog.allMcpOverrides(candidates.map(row => row.suite))
          return readExtensionInventory(
            {
              catalog: {
                overview: () => catalog.overview(),
                mcpStatus: async () => {
                  const [global, local] = await Promise.all([catalog.mcpStatus(), project.mcpStatus()])
                  return { ...global, entries: [...global.entries, ...local.entries] }
                },
                lspStatus: async () => {
                  const [global, local] = await Promise.all([catalog.lspStatus(), project.lspStatus()])
                  return { ...global, entries: [...global.entries, ...local.entries] }
                }
              },
              panels: Object.fromEntries(
                (['skills', 'commands', 'agents'] as const).map(kind => [
                  kind,
                  { list: async () => [...(await resources[kind].list(true)), ...(await project.panels[kind].list(true))] }
                ])
              ) as Parameters<typeof readExtensionInventory>[0]['panels']
            },
            { projectSuites: listedSuites, candidates, mcpOverrides, lspDisabledIds, sessionId: agent.id, mcpSessionControl: backend === 'builtin' }
          )
        },
        // The settings Hooks tab: hook declarations belong to the user Agent
        // layout root. Installed suites' declared hooks join them: the page
        // shows both sources, provenance on every row. The same
        // readExtensionInventory fan-out produces the rows the manager's Hooks
        // tab renders, so both surfaces agree on identity and support verdicts.
        hooksOverview: () => readHooksOverview(catalog),
        // A session change touches that session only: its own contributions and its
        // own gate. The global pipeline belongs to catalog changes, which the change
        // hook drives for every agent.
        applySelection: async (agent, selection) => {
          pendingSelections.set(agent, selection)
          let receipt: Awaited<ReturnType<typeof runtime.stageSessionDemand>> | undefined
          try {
            const [candidates, globalSuites, suites, backend] = await Promise.all([
              readUserDeclarations(),
              catalog.enabledUserSuites(),
              selectedSuites(agent, selection),
              catalog.mcpBackend()
            ])
            runtime.setCatalogAuthority(candidates, globalSuites)
            const shared = suites
              .filter(suite => suite.dimension === 'user')
              .map(suite => (backend === 'builtin' ? suite : { ...suite, mcp: undefined, activeSurfaces: { ...suite.activeSurfaces, mcp: false } }))
            receipt = await runtime.stageSessionDemand(
              agent,
              shared,
              selection.enabledIds.filter(id => id.startsWith('lsp:direct/')).map(id => id.slice(4))
            )
            attachGate(agent)?.refresh()
            await contributors.reconcile(agent, selection)
            return receipt
          } catch (error) {
            try {
              await receipt?.rollback()
            } catch (cleanupError) {
              ctx.logger.warn(String(cleanupError))
            }
            throw error
          } finally {
            pendingSelections.delete(agent)
          }
        },
        committed: agent => {
          contributors.committed(agent)
          attachGate(agent)?.refresh()
        },
        ready: async (agent, source) => {
          if (!eligible(agent)) return
          attachGate(agent)?.refresh()
          if (!extensionRuntime.ready(agent)) return
          await contributors.ready(agent, source)
        }
      })
      const contributors = new ScopedExtensionContributors({
        mcpMounts: createMcpMount,
        dataRoot,
        catalog,
        // Resolved lazily: the seam reader below is declared later in this scope,
        // and the agents fiber can activate before that declaration runs.
        shell: () => shellSeamOf(ctx),
        allows: (agent, resourceId, suiteId) => extensionRuntime.allows(agent, resourceId, suiteId),
        registrationAllows: (agent, resourceId) => extensionRuntime.registrationAllows(agent, resourceId),
        panels,
        suites: agent => selectedSuites(agent),
        hostContext: hostCtx,
        t: key => hostLocale.t(key)
      })
      scopedContributors = contributors
      selectedRoleSuites = agent => selectedSuites(agent)
      hostCtx.on('agent/disposed', ({ agent }) => {
        gates.get(agent)?.dispose()
        gates.delete(agent)
        projectReaders.delete(agent)
        pendingSelections.delete(agent)
        void runtime.releaseSessionDemand(agent).catch(error => ctx.logger.warn(String(error)))
        void contributors.dispose(agent).catch(error => ctx.logger.warn('extension disposal: ' + String(error)))
      })
      // The route resolver shares the very same per-agent reader as the inventory,
      // so a detail read and an inventory read never build two panel caches.
      suiteSession = {
        agent: sessionId => hostCtx.agents.get(SessionId(sessionId)),
        project: getProjectReader
      }
      hostCtx.effect(
        () => () => {
          projectReaders.clear()
        },
        'dsh-agent-plugins-market: project readers'
      )
      hostCtx.inject(['webServer', 'loader'], webCtx => {
        webCtx.effect(
          () => mountExtensionPresetRoutes(webCtx as unknown as Parameters<typeof mountExtensionPresetRoutes>[0], extensionRuntime),
          'dsh-agent-plugins-market: extension preset routes'
        )
      })
      hostCtx.effect(() => {
        extensionPresets = extensionRuntime
        for (const agent of hostCtx.agents.list()) attachGate(agent)
        void extensionRuntime.start().catch(error => {
          ctx.logger?.warn?.('[dsh-agent-plugins-market] extension presets: ' + (error instanceof Error ? error.message : String(error)))
        })
        return async () => {
          if (extensionPresets === extensionRuntime) extensionPresets = undefined
          if (scopedContributors === contributors) scopedContributors = undefined
          await extensionRuntime.dispose()
          await contributors.disposeAll()
          for (const gate of gates.values()) gate.dispose()
          gates.clear()
        }
      }, 'dsh-agent-plugins-market: extension presets')
    })
    listRoles = async (parent?: unknown) => {
      const agent = parent as Agent | undefined
      if (!agent || !extensionPresets?.ready(agent)) return []
      const user = (await resources.agents.list(true))
        .filter(entry => entry.origin === 'user' && extensionPresets?.allows(agent, 'agents:' + (entry.id ?? entry.name)))
        .map(entry => ({ ...entry, title: entry.name, name: entry.id ?? entry.name, selectionEnabled: true }))
      const project = await projectAgentRoles(catalog, parent, {
        suites: () => selectedRoleSuites?.(agent) ?? Promise.resolve([]),
        selected: role => extensionPresets?.allows(agent, 'agents:' + role.name) === true
      })
      return [...user, ...project]
    }
  }

  return {
    mount,
    /** Preserve revocation before default-provider invalidation and contributor refresh. */
    invalidate(invalidateDefaultSkills: () => void): void {
      extensionPresets?.invalidate()
      invalidateDefaultSkills()
      scopedContributors?.invalidateAll()
    },
    refresh: (): Promise<void> | undefined => extensionPresets?.refreshAll(),
    commandRegistrations: () => scopedContributors?.registrations() ?? [],
    roles: (parent?: unknown) => listRoles(parent),
    session: (): SuiteRouteSessionResolver | undefined => suiteSession
  }
}
