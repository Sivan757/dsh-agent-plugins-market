/** Browser-safe LSP status records shared by host aggregation and client rendering. */

/** Whether an LSP row comes from a suite declaration or direct user configuration. */
export type LspStatusKind = 'plugin' | 'direct'

/** Operational state rendered for an LSP server row. */
export type LspStatusState = 'mounted' | 'starting' | 'host-missing' | 'failed' | 'conflict' | 'disabled'

/**
 * One declared language-server row for the status surface.
 *
 * Rows are built from the enabled suites' inline `lspServers` declarations
 * plus the user's direct configuration, merged with the latest mount
 * diagnostics; the DSH `ctx.lsp` seam exposes no provider snapshot, so this
 * is a declaration-and-diagnostic model, not a process probe.
 */
export interface LspStatusEntry {
  /** Stable row id: `${suiteId}/${serverKey}` (suite rows) or `direct/${serverKey}`. */
  id: string
  /** Server key from the declaring `lspServers` table. */
  serverKey: string
  /** Declaring suite id; the sentinel `direct` for user-configured rows. */
  suiteId: string
  /** Declaring suite display name. */
  suiteName: string
  /** Source id of the declaring suite; empty for user-configured rows. */
  sourceId: string
  /** Where the row comes from. */
  kind: LspStatusKind
  /** Executable the host will spawn. */
  command: string
  /** Executable arguments. */
  args: string[]
  /** Lowercase leading-dot extension → LSP language id. */
  extensions: Record<string, string>
  /** Operational state. */
  state: LspStatusState
  /** Latest diagnostic reason, when the state is not `mounted`/`disabled`. */
  reason?: string
  /** Whether a failed mount will be retried automatically. */
  retryable?: boolean
}

/** The LSP status response returned by the host. */
export interface LspStatusPayload {
  entries: LspStatusEntry[]
  observedAt: string
  totals: { all: number; mounted: number; failed: number; blocked: number; disabled: number }
  /** True when the host lacks the LSP packages, so every declaration is blocked. */
  hostMissing: boolean
}
