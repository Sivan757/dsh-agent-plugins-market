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
import type { McpStatusPayload } from './mcp/mcp-status.js'
import type { ServerConfigPayload, ServerPolicyPayload } from '../contracts/market.js'
import type { DiscoveredSuite, Suite } from '../model/types.js'
import type { McpBackend } from '../contracts/mcp.js'
import { probeHostMcpClient } from './mcp/mcp-backend.js'
import { declaredMcpPolicy, namespaceMcpPolicy, resolveMcpPolicy, type ResolvedMcpPolicy } from './mcp/mcp-config.js'
import { loadLspServers, saveLspServers } from './lsp/lsp-direct-config.js'
import { addUserMcpServer, importUserMcpServers, loadUserMcpSuite, USER_MCP_SOURCE, USER_MCP_SUITE, type McpImportEntry, type McpImportResult } from './mcp/mcp-direct-config.js'
import type { McpMountDiagnostic } from '../contracts/mcp.js'
import {
  applyOverride,
  loadSuiteOverrides,
  mergeOverridePatch,
  parseMcpPolicyPatch,
  saveSuiteOverrides,
  withoutPolicyFields,
  type McpPolicyPatch,
  type McpServerOverride,
  type McpSuiteOverrides
} from './mcp/mcp-overrides.js'
import { redactMcpConfig, redactMcpOverrides } from './mcp/mcp-redaction.js'
import { buildMcpStatus } from './mcp/mcp-status.js'
import { resolveRegion } from './regions.js'
import { applyLspOverrides, lspConfig, restoreRedactedConfig, saveLspOverride, validateServerLsp, validateServerMcp } from './server-config.js'
import type { CatalogContext } from './catalog-context.js'
import type { CatalogPorts, McpBackendInfo } from './ports.js'
import type { SourceStore } from './source-store.js'

/** The host compatibility client mounts servers without a startup timeout or tool filters. */
const HOST_STARTUP_TIMEOUT_UNSUPPORTED = 'the host MCP backend cannot enforce a startup timeout; switch the MCP backend to the built-in client to set one'
const HOST_TOOL_FILTER_UNSUPPORTED = 'the host MCP backend cannot enforce tool filters; switch the MCP backend to the built-in client to choose tools'

/** One resolved service configuration plus the MCP policy behind it. */
interface ResolvedServerConfig {
  key: string
  suiteKey: string
  root: string
  value: Record<string, unknown>
  policy?: ResolvedMcpPolicy
  /** The user's stored override, carrying the layers the resolved policy merges away. */
  override?: McpServerOverride
  /** The namespace's OAuth opt-in, when the suite declares one. */
  declaredAuth?: boolean
}

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
    const backend = await this.backend()
    payload.backend = backend
    const oauthBackend = backend === 'builtin' && this.reauthorizeAvailable()
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

  /**
   * Import several pasted services in one write. Each entry is checked on its
   * own and reports back with its own outcome, so a paste of many services
   * never fails as a block.
   */
  async importServers(servers: unknown, overwrite: boolean): Promise<McpImportResult> {
    if (!Array.isArray(servers)) throw new Error('servers must be an array')
    const entries: McpImportEntry[] = servers.map(entry => {
      if (typeof entry !== 'object' || entry === null) throw new Error('each server must be an object')
      const { name, config } = entry as { name?: unknown; config?: unknown }
      if (typeof name !== 'string' || name === '') throw new Error('each server needs a name')
      return { name, server: config }
    })
    return this.context.enqueue(async () => {
      const result = await importUserMcpServers(this.context.agentsRoot, entries, overwrite)
      if (result.imported.length > 0) await this.context.notifyChanged(true)
      return result
    })
  }

  /** Read effective service configuration without exposing credential literals. */
  async serverConfig(kind: 'mcp' | 'lsp', id: string): Promise<ServerConfigPayload> {
    const config = await this.resolveServerConfig(kind, id)
    const payload: ServerConfigPayload = { kind, id, key: config.key, editable: true, config: redactMcpConfig(config.value) as Record<string, unknown> }
    if (kind === 'mcp') {
      payload.backend = await this.backend()
      if (config.policy !== undefined) payload.policy = serverPolicyPayload(config.policy, config.override, config.declaredAuth)
    }
    return payload
  }

  /**
   * Validate a complete replacement before writing; plugin checkouts remain
   * untouched. `policy` carries what the portable document has no seat for —
   * the two timeouts, the user's tool denials and the OAuth opt-in; an absent
   * field keeps its stored value, `null` clears it.
   */
  async saveServerConfig(kind: 'mcp' | 'lsp', id: string, config: unknown, policy?: unknown): Promise<void> {
    return this.context.enqueue(async () => {
      const current = await this.resolveServerConfig(kind, id)
      const value = restoreRedactedConfig(config, current.value)
      if (kind === 'mcp') {
        const backend = await this.backend()
        const patch = parseMcpPolicyPatch(policy)
        if (backend === 'host' && patch.startupTimeoutMs !== undefined && patch.startupTimeoutMs !== null) throw new Error(HOST_STARTUP_TIMEOUT_UNSUPPORTED)
        if (backend === 'host' && patch.disabledTools !== undefined) throw new Error(HOST_TOOL_FILTER_UNSUPPORTED)
        const server = await validateServerMcp(current.root, current.key, value, { userOwned: isUserOwnedMcp(current.suiteKey) })
        const overrides = await loadSuiteOverrides(this.context.dataRoot, current.suiteKey)
        const existing = overrides[current.key] ?? {}
        // The complete configuration already carries every connection input, so
        // a leftover url/headers/env/args field would shadow what was just
        // saved. Enablement and the policy fields the save did not touch survive.
        const next: McpServerOverride = { config: server }
        if (existing.enabled !== undefined) next.enabled = existing.enabled
        applyAuth(next, patch.auth, existing.auth)
        applyToolList(next, patch.disabledTools, existing.disabledTools)
        applyTimeout(next, 'toolCallTimeoutMs', patch.toolCallTimeoutMs, existing.toolCallTimeoutMs)
        applyTimeout(next, 'startupTimeoutMs', patch.startupTimeoutMs, existing.startupTimeoutMs)
        overrides[current.key] = next
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
    if (override !== null && (override.startupTimeoutMs !== undefined || override.disabledTools !== undefined) && (await this.backend()) === 'host')
      throw new Error(override.startupTimeoutMs !== undefined ? HOST_STARTUP_TIMEOUT_UNSUPPORTED : HOST_TOOL_FILTER_UNSUPPORTED)
    // Merge onto the stored record: the UI never receives literal secret
    // values, so a verbatim write would drop keys it simply redacted.
    await this.updateServerOverride(sourceId, suiteId, serverKey, current => (override === null ? null : mergeOverridePatch(current ?? {}, override)))
  }

  /**
   * Enable or disable one declared server, addressed by the source-qualified
   * suite id the status rows carry. The qualified id is split here rather than
   * by callers so the separator stays a server-side detail.
   */
  async setServerEnabled(suiteKey: string, serverKey: string, enabled: boolean): Promise<void> {
    const { sourceId, suiteId } = splitSuiteKey(suiteKey)
    await this.setOverride(sourceId, suiteId, serverKey, { enabled })
  }

  /**
   * Allow or deny one tool of a declared server, addressed by the
   * source-qualified suite id the status rows carry. The stored record lists
   * only the tools the user turned off, so a server with nothing denied
   * carries no tool field at all.
   */
  async setServerToolEnabled(suiteKey: string, serverKey: string, tool: string, enabled: boolean): Promise<void> {
    const { sourceId, suiteId } = splitSuiteKey(suiteKey)
    if (tool === '') throw new Error('tool name is required')
    if ((await this.backend()) === 'host') throw new Error(HOST_TOOL_FILTER_UNSUPPORTED)
    await this.updateServerOverride(sourceId, suiteId, serverKey, current => {
      const denied = new Set(current?.disabledTools ?? [])
      if (enabled) denied.delete(tool)
      else denied.add(tool)
      const next: McpServerOverride = { ...(current ?? {}) }
      if (denied.size === 0) delete next.disabledTools
      else next.disabledTools = [...denied]
      return Object.keys(next).length === 0 ? null : next
    })
  }

  /**
   * Rewrite one declared server's override record and remount it. The mutate
   * callback receives the stored record — absent when none is persisted — and
   * returns the replacement, or `null` to drop the record entirely.
   */
  private async updateServerOverride(
    sourceId: string,
    suiteId: string,
    serverKey: string,
    mutate: (current: McpServerOverride | undefined) => McpServerOverride | null
  ): Promise<void> {
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
      const next = mutate(overrides[serverKey])
      if (next === null) delete overrides[serverKey]
      else overrides[serverKey] = next
      await saveSuiteOverrides(this.context.dataRoot, suiteKey, overrides)
      await this.context.notifyChanged(true)
      // The status surface reads the live tool registry, so an immediate read
      // races the reconciler's teardown: a just-disabled server still carries
      // its observed tools and reports the orphaned state with its switch on
      // until the pass finishes. Joining the pass here is bounded — one stuck
      // mount costs the request its deadline, never the plugin.
      await this.context.refreshSettled()
    })
  }

  /**
   * Re-run the MCP reconcile pass: retries failed mounts and clears residual
   * tools, without changing any catalog state.
   *
   * Every live mount is rebuilt rather than fingerprinted: a bridge whose
   * server died underneath it keeps matching its own resolved config, so a
   * retry is the only path that re-verifies a mount that looks connected. The
   * wait is bounded — the pass keeps running, so a slow server reports its
   * outcome to the status surface instead of holding the request open.
   */
  async retryMounts(): Promise<void> {
    this.ports.mcpRemountAll()
    await this.context.notifyChanged(true)
    await this.context.refreshSettled()
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
    const [backend, hostClient, regionSetting] = await Promise.all([this.ports.mcpBackend(), probeHostMcpClient(), this.ports.downloadRegion()])
    return { backend, hostClient, downloadRegion: { setting: regionSetting, effective: resolveRegion(regionSetting, this.ports.localePreference()) } }
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

  /**
   * Resolve one editable server: its key, owning suite, root, and the service
   * document the editor renders. An MCP document carries the portable shape
   * only; the client policy behind it rides `policy`.
   */
  private async resolveServerConfig(kind: 'mcp' | 'lsp', id: string): Promise<ResolvedServerConfig> {
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
          const override = (await loadSuiteOverrides(this.context.dataRoot, suiteKey))[key]
          const declared = namespaceMcpPolicy(suite, key)
          return {
            key,
            suiteKey,
            root: suite.root,
            value: { ...withoutPolicyFields(applyOverride(server, override)) },
            policy: resolveMcpPolicy(declaredMcpPolicy(server, declared), override),
            ...(override === undefined ? {} : { override }),
            ...(declared?.auth?.enabled === undefined ? {} : { declaredAuth: declared.auth.enabled })
          }
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

/** Split one source-qualified suite id; the separator stays a server-side detail. */
function splitSuiteKey(suiteKey: string): { sourceId: string; suiteId: string } {
  const separator = suiteKey.indexOf('/')
  if (separator <= 0) throw new Error(`invalid suite id "${suiteKey}"`)
  return { sourceId: suiteKey.slice(0, separator), suiteId: suiteKey.slice(separator + 1) }
}

/** Project one resolved policy onto the wire shape the editor renders. */
function serverPolicyPayload(policy: ResolvedMcpPolicy, override: McpServerOverride | undefined, declaredAuth: boolean | undefined): ServerPolicyPayload {
  const userDenied = override?.disabledTools ?? null
  const userAuth = override?.auth?.enabled ?? null
  const suiteAuth = declaredAuth ?? null
  return {
    toolCallTimeout: policy.toolCallTimeout,
    startupTimeout: policy.startupTimeout,
    deniedTools: { user: userDenied, suite: policy.suiteDisabledTools ?? null, effective: policy.disabledTools ?? [] },
    auth: { user: userAuth, suite: suiteAuth, effective: userAuth ?? suiteAuth ?? true }
  }
}

/** The user-owned MCP declaration suite: its file is local data, not a package. */
function isUserOwnedMcp(suiteKey: string): boolean {
  return suiteKey === `${USER_MCP_SOURCE}/${USER_MCP_SUITE}`
}

/** Write the OAuth opt-in from a save: absent keeps the stored value, `null` clears it. */
function applyAuth(target: McpServerOverride, patch: McpPolicyPatch['auth'], stored: McpServerOverride['auth']): void {
  if (patch === undefined) {
    if (stored !== undefined) target.auth = stored
    return
  }
  if (patch !== null) target.auth = patch
}

/** Write the user's deny list: absent keeps it, `null` clears it, entries replace it. */
function applyToolList(target: McpServerOverride, patch: string[] | null | undefined, stored: string[] | undefined): void {
  if (patch === undefined) {
    if (stored !== undefined) target.disabledTools = stored
    return
  }
  if (patch !== null && patch.length > 0) target.disabledTools = patch
}

/** Write one timeout from a save: absent keeps the stored value, `null` clears it, a number sets it. */
function applyTimeout(target: McpServerOverride, field: 'toolCallTimeoutMs' | 'startupTimeoutMs', patch: number | null | undefined, stored: number | undefined): void {
  if (patch === undefined) {
    if (stored !== undefined) target[field] = stored
    return
  }
  if (patch !== null) target[field] = patch
}
