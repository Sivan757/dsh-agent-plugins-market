/**
 * Cross-release access to the host subagent seam.
 *
 * The host renamed its continuable-child operations in 0.2.1-alpha.4:
 * `startContinuable` became `startActivation`, and `drainContinuableChildren`
 * became `drainChildren`. The plugin pins the 0.2.0-rc.2 baseline, so the
 * published types name the old members; this module resolves whichever member
 * the live service exposes and keeps one source tree working on both releases.
 *
 * Every member is optional and every call is guarded, per the plugin standard's
 * rule for a host capability the declared types do not carry. A host exposing
 * neither name is unsupported, and the refusal names both members rather than
 * failing with a property access on undefined.
 *
 * @module runtime/agents/subagent-seam
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** The child identity both releases return once the child accepts its first prompt. */
export interface ContinuableChildStart {
  /** The host reserves a branded session id; the plugin only forwards the value. */
  readonly childId: string
  readonly messageId?: string
}

/** One continuable start as this plugin issues it, in the older release's spelling. */
export interface ContinuableStartInput {
  readonly provider: string
  readonly label: string
  readonly request: unknown
  readonly signal: AbortSignal
}

/**
 * The host subagent members this plugin drives, across both release lines.
 *
 * The 0.2.1-alpha.4 activation additionally requires `delivery`; the older
 * continuable start always notified the parent, so the adapter supplies that
 * value explicitly.
 */
export interface ContinuableSubagentSeam {
  startContinuable?(spec: ContinuableStartInput): Promise<ContinuableChildStart>
  startActivation?(spec: ContinuableStartInput & { readonly delivery?: 'parent' | 'caller' }): Promise<ContinuableChildStart>
  drainContinuableChildren?(parent: Agent, childIds: readonly SessionId[]): Promise<void>
  drainChildren?(parent: Agent, childIds: readonly SessionId[]): Promise<void>
}

/**
 * Start one continuable child on whichever start member the host exposes.
 * @param seam - the live `ctx.subagents` service.
 * @param input - provider, label, delegation request, and cancellation.
 * @returns the child identity the host reserved.
 * @throws when the host exposes neither start member.
 */
export function startContinuableChild(seam: ContinuableSubagentSeam, input: ContinuableStartInput): Promise<ContinuableChildStart> {
  if (typeof seam.startContinuable === 'function') return seam.startContinuable(input)
  if (typeof seam.startActivation === 'function') return seam.startActivation({ ...input, delivery: 'parent' })
  return Promise.reject(new Error('the host subagent service exposes neither startContinuable nor startActivation'))
}

/**
 * Release selected resident continuable children on whichever drain member the
 * host exposes.
 * @param seam - the live `ctx.subagents` service.
 * @param parent - exact live direct parent authorizing the release.
 * @param childIds - durable direct-child ids to release when resident.
 * @throws when the host exposes neither drain member.
 */
export function drainContinuableChildIds(seam: ContinuableSubagentSeam, parent: Agent, childIds: readonly SessionId[]): Promise<void> {
  if (typeof seam.drainContinuableChildren === 'function') return seam.drainContinuableChildren(parent, childIds)
  if (typeof seam.drainChildren === 'function') return seam.drainChildren(parent, childIds)
  return Promise.reject(new Error('the host subagent service exposes neither drainContinuableChildren nor drainChildren'))
}
