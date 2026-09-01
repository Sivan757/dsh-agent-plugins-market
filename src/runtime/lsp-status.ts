/**
 * LSP status aggregation: declared language servers of enabled+installed
 * suites and the user's direct configuration, merged with the mount
 * registry's latest diagnostics into rows for the status surface.
 *
 * The DSH `ctx.lsp` seam exposes no provider snapshot and no process probe,
 * so a row's state is a declaration-and-diagnostic judgment: a suite whose
 * mount succeeded yields `mounted` (the seam guarantees registration), a
 * stored diagnostic yields its own state, and a declaration with neither
 * mounts nor diagnostics means the host packages are absent (`host-missing`).
 * Direct user-configured rows follow the same model under the sentinel suite
 * id `direct` (mirroring mcp-status's `plugin`/`direct` split).
 */
import type { LspStatusEntry, LspStatusPayload, LspStatusState } from '../contracts/lsp-status.js'
import type { LspMountDiagnostic } from './lsp-mounts.js'
import type { LspServerSpec, Suite } from '../model/types.js'

/** Sentinel suite id for user-configured (non-suite) LSP servers. */
export const DIRECT_LSP_SUITE_ID = 'direct'

/** The subset of LspMountRegistry the aggregator consumes (structural, for tests). */
export interface LspMountStatusSource {
  diagnosticsSnapshot(): Map<string, LspMountDiagnostic>
  hasLiveMounts(): boolean
}

/** The direct servers table the aggregator merges in (structural, for tests). */
export interface LspDirectServersSource {
  servers: Record<string, LspServerSpec>
  errors: string[]
}

/**
 * Derive one row's state from its suite's diagnostic and the live-mount flag.
 * Shared by suite rows and direct rows so both kinds report identically.
 */
function deriveState(disabled: boolean, diagnostic: LspMountDiagnostic | undefined, anyLive: boolean): { state: LspStatusState; reason?: string; retryable?: boolean } {
  if (disabled) return { state: 'disabled' }
  if (diagnostic?.code === 'host-missing') return { state: 'host-missing', reason: diagnostic.reason }
  if (diagnostic?.code === 'seam-conflict') return { state: 'conflict', reason: diagnostic.reason }
  if (diagnostic?.code === 'mount-failed' || diagnostic?.code === 'unmount-failed') {
    return { state: 'failed', reason: diagnostic.reason, retryable: true }
  }
  if (diagnostic !== undefined) return { state: 'failed', reason: diagnostic.reason }
  if (anyLive) return { state: 'mounted' }
  return { state: 'host-missing', reason: 'no live LSP mounts in this runtime' }
}

/** Build the status payload from declarations, direct configuration, and mount diagnostics. */
export function buildLspStatus(suites: readonly Suite[], registry: LspMountStatusSource, direct: LspDirectServersSource = { servers: {}, errors: [] }): LspStatusPayload {
  const diagnostics = registry.diagnosticsSnapshot()
  const anyLive = registry.hasLiveMounts()
  const entries: LspStatusEntry[] = []
  const mountedSuiteIds = new Set<number | string>()
  for (const suite of suites) {
    // Operational inventory, mirroring mcp-status: only installed+enabled
    // suites' declarations appear.
    if (suite.lsp === undefined || suite.installedAt === undefined || !suite.enabled) continue
    const disabled = suite.activeSurfaces?.lsp === false
    const diagnostic = diagnostics.get(suite.id)
    const { state, reason, retryable } = deriveState(disabled, diagnostic, anyLive)
    if (state === 'mounted') mountedSuiteIds.add(suite.id)
    for (const spec of Object.values(suite.lsp.servers)) {
      entries.push({
        id: `${suite.id}/${spec.key}`,
        serverKey: spec.key,
        suiteId: suite.id,
        suiteName: suite.manifest.name,
        sourceId: suite.sourceId,
        kind: 'plugin',
        command: spec.command,
        args: spec.args,
        extensions: spec.extensionToLanguage,
        state,
        ...(reason === undefined ? {} : { reason }),
        ...(retryable === undefined ? {} : { retryable })
      })
    }
  }
  // Direct user-configured rows: no install state or surface toggle of their
  // own — configured means on; the mount diagnostic decides the state.
  const directDiagnostic = diagnostics.get(DIRECT_LSP_SUITE_ID)
  const { state: directState, reason: directReason, retryable: directRetryable } = deriveState(false, directDiagnostic, anyLive)
  if (directState === 'mounted') mountedSuiteIds.add(DIRECT_LSP_SUITE_ID)
  for (const spec of Object.values(direct.servers)) {
    entries.push({
      id: `${DIRECT_LSP_SUITE_ID}/${spec.key}`,
      serverKey: spec.key,
      suiteId: DIRECT_LSP_SUITE_ID,
      suiteName: spec.key,
      sourceId: '',
      kind: 'direct',
      command: spec.command,
      args: spec.args,
      extensions: spec.extensionToLanguage,
      state: directState,
      ...(directReason === undefined ? {} : { reason: directReason }),
      ...(directRetryable === undefined ? {} : { retryable: directRetryable })
    })
  }
  const mounted = entries.filter(entry => entry.state === 'mounted').length
  const failed = entries.filter(entry => entry.state === 'failed').length
  const disabled = entries.filter(entry => entry.state === 'disabled').length
  const blocked = entries.filter(entry => entry.state === 'host-missing' || entry.state === 'conflict').length
  return {
    entries,
    observedAt: new Date().toISOString(),
    totals: { all: entries.length, mounted, failed, blocked, disabled },
    hostMissing: entries.length > 0 && mountedSuiteIds.size === 0 && entries.every(entry => entry.state === 'host-missing')
  }
}
