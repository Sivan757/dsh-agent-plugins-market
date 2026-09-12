/**
 * MCP use cases: the flat service inventory, per-server overrides, the direct
 * user servers, the mount-backend choice, and dropping one server's OAuth
 * grant so the next mount re-runs the browser authorization.
 *
 * Server configuration is edited through saved overrides — a suite's own
 * `mcp.json` stays source-owned and is never rewritten.
 */
import { qualifiedSuiteId } from '../catalog/paths.js'
import { isDirectory } from '../catalog/fs-probes.js'
import { discoverSuitesInSource } from '../catalog/suite-scanner.js'
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { ServerConfigPayload } from '../contracts/market.js'
import type { DiscoveredSuite, Suite } from '../model/types.js'
import { readLocalePreference } from '../runtime/host-locale.js'
import { probeHostMcpClient, type McpBackend } from '../runtime/mcp-backend.js'
import { loadLspServers, saveLspServers } from '../runtime/lsp-direct-config.js'
import { addUserMcpServer, loadUserMcpSuite, USER_MCP_SOURCE, USER_MCP_SUITE } from '../runtime/mcp-direct-config.js'
import type { McpMountDiagnostic } from '../runtime/mcp-mounts.js'
import { applyOverride, loadSuiteOverrides, mergeOverridePatch, saveSuiteOverrides, type McpServerOverride, type McpSuiteOverrides } from '../runtime/mcp-overrides.js'
import { redactMcpConfig, redactMcpOverrides } from '../runtime/mcp-redaction.js'
import { buildMcpStatus } from '../runtime/mcp-status.js'
import { resolveRegion } from '../runtime/regions.js'
import { applyLspOverrides, lspConfig, restoreRedactedConfig, saveLspOverride, validateServerLsp, validateServerMcp } from '../runtime/server-config.js'
import type { CatalogContext } from './catalog-context.js'
import type { CatalogPorts, McpBackendInfo } from './ports.js'
import type { SourceStore } from './source-store.js'

export class McpService {
  /** Latest MCP mount diagnostics (suiteId -> reasons), fed by host reconcile. */
  diagnostics: McpMountDiagnostic[] = []

  constructor(
    private readonly context: CatalogContext,
    private readonly ports: CatalogPorts,
    private readonly sources: SourceStore
  ) {}

  /** Build the flat MCP service inventory for the status surface. */
  async status(): Promise<McpStatusPayload> {
    const snapshot = await this.context.snapshots.readUserCatalog()
    const suites = [...snapshot.suites, await loadUserMcpSuite(this.context.agentsRoot)]
    const payload = buildMcpStatus(suites, this.diagnostics, this.ports.mcpToolSnapshot(), await this.allOverrides(suites))
    for (const entry of payload.entries)
      if (entry.suiteId === `${USER_MCP_SOURCE}/${USER_MCP_SUITE}`) {
        entry.kind = 'direct'
        entry.managed = true
      }
    const oauthBackend = (await this.backend()) === 'builtin' && this.reauthorizeAvailable()
    for (const entry of payload.entries) {
      const auth = entry.config?.auth as { enabled?: boolean } | undefined
      entry.canReauthorize =
        oauthBackend &&
        (entry.kind === 'plugin' || entry.managed === true) &&
        (entry.transport === 'sse' || entry.transport === 'streamable-http') &&
        auth?.enabled !== false &&
        !['disabled', 'foreign', 'orphaned'].includes(entry.state)
    }
    return payload
  }

  /** Persist a user-owned MCP service and reconcile its bridge mount. */
  async addServer(name: string, server: unknown): Promise<void> {
    return this.context.enqueue(async () => {
      await addUserMcpServer(this.context.agentsRoot, name, server)
      await this.context.notifyChanged(true)
    })
  }

  /** Read effective service configuration without exposing credential literals. */
  async serverConfig(kind: 'mcp' | 'lsp', id: string): Promise<ServerConfigPayload> {
    const config = await this.resolveServerConfig(kind, id)
    return { kind, id, editable: true, config: redactMcpConfig(config.value) as Record<string, unknown> }
  }

  /** Validate a complete replacement before writing; plugin checkouts remain untouched. */
  async saveServerConfig(kind: 'mcp' | 'lsp', id: string, config: unknown): Promise<void> {
    return this.context.enqueue(async () => {
      const current = await this.resolveServerConfig(kind, id)
      const value = restoreRedactedConfig(config, current.value)
      if (kind === 'mcp') {
        const server = await validateServerMcp(current.root, current.key, value)
        const overrides = await loadSuiteOverrides(this.context.dataRoot, current.suiteKey)
        const enabled = overrides[current.key]?.enabled
        overrides[current.key] = { config: server, ...(enabled === undefined ? {} : { enabled }) }
        await saveSuiteOverrides(this.context.dataRoot, current.suiteKey, overrides)
      } else {
        const server = validateServerLsp(current.key, value)
        if (current.suiteKey === 'direct') {
          const direct = await loadLspServers(this.context.agentsRoot)
          if (direct.errors.length > 0) throw new Error(direct.errors.join('; '))
          direct.servers[current.key] = server
          await saveLspServers(this.context.agentsRoot, { lspServers: Object.fromEntries(Object.entries(direct.servers).map(([key, spec]) => [key, lspConfig(spec)])) })
        } else await saveLspOverride(this.context.dataRoot, id, server)
      }
      await this.context.notifyChanged(true)
    })
  }

  /** One suite's persisted MCP overrides, addressed by qualified suite id. */
  async overrides(sourceId: string, suiteId: string): Promise<McpSuiteOverrides> {
    const suiteKey = qualifiedSuiteId(sourceId, suiteId)
    const snapshot = await this.context.snapshots.readUserCatalog()
    if (!snapshot.suites.some(suite => suite.sourceId === sourceId && suite.id === suiteId)) throw new Error(`suite "${suiteKey}" not found`)
    return redactMcpOverrides(await loadSuiteOverrides(this.context.dataRoot, suiteKey))
  }

  /**
   * Set or clear one server's MCP override and remount it. `override === null`
   * clears the override (back to the source config). The serverKey must exist
   * in the suite's parsed mcp.json.
   */
  async setOverride(sourceId: string, suiteId: string, serverKey: string, override: McpServerOverride | null): Promise<void> {
    return this.context.enqueue(async () => {
      const suiteKey = qualifiedSuiteId(sourceId, suiteId)
      const source = this.context.state.sources.find(entry => entry.id === sourceId)
      // Only the suite's declared servers matter here, and one branch reads
      // freshly scanned suites — the scan shape covers both.
      let suites: DiscoveredSuite[]
      if (sourceId === USER_MCP_SOURCE && suiteId === USER_MCP_SUITE) {
        suites = [await loadUserMcpSuite(this.context.agentsRoot)]
      } else {
        if (source === undefined) throw new Error(`unknown source "${sourceId}"`)
        const checkout = this.sources.checkoutPath(source)
        if (!(await isDirectory(checkout))) await this.sources.acquire(source)
        suites = await discoverSuitesInSource(checkout, sourceId, 'user', source.url)
      }
      const suite = suites.find(entry => entry.id === suiteId)
      if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
      if (suite.mcp?.servers[serverKey] === undefined) throw new Error(`server "${serverKey}" is not defined by suite "${suiteId}"`)
      // Override files are keyed by the qualified id so two sources' same-named
      // suites never share one override record.
      const overrides = await loadSuiteOverrides(this.context.dataRoot, suiteKey)
      if (override === null) {
        delete overrides[serverKey]
      } else {
        // Merge onto the stored record: the UI never receives literal secret
        // values, so a verbatim write would drop keys it simply redacted.
        overrides[serverKey] = mergeOverridePatch(overrides[serverKey] ?? {}, override)
      }
      await saveSuiteOverrides(this.context.dataRoot, suiteKey, overrides)
      await this.context.notifyChanged(true)
    })
  }

  /**
   * Re-run the MCP reconcile pass: retries failed mounts and clears residual
   * tools, without changing any catalog state.
   */
  async retryMounts(): Promise<void> {
    await this.context.notifyChanged(true)
  }

  /** The persisted backend choice without the host-client probe (mount-time provider). */
  async backend(): Promise<McpBackend> {
    return this.ports.mcpBackend()
  }

  /**
   * The active MCP mount backend plus a live probe of the host client, and
   * the download-region setting with its locale-resolved effective route —
   * everything the plugin-config card renders.
   */
  async backendInfo(): Promise<McpBackendInfo> {
    const [backend, hostClient, regionSetting, locale] = await Promise.all([this.ports.mcpBackend(), probeHostMcpClient(), this.ports.downloadRegion(), readLocalePreference()])
    return { backend, hostClient, downloadRegion: { setting: regionSetting, effective: resolveRegion(regionSetting, locale) } }
  }

  /**
   * Switch the MCP mount backend and remount every suite server through it.
   * A host-client switch takes effect only where the host package resolves;
   * unresolvable or unsupported transports surface as per-server diagnostics.
   */
  async setBackend(backend: McpBackend): Promise<void> {
    return this.context.enqueue(async () => {
      await this.ports.setMcpBackend(backend)
      await this.context.notifyChanged(true)
    })
  }

  /**
   * Drop one MCP server's OAuth grant record so the next mount re-runs the
   * browser authorization — the path for "I picked too narrow a scope".
   * @param serverName - the derived serverName whose folded form keys the record.
   * @throws when the credentials service is not mounted.
   */
  async reauthorize(serverName: string): Promise<void> {
    return this.context.enqueue(async () => {
      await this.ports.credentialsStore?.deleteGrantRecord(serverName)
      // Dropping a grant changes no resolved config field, so a fingerprint
      // reconcile would keep the live bridge — with its in-memory tokens —
      // untouched. The serverName maps back to exactly one mount key (the
      // registry reserved the name), so flag it for an explicit rebuild.
      const key = this.ports.mcpServerOwner(serverName)
      if (key !== undefined) this.ports.mcpRemount(key.suiteId, key.serverKey)
      await this.context.notifyChanged(true)
    })
  }

  /** Whether the re-authorize action can run in this composition. */
  reauthorizeAvailable(): boolean {
    return this.ports.credentialsStore !== undefined
  }

  /** MCP overrides for a supplied runtime selection, or the full market catalog when omitted. */
  async allOverrides(suites?: readonly Suite[]): Promise<Map<string, McpSuiteOverrides>> {
    const map = new Map<string, McpSuiteOverrides>()
    for (const suite of suites ?? (await this.context.snapshots.readUserCatalog()).suites) {
      const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
      const overrides = await loadSuiteOverrides(this.context.dataRoot, suiteKey)
      if (Object.keys(overrides).length > 0) map.set(suiteKey, overrides)
    }
    return map
  }

  /** Resolve one editable server: its key, owning suite, root, and effective config. */
  private async resolveServerConfig(kind: 'mcp' | 'lsp', id: string) {
    if (kind === 'lsp' && id.startsWith('direct/')) {
      const key = id.slice(7)
      const server = (await loadLspServers(this.context.agentsRoot)).servers[key]
      if (server === undefined) throw new Error('LSP server not found')
      return { key, suiteKey: 'direct', root: this.context.agentsRoot, value: lspConfig(server) }
    }
    const suites = [...(await this.context.snapshots.readUserCatalog()).suites, await loadUserMcpSuite(this.context.agentsRoot)]
    for (const suite of await applyLspOverrides(this.context.dataRoot, suites)) {
      const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
      if (kind === 'mcp') {
        for (const [key, server] of Object.entries(suite.mcp?.servers ?? {})) {
          if (id !== `plugin:${suiteKey}/${key}`) continue
          const overrides = await loadSuiteOverrides(this.context.dataRoot, suiteKey)
          return { key, suiteKey, root: suite.root, value: { ...applyOverride(server, overrides[key]) } }
        }
      } else {
        for (const [key, server] of Object.entries(suite.lsp?.servers ?? {})) {
          if (id === `${suiteKey}/${key}`) return { key, suiteKey, root: suite.root, value: lspConfig(server) }
        }
      }
    }
    throw new Error('service configuration is not managed by this plugin')
  }
}
