import type { McpSuiteOverrides } from './mcp-overrides.js'
import { credentialRefsInServer, effectiveMcpServers, deriveServerName } from './mcp-config.js'
import type { McpStatusEntry, McpStatusCode, McpStatusPayload, McpStatusState, McpStatusTool } from '../contracts/mcp-status.js'
import type { McpToolSnapshot } from './ports.js'
import { redactMcpConfig, redactUrl } from './mcp-redaction.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import type { McpServer, Suite } from '../model/types.js'

export type { McpStatusEntry, McpStatusPayload, McpStatusKind, McpStatusState } from '../contracts/mcp-status.js'
export type { McpToolSnapshot }

export interface McpDiagnostic {
  suiteId: string
  serverKey: string
  reason: string
  code?: McpStatusCode
  causes?: string[]
  credentialRefs?: string[]
}

/** Build status rows from discovered plugin MCP definitions and observed tool names. */
export function buildMcpStatus(
  suites: Suite[],
  diagnostics: McpDiagnostic[],
  observed: readonly McpToolSnapshot[],
  overrides: Map<string, McpSuiteOverrides> = new Map()
): McpStatusPayload {
  const entries: McpStatusEntry[] = []
  const claimedServers = new Set<string>()
  const knownServerNames = new Set<string>()
  const knownDefinitions = new Map<string, { suite: Suite; serverKey: string; server: McpServer }>()
  for (const suite of suites) {
    if (suite.mcp === undefined) continue
    for (const [serverKey, server] of Object.entries(suite.mcp.servers)) {
      // Server names and every status key are source-qualified: two sources
      // may ship the same suite id, and the inventory must not conflate them.
      const serverName = deriveServerName(suite.id, serverKey)
      knownServerNames.add(serverName)
      knownDefinitions.set(serverName, { suite, serverKey, server })
    }
  }
  const diagnosticsByKey = new Map(diagnostics.map(diagnostic => [`${diagnostic.suiteId}\u0000${diagnostic.serverKey}`, diagnostic]))
  const observedByServer = groupObservedTools(observed, knownServerNames)

  for (const suite of suites) {
    // This is an operational inventory, not a configuration audit: suite MCP
    // definitions only appear after their suite is both installed and enabled.
    if (suite.mcp === undefined || suite.installedAt === undefined || !suite.enabled) continue
    const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
    for (const { serverKey, server: effective, override, enabled, credentialRefs: refs, policy } of effectiveMcpServers(suite, overrides.get(suiteKey))) {
      const serverName = deriveServerName(suite.id, serverKey)
      const tools = observedByServer.get(serverName) ?? []
      claimedServers.add(serverName)
      const diagnostic = diagnosticsByKey.get(`${suiteKey}\u0000${serverKey}`)
      const credentialRefs = [...new Set([...refs, ...(diagnostic?.credentialRefs ?? [])])].sort()
      // The declaration stays on the inventory when an override disables it:
      // the panel shows what the suite ships and how the user changed it.
      const disabled = !enabled || suite.activeSurfaces.mcp === false
      const orphaned = disabled && tools.length > 0
      // A duplicate copy shares the live serverName, so observed tools land
      // on it too — that does not make it connected: its own diagnostic says
      // another source's mount is the one serving.
      const servedElsewhere = diagnostic?.code === 'duplicate-mount'
      const state: McpStatusState = orphaned
        ? 'orphaned'
        : diagnostic?.code === 'missing-credential'
          ? 'needs-credentials'
          : servedElsewhere || diagnostic?.code === 'foreign-mount'
            ? 'foreign'
            : diagnostic !== undefined
              ? 'failed'
              : disabled
                ? 'disabled'
                : tools.length > 0
                  ? 'connected'
                  : 'degraded'
      // A diagnostic's reason keeps the code the mount pipeline gave it. The
      // notes this builder adds describe the declaration's own state — an
      // override switched it off, an override rewrote it, or its surface is
      // gone while its tools remain — so each carries the matching state code
      // for the panel to localize.
      const orphanNote = orphaned ? 'MCP tools remain after this plugin surface was disabled' : undefined
      const overrideNote = override === undefined || (state !== 'disabled' && tools.length > 0) ? undefined : disabled ? 'disabled by override' : 'modified by override'
      const reason = orphanNote ?? diagnostic?.reason ?? overrideNote
      const code: McpStatusCode | undefined =
        orphanNote !== undefined ? 'orphaned-tools' : (diagnostic?.code ?? (overrideNote === undefined ? undefined : disabled ? 'disabled-override' : 'modified-override'))
      entries.push({
        id: `plugin:${suiteKey}/${serverKey}`,
        name: serverName,
        kind: 'plugin',
        state,
        source: suite.manifest.name,
        suiteId: suiteKey,
        serverKey,
        transport: effective.type,
        endpoint: endpointOf(effective),
        config: redactMcpConfig(effective) as Record<string, unknown>,
        tools: disabled && !orphaned ? [] : observedTools(tools),
        advertisedTools: tools.length > 0,
        retryable: diagnostic?.code === 'mount-failed' || diagnostic?.code === 'unmount-failed',
        ...(effective.type === 'stdio' || effective.auth !== undefined ? {} : { oauthDefault: true }),
        ...(policy.enabledTools === undefined ? {} : { suiteEnabledTools: policy.enabledTools }),
        ...(policy.suiteDisabledTools === undefined ? {} : { suiteDisabledTools: policy.suiteDisabledTools }),
        ...(override?.disabledTools === undefined ? {} : { userDisabledTools: override.disabledTools }),
        ...(code === undefined ? {} : { code }),
        ...(reason === undefined ? {} : { reason }),
        ...(diagnostic?.causes === undefined ? {} : { causes: diagnostic.causes }),
        ...(credentialRefs.length === 0 ? {} : { credentialRefs })
      })
    }
  }

  for (const [serverName, tools] of observedByServer) {
    if (claimedServers.has(serverName)) continue
    const stale = knownDefinitions.get(serverName)
    if (stale !== undefined) {
      const staleRefs = credentialRefsInServer(stale.server)
      const staleKey = qualifiedSuiteId(stale.suite.sourceId, stale.suite.id)
      entries.push({
        id: `orphaned:${staleKey}/${stale.serverKey}`,
        name: serverName,
        kind: 'plugin',
        state: 'orphaned',
        source: stale.suite.manifest.name,
        suiteId: staleKey,
        serverKey: stale.serverKey,
        transport: stale.server.type,
        endpoint: endpointOf(stale.server),
        config: redactMcpConfig(stale.server) as Record<string, unknown>,
        tools: observedTools(tools),
        reason: 'MCP tools remain after this plugin was disabled or uninstalled',
        code: 'orphaned-tools',
        ...(staleRefs.length === 0 ? {} : { credentialRefs: staleRefs })
      })
      continue
    }
    entries.push({
      id: `direct:${serverName}`,
      name: serverName,
      kind: 'direct',
      state: 'connected',
      transport: 'observed',
      tools: observedTools(tools)
    })
  }

  const totals = {
    all: entries.length,
    connected: entries.filter(entry => entry.state === 'connected').length,
    degraded: entries.filter(entry => entry.state === 'degraded').length,
    failed: entries.filter(entry => entry.state === 'failed').length,
    needsCredentials: entries.filter(entry => entry.state === 'needs-credentials').length,
    orphaned: entries.filter(entry => entry.state === 'orphaned').length,
    disabled: entries.filter(entry => entry.state === 'disabled').length,
    foreign: entries.filter(entry => entry.state === 'foreign').length
  }
  return { entries, observedAt: new Date().toISOString(), totals, directObservationOnly: true }
}

/** One tool projection for the status wire: the input schema rides along only while it stays small. */
const MAX_SCHEMA_CHARS = 20_000

function observedTools(tools: readonly McpToolSnapshot[]): McpStatusTool[] {
  return tools.map(tool => ({
    name: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    ...(tool.parameters === undefined || JSON.stringify(tool.parameters).length > MAX_SCHEMA_CHARS ? {} : { parameters: tool.parameters })
  }))
}

function groupObservedTools(observed: readonly McpToolSnapshot[], knownServerNames: ReadonlySet<string>): Map<string, McpToolSnapshot[]> {
  const grouped = new Map<string, McpToolSnapshot[]>()
  for (const tool of observed) {
    if (!tool.name.startsWith('mcp__')) continue
    let serverName: string | undefined
    let rawName: string | undefined
    // Plugin server names contain `__` themselves (`suite__server`), so use
    // known names first and choose the longest matching namespace.
    for (const candidate of knownServerNames) {
      const prefix = `mcp__${candidate}__`
      if (tool.name.startsWith(prefix) && (serverName === undefined || candidate.length > serverName.length)) {
        serverName = candidate
        rawName = tool.name.slice(prefix.length)
      }
    }
    if (serverName === undefined) {
      const parts = tool.name.split('__')
      if (parts.length < 3) continue
      serverName = parts[1]
      rawName = parts.slice(2).join('__')
    }
    if (serverName === undefined || rawName === undefined || rawName === '') continue
    const list = grouped.get(serverName) ?? []
    list.push({
      name: rawName,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      ...(tool.parameters === undefined ? {} : { parameters: tool.parameters })
    })
    grouped.set(serverName, list)
  }
  return grouped
}

function endpointOf(server: McpServer): string {
  if (server.type === 'stdio') {
    const safe = redactMcpConfig(server) as { command: string; args?: string[] }
    return [safe.command, ...(safe.args ?? [])].join(' ')
  }
  return redactUrl(server.url)
}
