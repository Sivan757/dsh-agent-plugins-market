import { applyOverride, type McpSuiteOverrides } from './mcp-overrides.js'
import { credentialRefsInServer, deriveServerName } from './mcp-config.js'
import type { McpStatusEntry, McpStatusPayload, McpStatusState } from '../contracts/mcp-status.js'
import { inspectToolRegistry, type McpToolSnapshot } from './tool-registry-observer.js'
import { redactMcpConfig, redactUrl } from './mcp-redaction.js'
import type { McpServer, McpServerStdio, McpServerStreamableHttp, Suite } from '../model/types.js'

export type { McpStatusEntry, McpStatusPayload, McpStatusKind, McpStatusState } from '../contracts/mcp-status.js'
export { inspectToolRegistry }
export type { McpToolSnapshot } from './tool-registry-observer.js'

export interface McpDiagnostic {
  suiteId: string
  serverKey: string
  reason: string
  code?: 'unsupported-transport' | 'missing-credential' | 'credential-error' | 'unmount-failed' | 'mount-failed'
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
    const suiteOverrides = overrides.get(suite.id)
    for (const [serverKey, server] of Object.entries(suite.mcp.servers)) {
      const override = suiteOverrides?.[serverKey]
      const serverName = deriveServerName(suite.id, serverKey)
      const tools = observedByServer.get(serverName) ?? []
      claimedServers.add(serverName)
      const diagnostic = diagnosticsByKey.get(`${suite.id}\u0000${serverKey}`)
      const effective = applyOverride(server as McpServerStdio | McpServerStreamableHttp, override)
      const credentialRefs = [...new Set([...credentialRefsInServer(effective), ...(diagnostic?.credentialRefs ?? [])])].sort()
      const disabled = override?.enabled === false || suite.activeSurfaces?.mcp === false
      const orphaned = disabled && tools.length > 0
      const state: McpStatusState = orphaned
        ? 'orphaned'
        : diagnostic?.code === 'missing-credential'
          ? 'needs-credentials'
          : diagnostic !== undefined
            ? 'failed'
            : disabled
              ? 'disabled'
              : tools.length > 0
                ? 'connected'
                : 'degraded'
      const reason = orphaned
        ? 'MCP tools remain after this plugin surface was disabled'
        : (diagnostic?.reason ?? (override === undefined ? undefined : disabled ? 'disabled by override' : 'modified by override'))
      entries.push({
        id: `plugin:${suite.sourceId}/${suite.id}/${serverKey}`,
        name: serverName,
        kind: 'plugin',
        state,
        source: suite.manifest.name,
        suiteId: suite.id,
        serverKey,
        transport: server.type,
        endpoint: endpointOf(server),
        config: redactMcpConfig(server) as Record<string, unknown>,
        tools: disabled && !orphaned ? [] : tools.map(tool => ({ name: tool.name, ...(tool.description === undefined ? {} : { description: tool.description }) })),
        advertisedTools: tools.length > 0,
        retryable: diagnostic?.code === 'mount-failed' || diagnostic?.code === 'unmount-failed',
        ...(reason === undefined ? {} : { reason }),
        ...(credentialRefs.length === 0 ? {} : { credentialRefs })
      })
    }
  }

  for (const [serverName, tools] of observedByServer) {
    if (claimedServers.has(serverName)) continue
    const stale = knownDefinitions.get(serverName)
    if (stale !== undefined) {
      const staleRefs = credentialRefsInServer(stale.server)
      entries.push({
        id: `orphaned:${stale.suite.sourceId}/${stale.suite.id}/${stale.serverKey}`,
        name: serverName,
        kind: 'plugin',
        state: 'orphaned',
        source: stale.suite.manifest.name,
        suiteId: stale.suite.id,
        serverKey: stale.serverKey,
        transport: stale.server.type,
        endpoint: endpointOf(stale.server),
        config: redactMcpConfig(stale.server) as Record<string, unknown>,
        tools: tools.map(tool => ({ name: tool.name, ...(tool.description === undefined ? {} : { description: tool.description }) })),
        reason: 'MCP tools remain after this plugin was disabled or uninstalled',
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
      tools: tools.map(tool => ({ name: tool.name, ...(tool.description === undefined ? {} : { description: tool.description }) }))
    })
  }

  const totals = {
    all: entries.length,
    connected: entries.filter(entry => entry.state === 'connected').length,
    degraded: entries.filter(entry => entry.state === 'degraded').length,
    failed: entries.filter(entry => entry.state === 'failed').length,
    needsCredentials: entries.filter(entry => entry.state === 'needs-credentials').length,
    orphaned: entries.filter(entry => entry.state === 'orphaned').length,
    disabled: entries.filter(entry => entry.state === 'disabled').length
  }
  return { entries, observedAt: new Date().toISOString(), totals, directObservationOnly: true }
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
    list.push({ name: rawName, ...(tool.description === undefined ? {} : { description: tool.description }) })
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
