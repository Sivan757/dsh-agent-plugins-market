/**
 * Cross-release access to the host subagent seam.
 *
 * The host renamed its child-start operations in 0.2.1-alpha.4:
 * `startContinuable` became `startActivation`, `drainContinuableChildren`
 * became `drainChildren`, and the one-shot `start` was replaced by
 * `startActivation` with caller delivery. The plugin pins the 0.2.0-rc.2
 * baseline, so the published types name the old members; this module resolves
 * whichever member the live service exposes and keeps one source tree working on
 * both releases.
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

/** One foreground run's settled outcome, identical on both release lines. */
export interface OneShotStartResult {
  readonly output: readonly unknown[]
  readonly stopReason: string
  readonly diagnostic?: string
}

/**
 * One foreground run as this plugin consumes it.
 *
 * The older host names the run `id`; the newer activation names the child
 * `childId`. Both are the same durable child identity, so the seam normalizes
 * to one field the router can return as `runId`.
 */
export interface OneShotChildRun {
  readonly runId: string
  readonly result: Promise<OneShotStartResult>
  dispose(): Promise<void>
}

/** The older host's one-shot start return, before normalization. */
export interface LegacyOneShotRun {
  readonly id: string
  readonly result: Promise<OneShotStartResult>
  dispose(): Promise<void>
}

/** The newer host's activation return, before normalization. */
export interface ActivationChildStart extends ContinuableChildStart {
  readonly result: Promise<OneShotStartResult>
  dispose(): Promise<void>
}

/**
 * The host subagent members this plugin drives, across both release lines.
 *
 * The 0.2.1-alpha.4 activation additionally requires `delivery`; the older
 * continuable start always notified the parent, so the adapter supplies that
 * value explicitly, and the older one-shot start instead takes its cancellation
 * signal inside the request.
 */
export interface ContinuableSubagentSeam {
  start?(provider: string, request: unknown): Promise<LegacyOneShotRun>
  startContinuable?(spec: ContinuableStartInput): Promise<ContinuableChildStart>
  startActivation?(spec: ContinuableStartInput & { readonly delivery?: 'parent' | 'caller' }): Promise<ActivationChildStart>
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
 * Start one foreground child on whichever one-shot member the host exposes.
 *
 * The foreground channel stays blocking on both lines, so the caller receives
 * the settled run. The newer activation asks for caller delivery: it sends no
 * parent notice and settles its result after teardown, which is exactly the
 * foreground contract.
 * @param seam - the live `ctx.subagents` service.
 * @param input - provider, label, delegation request, and cancellation.
 * @returns one normalized run carrying the durable child identity.
 * @throws when the host exposes neither one-shot start member.
 */
export function startOneShotChild(seam: ContinuableSubagentSeam, input: ContinuableStartInput): Promise<OneShotChildRun> {
  if (typeof seam.start === 'function') {
    // The older one-shot start reads cancellation from its request object.
    const request = { ...(input.request as Record<string, unknown>), signal: input.signal }
    return seam.start(input.provider, request).then(run => ({ runId: run.id, result: run.result, dispose: () => run.dispose() }))
  }
  if (typeof seam.startActivation === 'function') {
    return seam.startActivation({ ...input, delivery: 'caller' }).then(activation => ({
      runId: activation.childId,
      result: activation.result,
      dispose: () => activation.dispose()
    }))
  }
  return Promise.reject(new Error('the host subagent service exposes neither start nor startActivation'))
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
