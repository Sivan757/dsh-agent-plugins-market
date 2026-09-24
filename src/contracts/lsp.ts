/**
 * LSP wire vocabulary shared by the application services and the runtime
 * mounts: the mount-diagnostic shape the status payload carries. Contracts
 * import nothing; these are data only.
 * @module contracts/lsp
 */
import type { LspStatusCode } from './lsp-status.js'

/** One LSP mount failure as the registry records it for the status surface. */
export interface LspMountDiagnostic {
  suiteId: string
  serverKey: string
  reason: string
  code?: LspStatusCode
  /** The messages under the failure's `cause` chain, outermost first. */
  causes?: string[]
}
