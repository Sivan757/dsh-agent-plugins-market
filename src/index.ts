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
import type { Context } from '@deepseek-ai/cordis'
import type { SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { Catalog } from './application/catalog.js'
import type { CatalogPortsOverride } from './application/ports.js'
import { RuntimeReconciler } from './runtime/reconciler.js'
import { ReconcileScheduler } from './runtime/reconcile-scheduler.js'
import { MarketSettingsNamespace } from './runtime/settings-namespace.js'
import { deleteMcpAuthGrant } from './runtime/mcp-auth-record.js'
import { inspectToolRegistry } from './runtime/tool-registry-observer.js'
import { migratePluginStorage } from './runtime/storage-migration.js'
import { mountAgentRoleTool } from './runtime/agent-role-router.js'
import { projectAgentRoles } from './application/project-agent-roles.js'
import { mountProjectCommands, mountProjectMcp, mountProjectHooks, mountSuiteInstructions } from './runtime/project-runtime.js'
import { createPanelResources } from './application/panel-resources.js'
import { resolveAgentsRoot, resolveDataRoot, resolveUserRoot } from './catalog/paths.js'
import { mountSuiteRoutes } from './routes.js'
import { SuiteSkillProvider } from './runtime/skills-provider.js'
import { loadLspServers } from './runtime/lsp-direct-config.js'
import { loadDisabledLspServers } from './runtime/lsp-server-state.js'
import { bindHostLocale, loadHostLocale, type HostTranslate } from './runtime/host-locale.js'
import { createUserPanelStores } from './runtime/user-panels.js'
import { SourceAutoUpdater } from './runtime/source-auto-update.js'
import { UserPanelSkillProvider } from './runtime/user-panels.js'
import { UserCommandMountRegistry } from './runtime/user-commands.js'
import type { SourceRef } from './model/types.js'

export const name = 'dsh-agent-plugins-market'
export const inject = ['skills', 'commands']

/** Host configuration. */
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
}

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const userRoot = resolveUserRoot(config.userRoot)
  const dataRoot = resolveDataRoot(config.dataRoot, userRoot)
  const agentsRoot = resolveAgentsRoot()
  const migration = await migratePluginStorage(config)
  if (migration.conflicts.length > 0) throw new Error(`Plugin storage migration conflicts (original files retained): ${migration.conflicts.join(', ')}`)

  let providerControl: SkillProviderControl | undefined
  let userPanelControl: SkillProviderControl | undefined
  // Host runtime copy resolves from the harness `locale.preference` setting;
  // the async settings read lands before the first session starts in practice.
  const hostLocale: { t: HostTranslate } = { t: bindHostLocale(undefined) }
  void loadHostLocale().then(locale => {
    hostLocale.t = locale.t
    providerControl?.invalidate()
    userPanelControl?.invalidate()
  })

  const runtime = new RuntimeReconciler(ctx, dataRoot, key => hostLocale.t(key))

  // User panel stores (skills / commands / agent personas) and their runtime
  // contributions: one extra skill provider plus one command mount registry.
  const panels = createUserPanelStores(agentsRoot)
  const userCommands = new UserCommandMountRegistry(ctx, panels.commands, key => hostLocale.t(key))

  let disposed = false
  let projectCommands: ReturnType<typeof mountProjectCommands> | undefined
  let projectMcp: ReturnType<typeof mountProjectMcp> | undefined
  let projectHooks: ReturnType<typeof mountProjectHooks> | undefined
  let suitePrompts: ReturnType<typeof mountSuiteInstructions> | undefined

  const scheduler = new ReconcileScheduler(ctx, runtime, {
    enabledSuites: () => catalog.enabledUserSuites(),
    publishMcpDiagnostics: diagnostics => {
      catalog.mcpDiagnostics = diagnostics
    }
  })

  /** Reconcile the user command mounts and report each failure once. */
  const reconcileUserCommands = async (): Promise<void> => {
    const diagnostics = await userCommands.reconcile().catch(() => [] as string[])
    for (const reason of diagnostics) {
      ctx.logger?.warn(`[dsh-agent-plugins-market] user commands: ${reason}`)
    }
  }

  /**
   * Catalog change pipeline: invalidate the derived skill and command
   * surfaces, refresh the project mounts, then reconcile every runtime mount.
   */
  const onChanged = async (): Promise<void> => {
    if (disposed) return
    providerControl?.invalidate()
    userPanelControl?.invalidate()
    await projectCommands?.refresh()
    await suitePrompts?.refresh()
    await Promise.all([projectMcp?.refresh(), projectHooks?.refresh()])
    await reconcileUserCommands()
    await scheduler.request()
  }

  // Background source updates: off until the settings switch says otherwise.
  const autoUpdate = new SourceAutoUpdater(ctx, () => catalog.refreshSource())

  const settings = new MarketSettingsNamespace(ctx, dataRoot, hostLocale, {
    setScanProjectLayouts: enabled => catalog.setScanProjectLayouts(enabled),
    refreshMcpMounts: () => {
      void Promise.all([scheduler.request(), projectMcp?.refresh()]).catch(() => {})
    },
    setAutoUpdateSources: enabled => autoUpdate.setEnabled(enabled)
  })

  // The credentials store powers the MCP re-authorize action (dropping a grant
  // record forces the next mount through a fresh browser authorization). Every
  // port below is read at call time: this plugin's apply may run before the
  // credentials, tools and settings services provision, and a snapshot taken
  // here would be permanently undefined even after the service is live.
  let toolsRegistry: unknown
  const ports: CatalogPortsOverride = {
    mcpToolSnapshot: () => (toolsRegistry === undefined ? [] : inspectToolRegistry(toolsRegistry)),
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
    mcpServerOwner: serverName => runtime.mcpServerOwner(serverName),
    lspStatusSource: runtime.lsp,
    mcpBackend: () => settings.backend(),
    setMcpBackend: backend => settings.setBackend(backend),
    downloadRegion: () => settings.downloadRegion()
  }

  const catalog = new Catalog({ userRoot, dataRoot, agentsRoot, onChanged, ports, ...(config.git === undefined ? {} : { git: config.git }) })
  await catalog.load()
  await catalog.mergeSources(config.sources ?? [])
  const resources = createPanelResources(catalog, panels)
  runtime.setMcpOverridesProvider(async () => catalog.allMcpOverrides(await catalog.enabledUserSuites()))
  runtime.lsp.setDirectProvider(async () => (await loadLspServers(agentsRoot)).servers)
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
      await reconcileUserCommands()
      await scheduler.request()
    })
    .catch(() => {})

  ctx.skills.registerProvider(control => {
    providerControl = control
    return new SuiteSkillProvider(catalog)
  })

  // User panel skills ride a second provider so a panel
  // edit invalidates only its own catalog contribution.
  ctx.skills.registerProvider(control => {
    userPanelControl = control
    return new UserPanelSkillProvider(panels.skills, key => hostLocale.t(key))
  })

  ctx.inject(['tools', 'llm', 'subagents', 'agents'], hostCtx => {
    hostCtx.effect(
      () =>
        mountAgentRoleTool(
          hostCtx,
          async parent => [
            ...(await resources.agents.list(true)).map(entry => ({ ...entry, title: entry.name, name: entry.id ?? entry.name })),
            ...(await projectAgentRoles(catalog, parent))
          ],
          (key, params) => hostLocale.t(key, params)
        ),
      'dsh-agent-plugins-market: agent role routing'
    )
  })

  ctx.inject(['agents'], hostCtx => {
    hostCtx.effect(() => {
      const mounted = mountProjectCommands(hostCtx, catalog, key => hostLocale.t(key))
      const mcp = mountProjectMcp(hostCtx, catalog, dataRoot)
      const hooks = mountProjectHooks(hostCtx, catalog)
      const prompts = mountSuiteInstructions(hostCtx, catalog)
      projectCommands = mounted
      projectMcp = mcp
      projectHooks = hooks
      suitePrompts = prompts
      return async () => {
        if (projectCommands === mounted) projectCommands = undefined
        if (projectMcp === mcp) projectMcp = undefined
        if (projectHooks === hooks) projectHooks = undefined
        if (suitePrompts === prompts) suitePrompts = undefined
        await Promise.all([mounted.dispose(), mcp.dispose(), hooks.dispose(), prompts.dispose()])
      }
    }, 'dsh-agent-plugins-market: project command lifecycle')
  })

  ctx.inject(['webServer', 'loader'], hostCtx => {
    hostCtx.effect(() => mountSuiteRoutes(hostCtx, catalog, resources), 'dsh-agent-plugins-market: http routes')
  })

  ctx.effect(
    () => () => {
      disposed = true
      scheduler.dispose()
      autoUpdate.dispose()
      settings.dispose()
      userCommands.disposeAll()
      void runtime.dispose()
    },
    'dsh-agent-plugins-market: lifecycle'
  )
}
