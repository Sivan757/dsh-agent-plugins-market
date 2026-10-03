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
import { type Context, type Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cosmokit'
import type { SkillProviderControl } from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'
import { MarketSettingsFields } from './application/mcp/mcp-backend.js'
import type { DownloadRegionSetting } from './contracts/settings.js'
import { Catalog } from './application/catalog.js'
import type { CatalogPortsOverride } from './application/ports.js'
import { settlesWithin } from './application/deadline.js'
import { RuntimeReconciler } from './runtime/core/reconciler.js'
import { ReconcileScheduler } from './runtime/core/reconcile-scheduler.js'
import { MarketSettingsNamespace } from './runtime/host/settings-namespace.js'
import { SurfaceToggleService } from './runtime/host/surface-toggle-service.js'
import { deleteMcpAuthGrant } from './runtime/mcp/mcp-auth-record.js'
import { inspectToolRegistry, toolsServiceOf } from './runtime/host/tool-registry-observer.js'
import { createDescriptionTranslator } from './runtime/host/description-translator.js'
import { migratePluginStorage } from './application/state/storage-migration.js'
import { mountAgentRoleTool } from './runtime/agents/agent-role-router.js'
import { mountUnlessAgentTeams } from './runtime/agents/agent-teams-seat.js'
import { mountTeammateRoleTool } from './runtime/agents/teammate-role-tool.js'
import { projectAgentRoles } from './application/project-agent-roles.js'
import { mountProjectCommands, mountProjectMcp, mountProjectHooks, mountSuiteInstructions } from './runtime/surfaces/project-runtime.js'
import { createPanelResources } from './application/panel-resources.js'
import { resolveAgentsRoot, resolveDataRoot, resolveUserRoot } from './catalog/paths.js'
import { mountSuiteRoutes } from './routes.js'
import { mountResourceRoutes } from './routes-resources.js'
import { ResourceFilterService } from './runtime/host/resource-filter-service.js'
import { EntryFilteredSkillProvider } from './runtime/surfaces/skills-provider.js'
import { SuiteSkillProvider, ToggledSkillProvider } from './runtime/surfaces/skills-provider.js'
import { shellSeamOf, type ShellSeam } from './runtime/surfaces/dynamic-context.js'
import { loadLspServers } from './application/lsp/lsp-direct-config.js'
import { loadDisabledLspServers } from './application/lsp/lsp-server-state.js'
import {
  bindHostLocale,
  LOCALE_SETTINGS_ENTRY,
  readHostLocalePreference,
  readLocalePreference,
  setHostLocaleSource,
  type HostTranslate,
  type LocaleSettingsSource
} from './runtime/host/host-locale.js'
import { createUserPanelStores } from './runtime/panels/user-panels.js'
import { SourceAutoUpdater } from './runtime/core/source-auto-update.js'
import { UserPanelSkillProvider } from './runtime/panels/user-panels.js'
import { UserCommandMountRegistry } from './runtime/panels/user-commands.js'
import type { SourceRef } from './model/types.js'
import { presetSourceRef } from './model/preset-source.js'

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
}

/**
 * Schemastery projection the host loader reads: the five volatile fields become
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
  autoUpdateSources: MarketSettingsFields.autoUpdateSources.volatile()
})

const undefinedRef = { get: () => undefined as never }

export async function apply(
  ctx: Context,
  config: Config = { mcpEnhanced: undefinedRef, scanProjectLayouts: undefinedRef, downloadRegion: undefinedRef, feedbackEnabled: undefinedRef, autoUpdateSources: undefinedRef }
): Promise<void> {
  const userRoot = resolveUserRoot(config.userRoot)
  const dataRoot = resolveDataRoot(config.dataRoot, userRoot)
  const agentsRoot = resolveAgentsRoot()
  const migration = await migratePluginStorage(config)
  if (migration.conflicts.length > 0) throw new Error(`Plugin storage migration conflicts (original files retained): ${migration.conflicts.join(', ')}`)

  let providerControl: SkillProviderControl | undefined
  let userPanelControl: SkillProviderControl | undefined
  // Host runtime copy resolves from the harness `locale.preference` setting.
  const hostLocale: { t: HostTranslate } = { t: bindHostLocale(undefined) }
  const refreshHostLocale = (): void => {
    hostLocale.t = bindHostLocale(readLocalePreference())
    providerControl?.invalidate()
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
    // Always the full enabled set. A switched-off surface is gated inside the
    // reconciler's own mount branch, never by filtering here: MCP, commands and
    // LSP all mount from this one snapshot, so dropping a suite for one switch
    // would unmount that suite's mounts on the other two. A market-face entry
    // filter is the one deliberate exception: its row IS the suite, so denying
    // it in this workspace means the suite mounts nothing here — the same
    // semantics as the global enable switch, one workspace deep.
    enabledSuites: async () => {
      const suites = await catalog.enabledUserSuites()
      return suites.filter(suite => resourceFilters.allowsEntry('market', 'market:' + suite.sourceId + '/' + suite.id))
    },
    publishMcpDiagnostics: diagnostics => {
      catalog.mcpDiagnostics = diagnostics
    }
  })
  // Entry filters reach each contributor at its own wanted-row computation —
  // the same per-branch shape the surface switches use, so an entry off in one
  // face never touches the same suite's mounts in another.
  runtime.setMcpEntryFilter(() => resourceFilters)
  runtime.lsp.setEntryFilter(() => resourceFilters)
  runtime.setCommandsEntryFilter(() => resourceFilters)
  userCommands.setEntryFilter(() => resourceFilters)

  /** Reconcile the user command mounts and report each failure once. */
  const reconcileUserCommands = async (): Promise<void> => {
    // The switch is answered inside reconcile, not by skipping the pass: an
    // early return would leave the previous registrations mounted.
    const diagnostics = await userCommands.reconcile(surfaceToggles.allows('commands')).catch(() => [] as string[])
    for (const reason of diagnostics) {
      ctx.logger?.warn(`[dsh-agent-plugins-market] user commands: ${reason}`)
    }
  }

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
    providerControl?.invalidate()
    userPanelControl?.invalidate()
    await runStage('project commands', () => projectCommands?.refresh())
    await runStage('suite instructions', () => suitePrompts?.refresh())
    await runStage('project MCP and hooks', () => Promise.all([projectMcp?.refresh(), projectHooks?.refresh()]))
    await runStage('user commands', () => reconcileUserCommands())
    await runStage('runtime mounts', () => scheduler.request())
  }

  // Background source updates: off until the settings switch says otherwise.
  const autoUpdate = new SourceAutoUpdater(ctx, () => catalog.refreshSource())

  const settings = new MarketSettingsNamespace(ctx, config, dataRoot, hostLocale, {
    setScanProjectLayouts: enabled => catalog.setScanProjectLayouts(enabled),
    refreshMcpMounts: () => {
      void Promise.all([scheduler.request(), projectMcp?.refresh()]).catch(() => {})
    },
    setAutoUpdateSources: enabled => autoUpdate.setEnabled(enabled)
  })

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
  runtime.setSurfaceGates({ allows: surface => surfaceToggles.allows(surface) })

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
    localePreference: () => readLocalePreference() ?? 'zh',
    // Built from the live context at apply time; the translator reads the LLM
    // and default-model services per call, so a late-provisioning service is
    // still picked up. Undefined here means the market renders upstream text.
    descriptionTranslator: createDescriptionTranslator(ctx)
  }

  const catalog = new Catalog({ userRoot, dataRoot, agentsRoot, onChanged, ports, ...(config.git === undefined ? {} : { git: config.git }) })
  await catalog.load()
  // Translation needs the host model services, and those provision *after*
  // apply() returns — warming here would find them absent and do nothing. Warm
  // once they land instead, so a returning user's panel opens on translations
  // it already paid for rather than starting from upstream text again.
  ctx.inject(['llm', 'agentDefaultModel'], () => {
    void catalog.warmDescriptions()
  })
  // Configured seeds first, then the record this plugin presets: the market
  // lists the first-party collection on the first open, and the ordinary
  // refresh path clones it. Registration performs no network access.
  await catalog.mergeSources([...(config.sources ?? []), presetSourceRef()])
  const resources = createPanelResources(catalog, panels)
  runtime.setMcpOverridesProvider(async () => catalog.allMcpOverrides(await catalog.enabledUserSuites()))
  runtime.lsp.setDirectProvider(async () => {
    // An empty table is the lsp-off state: the seam stays mounted (the plugin
    // owns it unconditionally) but serves no servers.
    if (!surfaceToggles.allows('lsp')) return {}
    const { servers } = await loadLspServers(agentsRoot)
    return Object.fromEntries(Object.entries(servers).filter(([key]) => resourceFilters.allowsEntry('lsp', 'lsp:direct/' + key)))
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
      await reconcileUserCommands()
      await scheduler.request()
    })
    .catch(() => {})

  // The shell seam resolves lazily: the service may land after this plugin, and
  // a profile without one keeps dynamic-context placeholders literal.
  const shellSeam = (): ShellSeam | undefined => shellSeamOf(ctx)
  ctx.skills.registerProvider(control => {
    providerControl = control
    return new ToggledSkillProvider(
      new EntryFilteredSkillProvider(
        new SuiteSkillProvider(catalog, {
          dataRoot,
          shell: shellSeam,
          suiteAllowed: suite => resourceFilters.allowsEntry('market', 'market:' + suite.sourceId + '/' + suite.id)
        }),
        entryId => resourceFilters.allowsEntry('skills', entryId)
      ),
      () => surfaceToggles.allows('skills')
    )
  })

  // User panel skills ride a second provider so a panel
  // edit invalidates only its own catalog contribution. It answers the same
  // skills switch as the suite provider: the seat stays registered and only the
  // entries it serves collapse to none.
  ctx.skills.registerProvider(control => {
    userPanelControl = control
    return new ToggledSkillProvider(new EntryFilteredSkillProvider(new UserPanelSkillProvider(panels.skills), entryId => resourceFilters.allowsEntry('skills', entryId)), () =>
      surfaceToggles.allows('skills')
    )
  })

  // Both entry points read the same live user/project role set. Team owns the
  // enhanced entry's member identities and all subsequent collaboration.
  const listRoles = async (parent?: unknown) => {
    if (!surfaceToggles.allows('agents')) return []
    const user = (await resources.agents.list(true))
      .filter(entry => resourceFilters.allowsEntry('agents', 'agents:' + (entry.origin === 'plugin' ? (entry.id ?? entry.name) : entry.name)))
      .map(entry => ({ ...entry, title: entry.name, name: entry.id ?? entry.name }))
    const project = (await projectAgentRoles(catalog, parent)).filter(role => resourceFilters.allowsEntry('agents', 'agents:' + role.name))
    return [...user, ...project]
  }
  ctx.inject(['tools', 'llm', 'subagents', 'agents'], hostCtx => {
    hostCtx.effect(() => mountUnlessAgentTeams(hostCtx, () => mountAgentRoleTool(hostCtx, listRoles)), 'dsh-agent-plugins-market: agent role routing')
  })

  ctx.inject(['tools', 'llm', 'subagents', 'agents', 'agentTeams', 'sessions', 'sessionQuery', 'systemPrompt'], teamCtx => {
    teamCtx.effect(() => mountTeammateRoleTool(teamCtx, listRoles), 'dsh-agent-plugins-market: role teammates')
  })

  ctx.inject(['agents'], hostCtx => {
    hostCtx.effect(() => {
      const mounted = mountProjectCommands(
        hostCtx,
        catalog,
        key => hostLocale.t(key),
        dataRoot,
        () => surfaceToggles.allows('commands')
      )
      const mcp = mountProjectMcp(hostCtx, catalog, dataRoot, () => surfaceToggles.allows('mcp'))
      const hooks = mountProjectHooks(hostCtx, catalog)
      const prompts = mountSuiteInstructions(hostCtx, catalog, dataRoot, suite => resourceFilters.allowsEntry('market', 'market:' + suite.sourceId + '/' + suite.id))
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
    // With the market switch off the market routes never mount, so the panel
    // is unreachable for this workspace until the switch returns on and the
    // refresh chain remounts them. The resource-window routes stay mounted
    // either way: the window is the meta-surface that owns all six switches,
    // and taking it down with one of them would strand the user.
    hostCtx.effect(() => {
      const disposeSuite = surfaceToggles.allows('market')
        ? mountSuiteRoutes(hostCtx, catalog, resources, surfaceToggles)
        : undefined
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
      userCommands.disposeAll()
      catalog.dispose()
      void runtime.dispose()
    },
    'dsh-agent-plugins-market: lifecycle'
  )
}
