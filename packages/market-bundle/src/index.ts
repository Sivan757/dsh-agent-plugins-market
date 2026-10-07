/**
 * dsh-agent-plugins-market host entry: the Agent Plugins Market manager.
 *
 * Function plugin (named exports, no default export). It registers one skill
 * provider feeding enabled suites into `ctx.skills`, reconciles enabled
 * suites' `mcp.json` servers into live self-built bridge mounts (stdio,
 * Streamable HTTP with OAuth, and legacy SSE — no host MCP client needed),
 * and mounts the market page's HTTP routes on the web server. Skills and MCP
 * tools are exposed through the host's native model surfaces; this plugin
 * does not register a redundant suite-inventory model tool.
 *
 * Requires `ctx.skills` (the dsh skill registry). MCP mounting is
 * self-contained: suites' MCP servers mount through the market's own bridge
 * plugin on the host `tools` registry.
 */
import { isAbsolute } from 'node:path'
import { type Context, type Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cosmokit'
import type { SkillProviderControl } from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'
import { MarketSettingsFields } from './platform/settings-schema.js'
import type { DownloadRegionSetting } from '../../market-contracts/src/contracts/settings.js'
import { Catalog } from './application/catalog.js'
import type { CatalogPortsOverride } from '../../market-contracts/src/ports/ports.js'
import { settlesWithin } from '../../market-catalog/src/index.js'
import { RuntimeReconciler } from '../../market-runtime/src/index.js'
import { ReconcileScheduler } from '../../market-runtime/src/index.js'
import { MarketSettingsNamespace } from './platform/settings-namespace.js'
import { SurfaceToggleService } from '../../market-runtime/src/index.js'
import { ALL_SURFACES_ON } from '../../market-contracts/src/contracts/surface-toggles.js'
import { deleteMcpAuthGrant } from '../../market-mcp/src/index.js'
import { inspectToolRegistry, toolsServiceOf } from '../../market-runtime/src/index.js'
import { createLlmTranslator } from '../../market-translation/src/index.js'
import { createTranslationProviders } from '../../market-translation/src/index.js'
import { migratePluginStorage } from '../../market-catalog/src/index.js'
import { mountAgentRoleTool } from '../../market-runtime/src/index.js'
import { mountUnlessAgentTeams } from '../../market-runtime/src/index.js'
import { mountTeammateRoleTool } from '../../market-runtime/src/index.js'
import { mountTeamCoordination } from '../../market-runtime/src/index.js'
import { projectAgentRoles } from '../../market-runtime/src/index.js'
import { ExtensionRuntime, extensionWorkspace } from '../../market-runtime/src/index.js'
import { attachExtensionToolGates, type ExtensionToolGates } from '../../market-runtime/src/index.js'
import { ScopedExtensionContributors } from '../../market-runtime/src/index.js'
import { SessionId } from '@deepseek-ai/dsh-session'
import { readExtensionInventory } from './application/extension-inventory.js'
import { readExtensionSuiteDeclarations } from '../../market-runtime/src/index.js'
import { projectExtensionSuites, type ExtensionSuiteCandidate } from '../../market-runtime/src/index.js'
import { loadUserMcpSuite } from '../../market-mcp/src/index.js'
import { loadUserHooksSuite } from '../../market-runtime/src/index.js'
import type { ExtensionSelection } from '../../market-contracts/src/contracts/extension-presets.js'
import { createProjectExtensionResources } from './application/extension-project.js'
import { mountExtensionPresetRoutes } from './routes-extension-presets.js'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createPanelResources } from '../../market-runtime/src/index.js'
import { resolveAgentsRoot, resolveDataRoot, resolveUserRoot } from '../../market-catalog/src/index.js'
import { mountSuiteRoutes } from './routes.js'
import { mountResourceRoutes } from './routes-resources.js'
import { ResourceFilterService } from '../../market-runtime/src/index.js'
import { shellSeamOf } from '../../market-runtime/src/index.js'
import { loadLspServers } from '../../market-lsp/src/index.js'
import { loadDisabledLspServers } from '../../market-lsp/src/index.js'
import {
  bindHostLocale,
  LOCALE_SETTINGS_ENTRY,
  readHostLocalePreference,
  readLocalePreference,
  setHostLocaleSource,
  type HostTranslate,
  type LocaleSettingsSource
} from '../../market-runtime/src/index.js'
import { createUserPanelStores } from '../../market-runtime/src/index.js'
import { SourceAutoUpdater } from '../../market-runtime/src/index.js'
import { UserPanelSkillProvider } from '../../market-runtime/src/index.js'
import { collectMenuRowIdentities } from '../../market-runtime/src/index.js'
import type { SourceRef } from '../../market-contracts/src/model/types.js'
import { presetSourceRef } from '../../market-contracts/src/model/preset-source.js'

import { createRuntimeMounts, createMcpMount } from './runtime-adapters.js'

export const name = 'dsh-agent-plugins-market'
export const inject = ['skills', 'commands']

/** Host configuration. */
/** Host configuration; the five market settings arrive as volatile references the host updates in place. */
export interface Config {
  /** User-dimension suite root; defaults to `~/.dsh/agent-plugins` (`$DSH_HOME/agent-plugins`). */
  userRoot?: string
  /** Legacy mutable data root to migrate; writes always use the canonical root/data. */
  dataRoot?: string
  /** Initial repository sources, merged into the persisted state on first load. */
  sources?: SourceRef[]
  /**
   * Git/archive acquisition tuning: `proxy` (http/https proxy URL),
   * `insteadOf` URL-prefix rewrites (mirror acceleration), `timeoutMs` per
   * git invocation, `cloneRetry` (default true), `fallbackTarball` (retry a
   * failed GitHub clone as a codeload tarball download; default false), and
   * `allowHttpArchives` (permit plain-http archive URLs; default false).
   */
  git?: {
    proxy?: string
    insteadOf?: Record<string, string>
    timeoutMs?: number
    cloneRetry?: boolean
    fallbackTarball?: boolean
    allowHttpArchives?: boolean
  }
  /** MCP mount backend switch; updated live through the host settings service. */
  mcpEnhanced: Volatile<boolean | undefined>
  /** Project-layout discovery switch; updated live through the host settings service. */
  scanProjectLayouts: Volatile<boolean | undefined>
  /** Download region choice; updated live through the host settings service. */
  downloadRegion: Volatile<DownloadRegionSetting | undefined>
  /** Experience-feedback tool switch; updated live through the host settings service. */
  feedbackEnabled: Volatile<boolean | undefined>
  /** Background source-update switch; updated live through the host settings service. */
  autoUpdateSources: Volatile<boolean | undefined>
  /** UI translation switch; updated live through the host settings service. */
  translationEnabled: Volatile<boolean | undefined>
  /** Agent preset manager switch (experimental); updated live through the host settings service. */
  agentPresetsEnabled: Volatile<boolean | undefined>
}

/**
 * Schemastery projection the host loader reads: the seven volatile fields become
 * the `dsh-agent-plugins-market` settings namespace (the Plugins panel's
 * configuration page reads it), while the startup fields stay plain.
 */
/** The schema's input face: every field optional, exactly what a profile patch may carry. */
export interface ConfigInput {
  userRoot?: string | null
  dataRoot?: string | null
  sources?: unknown
  git?: {
    proxy?: string | null
    insteadOf?: Record<string, unknown>
    timeoutMs?: number | null
    cloneRetry?: boolean | null
    fallbackTarball?: boolean | null
    allowHttpArchives?: boolean | null
  }
  mcpEnhanced?: boolean | null
  scanProjectLayouts?: boolean | null
  downloadRegion?: 'auto' | 'global' | 'china' | null
  feedbackEnabled?: boolean | null
  autoUpdateSources?: boolean | null
  translationEnabled?: boolean | null
  agentPresetsEnabled?: boolean | null
}

export const Config = z.object({
  userRoot: z.union([z.string(), z.const(undefined)]),
  dataRoot: z.union([z.string(), z.const(undefined)]),
  sources: z.any(),
  git: z.object({
    proxy: z.string(),
    insteadOf: z.dict(z.string(), z.any()),
    timeoutMs: z.natural(),
    cloneRetry: z.boolean(),
    fallbackTarball: z.boolean(),
    allowHttpArchives: z.boolean()
  }),
  mcpEnhanced: MarketSettingsFields.mcpEnhanced.volatile(),
  scanProjectLayouts: MarketSettingsFields.scanProjectLayouts.volatile(),
  downloadRegion: MarketSettingsFields.downloadRegion.volatile(),
  feedbackEnabled: MarketSettingsFields.feedbackEnabled.volatile(),
  autoUpdateSources: MarketSettingsFields.autoUpdateSources.volatile(),
  translationEnabled: MarketSettingsFields.translationEnabled.volatile(),
  agentPresetsEnabled: MarketSettingsFields.agentPresetsEnabled.volatile()
})

const undefinedRef = { get: () => undefined as never }

export async function apply(
  ctx: Context,
  config: Config = {
    mcpEnhanced: undefinedRef,
    scanProjectLayouts: undefinedRef,
    downloadRegion: undefinedRef,
    feedbackEnabled: undefinedRef,
    autoUpdateSources: undefinedRef,
    translationEnabled: undefinedRef,
    agentPresetsEnabled: undefinedRef
  }
): Promise<void> {
  const userRoot = resolveUserRoot(config.userRoot)
  const dataRoot = resolveDataRoot(config.dataRoot, userRoot)
  const agentsRoot = resolveAgentsRoot()
  const migration = await migratePluginStorage(config)
  if (migration.conflicts.length > 0) throw new Error(`Plugin storage migration conflicts (original files retained): ${migration.conflicts.join(', ')}`)

  let userPanelControl: SkillProviderControl | undefined
  // Host runtime copy resolves from the harness `locale.preference` setting.
  const hostLocale: { t: HostTranslate } = { t: bindHostLocale(undefined) }
  /**
   * The host locale preference the panel and status surfaces render in.
   *
   * Held beside the host copy above rather than re-read per call: the host
   * answers the preference by projecting every active profile entry's live
   * configuration, so one read is a whole-profile scan. Both values come from
   * one read and are refreshed by the same three points — activation, the
   * settings service landing, and the `locale` entry's own document update — so
   * the panels follow a language switch exactly as the copy the plugin renders
   * does, and no per-entity read pays a projection for a value that has not
   * moved. A change that fires no settings-document event leaves both stale
   * together, which is the freshness the host copy already lives with.
   */
  let localePreference = 'zh'
  const refreshHostLocale = (): void => {
    const preference = readLocalePreference()
    hostLocale.t = bindHostLocale(preference)
    localePreference = preference ?? 'zh'
    userPanelControl?.invalidate()
  }
  // The preference is the `locale` entry's live configuration, projected by the
  // host settings service. Resolve that service through the store from this
  // entry's own context, and register the wiring as an effect so it lives
  // exactly as long as this fiber: a context captured from an injection
  // callback throws `cannot get required service "settings" in inactive
  // context` once a profile reload disposes that fiber, and the unhandled
  // rejection ends the host. Re-read once the service lands, because it may
  // mount after this plugin.
  ctx.effect(() => setHostLocaleSource(() => readHostLocalePreference(ctx.get('settings') as LocaleSettingsSource | undefined)), 'dsh-agent-plugins-market: host locale source')
  refreshHostLocale()
  ctx.inject(['settings'], () => {
    refreshHostLocale()
  })
  // A language switch writes the `locale` entry's form; re-read so the copy the
  // market renders follows it without a reload.
  ctx.effect(
    () =>
      ctx.on('settings/document-updated' as Parameters<Context['on']>[0], (ns: string) => {
        if (ns === LOCALE_SETTINGS_ENTRY) refreshHostLocale()
      }),
    'dsh-agent-plugins-market: host locale refresh'
  )

  const runtime = new RuntimeReconciler(ctx, dataRoot, createRuntimeMounts(ctx, dataRoot), key => hostLocale.t(key))
  /** Set once the agents-scoped extension runtime mounts; read by the change pipeline. */
  let extensionPresets: ExtensionRuntime | undefined
  /** Live-session address for the market's project-detail routes; set with the runtime. */
  let suiteSession: { agent(sessionId: string): Agent | undefined; project(agent: Agent): ReturnType<typeof createProjectExtensionResources> } | undefined

  // User panel stores (skills / commands / agent personas) and their runtime
  // contributions: one extra skill provider plus one command mount registry.
  const panels = createUserPanelStores(agentsRoot)

  let disposed = false
  let scopedContributors: ScopedExtensionContributors | undefined
  let selectedRoleSuites: ((agent: Agent) => Promise<import('../../market-contracts/src/model/types.js').Suite[]>) | undefined

  const scheduler = new ReconcileScheduler(ctx, runtime, {
    // Always the full enabled set. A switched-off surface is gated inside the
    // reconciler's own mount branch, never by filtering here: MCP, commands and
    // LSP all mount from this one snapshot, so dropping a suite for one switch
    // would unmount that suite's mounts on the other two. A market-face entry
    // filter is the one deliberate exception: its row IS the suite, so denying
    // it in this workspace means the suite mounts nothing here — the same
    // semantics as the global enable switch, one workspace deep.
    enabledSuites: () => catalog.enabledUserSuites(),
    declarations: () => readUserDeclarations(),
    publishMcpDiagnostics: diagnostics => {
      catalog.mcpDiagnostics = diagnostics
    }
  })
  runtime.setAgentScopedContributors()

  /**
   * How long the change pipeline holds the queue on one stage. A mount that
   * stops responding — a stdio server that never finishes its handshake, a
   * browser authorization nobody completed — delays its own surface only; the
   * stage keeps running while the pipeline moves on to the next change.
   */
  const CHANGE_STAGE_DEADLINE_MS = 20_000

  /** Run one pipeline stage, logging its failure or its overrun instead of holding the pipeline. */
  const runStage = async (stage: string, work: () => Promise<unknown> | undefined): Promise<void> => {
    const running = (async () => await work())()
    void running.catch(error => {
      ctx.logger?.warn(`[dsh-agent-plugins-market] ${stage} failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    if (!(await settlesWithin(running, CHANGE_STAGE_DEADLINE_MS))) {
      ctx.logger?.warn(`[dsh-agent-plugins-market] ${stage} is still running after ${CHANGE_STAGE_DEADLINE_MS}ms; the change pipeline continues without waiting for it`)
    }
  }

  /**
   * Catalog change pipeline: invalidate the derived skill and command
   * surfaces, refresh the project mounts, then reconcile every runtime mount.
   * `CatalogContext` schedules it in the background, so a stage that overruns
   * costs freshness, never the mutation that asked for it.
   */
  const onChanged = async (): Promise<void> => {
    if (disposed) return
    // A catalog change can revoke a globally managed resource, so every agent's
    // cached inventory is dropped before the mounts below reconcile: the next
    // authorization call denies until the new catalog has been read.
    extensionPresets?.invalidate()
    userPanelControl?.invalidate()
    scopedContributors?.invalidateAll()
    await runStage('runtime mounts', () => scheduler.request())
    await runStage('extension contributors', () => extensionPresets?.refreshAll())
  }

  // Background source updates: off until the settings switch says otherwise.
  const autoUpdate = new SourceAutoUpdater(ctx, () => catalog.refreshSource())

  const settings = new MarketSettingsNamespace(
    ctx,
    config,
    dataRoot,
    hostLocale,
    {
      setScanProjectLayouts: enabled => catalog.setScanProjectLayouts(enabled),
      refreshMcpMounts: () => {
        void onChanged().catch(() => {})
      },
      setAutoUpdateSources: enabled => autoUpdate.setEnabled(enabled),
      syncTranslationEnabled: () => {
        catalog.syncTranslationEnabled()
      }
    },
    // The cached preference above, not a fresh host read: the translation default
    // follows the language, and this reader is called on every settings read.
    () => localePreference
  )

  // Per-workspace surface switches: the composer control writes them and every
  // mount below reads them, so a toggle runs through the ordinary refresh chain.
  const surfaceToggles = new SurfaceToggleService(dataRoot, process.cwd(), {
    onTogglesChanged: async () => {
      await onChanged()
    }
  })
  // Per-workspace entry filters (the project resource window) share the same
  // document and the same refresh chain: flipping one entry reconciles exactly
  // like flipping its surface switch, through the contributors' own gates.
  const resourceFilters = new ResourceFilterService(dataRoot, process.cwd(), {
    onFiltersChanged: async () => {
      await onChanged()
    }
  })
  void Promise.all([surfaceToggles.reload(), resourceFilters.reload()])
  // Each switchable surface answers its own gate at the mount branch, so the
  // six switches stay orthogonal: turning MCP off reconciles the MCP mounts to
  // zero servers while the same suites keep their language servers, and the
  // reverse for LSP.

  // The credentials store powers the MCP re-authorize action (dropping a grant
  // record forces the next mount through a fresh browser authorization). Every
  // port below is read at call time: this plugin's apply may run before the
  // credentials, tools and settings services provision, and a snapshot taken
  // here would be permanently undefined even after the service is live.
  // Read at call time: the tools service provisions after apply() returns.
  let toolsRegistry: unknown = toolsServiceOf(ctx)
  const ports: CatalogPortsOverride = {
    mcpToolSnapshot: () => inspectToolRegistry(toolsRegistry),
    credentialsStore: {
      deleteGrantRecord: async serverName => {
        const store = (ctx as unknown as { get?: (name: string) => unknown }).get?.('credentials')
        await deleteMcpAuthGrant(store, serverName)
      }
    },
    // Re-authorize must rebuild the live bridge, not just drop the grant: the
    // registry flags the mount and the following reconcile tears it down and
    // remounts, so the server's 401 restarts the browser authorization.
    mcpRemount: (suiteId, serverKey) => runtime.forceMcpRemount(suiteId, serverKey),
    mcpRemountAll: () => runtime.forceMcpRemountAll(),
    mcpServerOwner: serverName => runtime.mcpServerOwner(serverName),
    lspStatusSource: runtime.lsp,
    mcpBackend: () => settings.backend(),
    setMcpBackend: backend => settings.setBackend(backend),
    downloadRegion: () => settings.downloadRegion(),
    localePreference: () => localePreference,
    // Read per call, like every port here: the registries change on each
    // reconcile and the panels on each edit, so a snapshot would serve rows the
    // menu no longer has. Attribution is by the panel's own listing, so the
    // text a row translates is the text the panel already cached.
    menuRowIdentities: () =>
      collectMenuRowIdentities({
        panels: resources,
        commands: scopedContributors?.registrations() ?? []
      }),
    // Built unconditionally: every provider reads its host services per call,
    // and the settings switch is read live by the localizer. Capturing the
    // switch here froze it at apply time, so turning translation on after load
    // left an empty chain and nothing was ever translated.
    translationProviders: createTranslationProviders({ host: ctx, llm: createLlmTranslator(ctx) }),
    translationEnabled: () => settings.translationEnabled(),
    // Folded into every cache key. Constant while the chain is unchanged, so
    // switching translation off and on again reuses what is already cached
    // instead of re-paying for every text under a second key space.
    translationProviderIdentity: () => 'google|microsoft|llm'
  }

  const catalog = new Catalog({ userRoot, dataRoot, agentsRoot, onChanged, ports, ...(config.git === undefined ? {} : { git: config.git }) })
  await catalog.load()
  const readUserDeclarations = async (): Promise<ExtensionSuiteCandidate[]> => {
    const [installed, direct] = await Promise.all([catalog.installedSuiteDeclarations(), Promise.all([loadUserMcpSuite(agentsRoot), loadUserHooksSuite(agentsRoot)])])
    return [...installed, ...(await readExtensionSuiteDeclarations(direct))]
  }
  // Translation is lazy by design: nothing is translated until a panel read
  // asks for it, so a deployment that never opens the market pays nothing. The
  // model-backed provider needs the host model services, and those provision
  // *after* apply() returns, which is exactly why no warm-up is scheduled here —
  // the read path resolves them per call.
  // Configured seeds first, then the record this plugin presets: the market
  // lists the first-party collection on the first open, and the ordinary
  // refresh path clones it. Registration performs no network access.
  await catalog.mergeSources([...(config.sources ?? []), presetSourceRef()])
  const resources = createPanelResources(catalog, panels)

  // Session extension presets. One runtime owns the session selection, the
  // route surface and the per-agent tool gates; every inventory read comes
  // from the live catalog, and a catalog change re-reads it for every agent,
  // so a global disable or uninstall denies the next call instead of waiting
  // for a panel poll. A gate is attached per agent and only ever released for
  // that agent: shared MCP/LSP servers are not torn down by one session.
  // The runtime reads the agents service, so it is constructed inside the fiber
  // that has it: a profile without the service never loads presets at all,
  // rather than half-loading and failing every session. The routes mount from a
  // scope nested in that one, so the service exists before the first request.
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
      hooksOverview: async () => {
        const suites = [...(await catalog.enabledUserSuites()), await loadUserHooksSuite(agentsRoot)]
        const rows = await readExtensionInventory(
          {
            catalog: { overview: () => catalog.overview(), mcpStatus: async () => catalog.mcpStatus(), lspStatus: async () => catalog.lspStatus() },
            panels: { skills: { list: async () => [] }, commands: { list: async () => [] }, agents: { list: async () => [] } }
          },
          { projectSuites: suites }
        )
        return { rows: rows.filter(row => row.face === 'hooks') }
      },
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
  runtime.setMcpOverridesProvider(async () => catalog.allMcpOverrides((await readUserDeclarations()).map(candidate => candidate.suite)))
  runtime.lsp.setDirectProvider(async () => {
    // An empty table is the lsp-off state: the seam stays mounted (the plugin
    // owns it unconditionally) but serves no servers.
    const { servers } = await loadLspServers(agentsRoot)
    return servers
  })
  runtime.lsp.setDisabledProvider(() => loadDisabledLspServers(dataRoot))
  runtime.setMcpBackendProvider(() => catalog.mcpBackend())

  // The namespace must be registered after the catalog exists: the host
  // resolves the inject callback synchronously when the settings service is
  // already mounted, and the registration reads back the project-layout switch.
  settings.mount()

  ctx.inject(['tools'], toolsCtx => {
    toolsRegistry = (toolsCtx as unknown as { tools: unknown }).tools
    // Foreign-namespace guard: a native host MCP client (or another plugin)
    // owning `mcp__<serverName>__` names makes the mount registry skip its
    // own server with a clear diagnostic instead of failing mid-registration.
    runtime.setMcpToolNamesProvider(() => inspectToolRegistry(toolsRegistry).map(tool => tool.name))
  })

  void Promise.resolve()
    .then(async () => {
      await scheduler.request()
    })
    .catch(() => {})

  // The global provider supplies defaults; agent-scoped providers enforce saved preset choices.
  ctx.skills.registerProvider(control => {
    userPanelControl = control
    return new UserPanelSkillProvider(panels.skills)
  })

  // Both entry points read the same live user/project role set. Team owns the
  // enhanced entry's member identities and all subsequent collaboration.
  const listRoles = async (parent?: unknown) => {
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
  ctx.inject(['tools', 'llm', 'subagents', 'agents'], hostCtx => {
    hostCtx.effect(() => mountUnlessAgentTeams(hostCtx, () => mountAgentRoleTool(hostCtx, listRoles)), 'dsh-agent-plugins-market: agent role routing')
  })

  // Coordination also serves native teammates and does not depend on role discovery.
  ctx.inject(['agents', 'agentTeams', 'systemPrompt'], teamCtx => {
    teamCtx.effect(() => mountTeamCoordination(teamCtx), 'dsh-agent-plugins-market: Team coordination')
  })

  ctx.inject(['tools', 'llm', 'subagents', 'agents', 'agentTeams', 'sessions', 'sessionQuery', 'systemPrompt'], teamCtx => {
    teamCtx.effect(() => mountTeammateRoleTool(teamCtx, listRoles), 'dsh-agent-plugins-market: role teammates')
  })

  ctx.inject(['webServer', 'loader'], hostCtx => {
    // With the market switch off the market routes never mount, so the panel
    // is unreachable for this workspace until the switch returns on and the
    // refresh chain remounts them. The resource-window routes stay mounted
    // either way: the window is the meta-surface that owns all six switches,
    // and taking it down with one of them would strand the user.
    hostCtx.effect(() => {
      const disposeSuite = mountSuiteRoutes(hostCtx, catalog, resources, surfaceToggles, suiteSession)
      const disposeResources = mountResourceRoutes(hostCtx, {
        catalog,
        panels: resources,
        filters: resourceFilters,
        workspace: process.cwd(),
        setEntry: (face, entryId, enabled) => resourceFilters.setEntry(face, entryId, enabled),
        applyFavorite: async id => {
          const favorite = (await resourceFilters.favorites()).find(entry => entry.id === id)
          if (favorite === undefined) throw new Error('favorite not found')
          const offEntries: Partial<Record<keyof typeof favorite.surfaces, string[]>> = {}
          for (const entry of favorite.offEntries) {
            const separator = entry.indexOf(':')
            const face = entry.slice(0, separator)
            if (!(face in favorite.surfaces)) continue
            ;(offEntries[face as keyof typeof favorite.surfaces] ??= []).push(entry)
          }
          await surfaceToggles.applyAll(favorite.surfaces)
          await resourceFilters.applyFilters(favorite.surfaces, offEntries)
        },
        resetWorkspace: async () => {
          await surfaceToggles.applyAll({ ...ALL_SURFACES_ON })
          await resourceFilters.applyFilters({ ...ALL_SURFACES_ON }, {})
        },
        saveFavorite: async name => {
          const filters = resourceFilters.currentFilters()
          const offEntries = Object.entries(filters.offEntries).flatMap(([, ids]) => ids ?? [])
          return (await resourceFilters.saveFavorite({ name, surfaces: filters.toggles, offEntries })).id
        },
        deleteFavorite: id => resourceFilters.deleteFavorite(id)
      })
      return () => {
        disposeSuite?.()
        disposeResources()
      }
    }, 'dsh-agent-plugins-market: http routes')
  })

  ctx.effect(
    () => () => {
      disposed = true
      scheduler.dispose()
      autoUpdate.dispose()
      settings.dispose()
      catalog.dispose()
      void runtime.dispose()
    },
    'dsh-agent-plugins-market: lifecycle'
  )
}
