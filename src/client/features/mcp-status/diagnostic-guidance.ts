/**
 * Turning a mount failure into the next thing to check.
 *
 * The reasons reach us from several layers — our own mount pipeline, the MCP
 * SDK, and (on the compatibility backend) the host client — so the classifier
 * keys off the wording those layers use rather than an error code we do not
 * own. An unrecognized reason produces no advice instead of a generic line.
 */
import type { LocaleKey } from '../../locales.js'

/** The failure shapes worth a specific piece of advice. */
export type McpGuidanceKey = 'credentials' | 'auth' | 'transport' | 'backend' | 'dns' | 'tls' | 'refused' | 'timeout' | 'commandMissing' | 'processExit' | 'protocol'

/** The locale key holding the advice for one classified failure. */
export const MCP_GUIDANCE_LABEL: Record<McpGuidanceKey, LocaleKey> = {
  credentials: 'mcpGuideCredentials',
  auth: 'mcpGuideAuth',
  transport: 'mcpGuideTransport',
  backend: 'mcpGuideBackend',
  dns: 'mcpGuideDns',
  tls: 'mcpGuideTls',
  refused: 'mcpGuideRefused',
  timeout: 'mcpGuideTimeout',
  commandMissing: 'mcpGuideCommandMissing',
  processExit: 'mcpGuideProcessExit',
  protocol: 'mcpGuideProtocol'
}

/** Classify one failure, or nothing when its wording matches no known shape. */
export function mcpGuidanceKey(code: string | undefined, reason: string | undefined): McpGuidanceKey | undefined {
  const text = `${code ?? ''} ${reason ?? ''}`
  if (code === 'missing-credential') return 'credentials'
  if (/credential|\$\{[A-Za-z_][A-Za-z0-9_]*\}/i.test(text)) return 'credentials'
  if (code === 'unsupported-transport') return 'transport'
  if (/built-in backend|cannot enforce/i.test(text)) return 'backend'
  if (/401|403|unauthor|oauth|forbidden|challenge/i.test(text)) return 'auth'
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|dns/i.test(text)) return 'dns'
  if (/certificate|TLS|SSL|self.signed/i.test(text)) return 'tls'
  if (/ECONNREFUSED|connection refused/i.test(text)) return 'refused'
  if (/ETIMEDOUT|timed out|timeout/i.test(text)) return 'timeout'
  if (/ENOENT|not found|no such file|spawn/i.test(text)) return 'commandMissing'
  if (/exited|exit code|SIGTERM|SIGKILL|crash/i.test(text)) return 'processExit'
  if (/jsonrpc|protocol|initialize|handshake/i.test(text)) return 'protocol'
  return undefined
}
