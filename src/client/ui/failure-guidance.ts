/**
 * Turning a failure into the next thing to check.
 *
 * The reasons reach us from several layers — the mount pipeline, the MCP SDK,
 * the language-server packages, and (on the host compatibility backend) the
 * host client — so the classifier reads the code the runtime recorded first
 * and falls back to the wording those layers use. A wrapper sentence such as
 * `initial connection or tool synchronization failed` names no cause by
 * itself, which is why the messages under it classify too.
 *
 * @module client/ui/failure-guidance
 */
import type { LocaleKey } from '../locales.js'

/** The failure shapes worth their own sentence in the panel. */
export type FailureGuidanceKey =
  | 'credentials'
  | 'auth'
  | 'transport'
  | 'backend'
  | 'backendMissing'
  | 'missingPackage'
  | 'hostUnsupported'
  | 'seamConflict'
  | 'dns'
  | 'tls'
  | 'refused'
  | 'timeout'
  | 'commandMissing'
  | 'processExit'
  | 'protocol'
  | 'startup'
  | 'unmount'
  | 'orphanedTools'
  | 'disabledOverride'
  | 'modifiedOverride'
  | 'foreignMount'
  | 'duplicateMount'

/** The locale key holding the sentence one classified failure reports. */
export const FAILURE_GUIDANCE_LABEL: Record<FailureGuidanceKey, LocaleKey> = {
  credentials: 'failureGuideCredentials',
  auth: 'failureGuideAuth',
  transport: 'failureGuideTransport',
  backend: 'failureGuideBackend',
  backendMissing: 'failureGuideBackendMissing',
  missingPackage: 'failureGuideMissingPackage',
  hostUnsupported: 'failureGuideHostUnsupported',
  seamConflict: 'failureGuideSeamConflict',
  dns: 'failureGuideDns',
  tls: 'failureGuideTls',
  refused: 'failureGuideRefused',
  timeout: 'failureGuideTimeout',
  commandMissing: 'failureGuideCommandMissing',
  processExit: 'failureGuideProcessExit',
  protocol: 'failureGuideProtocol',
  startup: 'failureGuideStartup',
  unmount: 'failureGuideUnmount',
  orphanedTools: 'failureGuideOrphanedTools',
  disabledOverride: 'failureGuideDisabledOverride',
  modifiedOverride: 'failureGuideModifiedOverride',
  foreignMount: 'mcpForeignHint',
  duplicateMount: 'mcpDuplicateHint'
}

/** One row's failure: its code, its summary line, and the messages under it. */
export interface FailureDiagnostic {
  code?: string | undefined
  reason?: string | undefined
  causes?: readonly string[] | undefined
}

/** Classify one failure, or nothing when it carries no recognizable shape. */
export function failureGuidanceKey(diagnostic: FailureDiagnostic): FailureGuidanceKey | undefined {
  const code = diagnostic.code
  // A recorded code is the exact classification; only the mount failures and
  // the unclassified diagnostics need the wording below.
  if (code === 'missing-credential' || code === 'credential-error') return 'credentials'
  if (code === 'unsupported-transport') return 'transport'
  if (code === 'host-missing') return 'missingPackage'
  if (code === 'seam-conflict') return 'seamConflict'
  if (code === 'unmount-failed') return 'unmount'
  if (code === 'foreign-mount') return 'foreignMount'
  if (code === 'duplicate-mount') return 'duplicateMount'
  if (code === 'orphaned-tools') return 'orphanedTools'
  if (code === 'disabled-override') return 'disabledOverride'
  if (code === 'modified-override') return 'modifiedOverride'
  const text = [diagnostic.reason, ...(diagnostic.causes ?? [])].filter(line => line !== undefined).join('\n')
  if (/does not support dynamic plugin mounting/i.test(text)) return 'hostUnsupported'
  if (/dsh-mcp-client package is not installed/i.test(text)) return 'backendMissing'
  if (/built-in backend|cannot enforce|does not support the legacy SSE transport/i.test(text)) return 'backend'
  if (/\$\{[A-Za-z_][A-Za-z0-9_]*\}|credential/i.test(text)) return 'credentials'
  if (/401|403|unauthor|oauth|forbidden|challenge/i.test(text)) return 'auth'
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|dns/i.test(text)) return 'dns'
  if (/certificate|TLS|SSL|self.signed/i.test(text)) return 'tls'
  if (/ECONNREFUSED|connection refused/i.test(text)) return 'refused'
  if (/ETIMEDOUT|timed out|timeout/i.test(text)) return 'timeout'
  if (/ENOENT|not found|no such file|spawn/i.test(text)) return 'commandMissing'
  if (/exited|exit code|SIGTERM|SIGKILL|crash/i.test(text)) return 'processExit'
  if (/jsonrpc|protocol|initialize|handshake/i.test(text)) return 'protocol'
  // A mount failure with none of the shapes above still deserves the one
  // sentence that fits every startup failure.
  if (code === 'mount-failed') return 'startup'
  return undefined
}
