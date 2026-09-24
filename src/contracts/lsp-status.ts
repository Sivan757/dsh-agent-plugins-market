/** Browser-safe LSP status records shared by host aggregation and client rendering. */

/** Whether an LSP row comes from a suite declaration or direct user configuration. */
export type LspStatusKind = 'plugin' | 'direct'

/** Operational state rendered for an LSP server row. */
export type LspStatusState = 'mounted' | 'starting' | 'host-missing' | 'failed' | 'conflict' | 'disabled'

/** Why a row reports a reason; also the key the panel localizes it by. */
export type LspStatusCode = 'mount-failed' | 'unmount-failed' | 'seam-conflict' | 'host-missing'

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
  /** Why this row carries a reason; also the key the panel localizes it by. */
  code?: LspStatusCode
  /** The messages under the failure's `cause` chain, outermost first. */
  causes?: string[]
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
  /**
   * A profile layer that still registers the seam this plugin owns, present
   * only while a `seam-conflict` is actually being reported. Releases before
   * the plugin provisioned LSP itself told users to add such a layer by hand,
   * so an upgrade can land here and the panel offers to remove it.
   */
  legacySeam?: LspLegacySeam
}

/** One profile layer that must be removed before this plugin can own the LSP seam. */
export interface LspLegacySeam {
  /** Profile name, as passed to `dsh --profile`. */
  profile: string
  /** Absolute path of the profile's patch file. */
  patchPath: string
  /** The conflicting `insert` rows, as `id` plus package name. */
  rows: Array<{ id: string; name: string }>
  /** Other profiles carrying a legacy layer, which this action does not touch. */
  otherProfiles: string[]
  /** Whether the host must restart before the removal takes effect. */
  restartRequired: boolean
  /** Human-readable summary of the layer, used in the panel copy. */
  summary: string
}

/** The outcome of removing one profile's legacy LSP layer. */
export interface LspLegacySeamMigration {
  profile: string
  /** Absolute path of the patch file that was edited. */
  patchPath: string
  /** Where the pre-edit content was kept. */
  backupPath: string
  /** True when the host must restart before the removal takes effect. */
  restartRequired: boolean
}
