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
import { RuntimeReconciler } from './runtime/reconciler.js'
import { inspectToolRegistry } from './runtime/tool-registry-observer.js'
import { migrateLegacyDataRoot } from './catalog/legacy-root-migration.js'
import { resolveDataRoot, resolveDshHome, resolveUserRoot } from './catalog/paths.js'
import { join } from 'node:path'
import { mountSuiteRoutes } from './routes.js'
import { MCP_SETTINGS_NAMESPACE, McpEnhancedSettingsSchema, readMcpBackend } from './runtime/mcp-backend.js'
import { SuiteSkillProvider } from './runtime/skills-provider.js'
import { loadLspServers } from './runtime/lsp-direct-config.js'
import { bindHostLocale, loadHostLocale, type HostTranslate } from './runtime/host-locale.js'
import type { SourceRef } from './model/types.js'

export const name = 'dsh-agent-plugins-market'
export const inject = ['skills', 'commands']

/** Host configuration. */
export interface Config {
  /** User-dimension suite root; defaults to `~/.dsh/agent-plugins` (`$DSH_HOME/agent-plugins`). */
  userRoot?: string
  /** Per-suite data root backing `${PLUGIN_DATA}` and MCP overrides; defaults to `<userRoot>/data`. */
  dataRoot?: string
  /** Initial repository sources, merged into the persisted state on first load. */
  sources?: SourceRef[]
}

export function apply(ctx: Context, config: Config = {}): void {
  const userRoot = resolveUserRoot(config.userRoot)
  const dataRoot = resolveDataRoot(config.dataRoot, userRoot)
  // The pre-0.5.4 layout kept a sibling `agent-plugins-data` root; fold it in.
  void migrateLegacyDataRoot(join(resolveDshHome(), 'agent-plugins-data'), dataRoot).catch(error => {
    ctx.logger?.warn?.(`[dsh-agent-plugins-market] legacy data-root migration failed: ${String(error)}`)
  })
  let providerControl: SkillProviderControl | undefined
  // Host runtime copy resolves from the harness `locale.preference` setting;
  // the async settings read lands before the first session starts in practice.
  const t = bindHostLocale(undefined)
  void loadHostLocale().then(locale => {
    hostLocale.t = locale.t
    providerControl?.invalidate()
  })
  const hostLocale: { t: HostTranslate } = { t }
  const runtime = new RuntimeReconciler(ctx, dataRoot, key => hostLocale.t(key))

  const reconcileMounts = async (): Promise<void> => {
    try {
      const snapshot = await catalog.readUserCatalog()
      const diagnostics = await runtime.reconcile(snapshot.enabledSuites)
      catalog.mcpDiagnostics = diagnostics.mcp
      for (const diagnostic of diagnostics.mcp) {
        ctx.logger?.warn(`[dsh-agent-plugins-market] suite "${diagnostic.suiteId}" mcp server "${diagnostic.serverKey}": ${diagnostic.reason}`)
      }
      for (const diagnostic of diagnostics.lsp) {
        ctx.logger?.warn(`[dsh-agent-plugins-market] suite "${diagnostic.suiteId}" lsp server "${diagnostic.serverKey}": ${diagnostic.reason}`)
      }
      for (const diagnostic of diagnostics.commands) {
        if (diagnostic.reason !== '') ctx.logger?.warn(`[dsh-agent-plugins-market] suite "${diagnostic.suiteId}" command "${diagnostic.command}": ${diagnostic.reason}`)
      }
      for (const diagnostic of diagnostics.hooks) {
        ctx.logger?.warn(`[dsh-agent-plugins-market] suite "${diagnostic.suiteId}" hooks: ${diagnostic.reason}`)
      }
      for (const error of diagnostics.errors) {
        ctx.logger?.warn(`[dsh-agent-plugins-market] ${error.surface} reconcile failed: ${error.reason}`)
      }
    } catch (error) {
      ctx.logger?.warn(`[dsh-agent-plugins-market] runtime reconcile failed: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  /**
   * Coalesce credential updates.
   *
   * `runtime.usesCredential(ref)` reflects the last completed pass, so an event
   * arriving while the first reconcile is still running would be filtered out
   * and the remount lost. Pending refs are therefore kept until the next pass
   * observes them, and bursts are collapsed into one reconcile.
   */
  const pendingCredentialRefs = new Set<string>()
  let credentialFlush: ReturnType<typeof setTimeout> | undefined
  const flushCredentialUpdates = (): void => {
    credentialFlush = undefined
    const refs = [...pendingCredentialRefs]
    pendingCredentialRefs.clear()
    // Re-read the catalog first: an unknown ref means the snapshot predates
    // this change, so reconcile anyway to refresh the known reference set.
    void reconcileMounts().catch(() => {})
    if (refs.length > 0) {
      ctx.logger?.info?.(`[dsh-agent-plugins-market] reconciling after credential update: ${refs.join(', ')}`)
    }
  }

  const onChanged = async (): Promise<void> => {
    providerControl?.invalidate()
    await reconcileMounts()
  }

  // The credential store powers the MCP re-authorize action (dropping a grant
  // record forces the next mount through a fresh browser authorization).
  // Resolved lazily at call time: this plugin's apply may run before the
  // credentials plugin provisions, and a snapshot taken here would be
  // permanently undefined even after the service is live.
  const catalog = new Catalog({ userRoot, dataRoot, onChanged })
  // Mirror oauth.ts's `credentialIdFor`: the record is stored under the folded
  // serverName, so the delete must fold the same way or it misses the record.
  const credentialIdFor = (serverName: string): string =>
    serverName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'server'
  catalog.setCredentialsStore({
    deleteGrantRecord: async serverName => {
      const store = (ctx as unknown as { get?: (name: string) => unknown }).get?.('credentials') as { deleteRecord?: (key: string) => Promise<void> } | undefined
      if (store?.deleteRecord === undefined) throw new Error('credentials service is not mounted')
      await store.deleteRecord(`mcp-auth/${credentialIdFor(serverName)}` as never)
    }
  })
  runtime.setMcpOverridesProvider(() => catalog.allMcpOverrides())
  catalog.setLspStatusSource(runtime.lsp)
  runtime.lsp.setDirectProvider(async () => (await loadLspServers(dataRoot)).servers)
  // The MCP backend choice is a host settings namespace (the registration is
  // also what makes the plugin-config tab serve our card). The node half owns
  // it: the provider derives the mount backend from the scope, the writer
  // flips the switch, and the watcher remounts servers when it flips.
  ctx.inject(['settings'], settingsCtx => {
    const settings = (
      settingsCtx as unknown as {
        settings: {
          register<T>(
            ns: string,
            schema: unknown,
            options?: { base?: T }
          ): {
            get(): T
            watch(callback: () => void): () => void
            update(patch: Partial<T>): Promise<void>
          }
        }
      }
    ).settings
    const scope = settings.register(MCP_SETTINGS_NAMESPACE, McpEnhancedSettingsSchema, { base: { mcpEnhanced: true } })
    catalog.setMcpBackendProvider(async () => (scope.get().mcpEnhanced === false ? 'host' : 'builtin'))
    catalog.setMcpBackendWriter(async backend => {
      await scope.update({ mcpEnhanced: backend !== 'host' })
    })
    // One-time migration from the earlier data-root settings.json choice.
    void readMcpBackend(dataRoot).then(backend => {
      if (backend === 'host') void scope.update({ mcpEnhanced: false }).catch(() => {})
    })
    scope.watch(() => {
      void reconcileMounts().catch(() => {})
    })
  })
  runtime.setMcpBackendProvider(() => catalog.mcpBackend())
  const eventHost = ctx as unknown as { on?: (event: string, listener: (ref: string) => void) => () => void }
  const disposeCredentialUpdates =
    eventHost.on?.('credentials/reference-updated', ref => {
      pendingCredentialRefs.add(ref)
      if (credentialFlush !== undefined) clearTimeout(credentialFlush)
      credentialFlush = setTimeout(flushCredentialUpdates, 150)
      credentialFlush.unref?.()
    }) ?? (() => {})
  ctx.inject(['tools'], toolsCtx => {
    const registry = (toolsCtx as unknown as { tools: unknown }).tools
    catalog.setMcpToolSnapshotProvider(() => inspectToolRegistry(registry))
    // Foreign-namespace guard: a native host MCP client (or another plugin)
    // owning `mcp__<serverName>__` names makes the mount registry skip its
    // own server with a clear diagnostic instead of failing mid-registration.
    runtime.setMcpToolNamesProvider(() => inspectToolRegistry(registry).map(tool => tool.name))
  })
  void catalog
    .load()
    .then(async () => {
      await catalog.mergeSources(config.sources ?? [])
      await reconcileMounts()
    })
    .catch(() => {})

  ctx.skills.registerProvider(control => {
    providerControl = control
    return new SuiteSkillProvider(catalog, key => hostLocale.t(key))
  })

  ctx.inject(['webServer', 'loader'], hostCtx => {
    hostCtx.effect(() => mountSuiteRoutes(hostCtx, catalog), 'dsh-agent-plugins-market: http routes')
  })

  ctx.effect(
    () => () => {
      disposeCredentialUpdates()
      if (credentialFlush !== undefined) clearTimeout(credentialFlush)
      credentialFlush = undefined
      pendingCredentialRefs.clear()
      void runtime.dispose()
    },
    'dsh-agent-plugins-market: lifecycle'
  )
}
