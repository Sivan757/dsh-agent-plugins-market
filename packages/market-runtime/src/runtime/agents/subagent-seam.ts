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
 * This is the only module in the repository that names a host subagent member.
 * The table below is the single source the runtime guards and the contract test
 * read, so the two cannot drift apart. A host exposing no spelling of an
 * operation is refused with a message naming every alternative, never with a
 * property access on undefined.
 *
 * @module runtime/agents/subagent-seam
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentActivationSpec, SubagentProvider } from '@deepseek-ai/dsh-subagent'

/** The child identity both releases return once the child accepts its first prompt. */
export interface ContinuableChildStart {
  /** The host reserves a branded session id; the plugin only forwards the value. */
  readonly childId: string
  readonly messageId?: string
  /**
   * Release exactly this child.
   *
   * The activation line owns one handle per start, so a child that must not stay
   * resident is released through it. The older line exposes no handle and keeps
   * the per-child drain members instead; there this field is absent.
   */
  readonly release?: () => Promise<void>
}

/** One child start as this plugin issues it, in the older release's spelling. */
export interface ContinuableStartInput {
  readonly provider: string
  readonly label: string
  readonly request: unknown
  readonly signal: AbortSignal
  /**
   * Reserved child identity. Both start members accept it, so the plugin can
   * compose the child before the host publishes it. The older one-shot `start`
   * allocates its own identity and cannot take this field.
   */
  readonly childId?: SessionId
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
 * Every host subagent member this plugin drives, named by the operation it
 * performs and listed in the order the seam prefers the spellings.
 */
export const SEAM_MEMBER_ALTERNATIVES = {
  oneShotChild: ['start', 'startActivation'],
  continuableChild: ['startContinuable', 'startActivation'],
  drainChildren: ['drainContinuableChildren', 'drainChildren'],
  registerProvider: ['registerProvider']
} as const

/** One logical subagent operation the seam performs. */
export type SeamOperation = keyof typeof SEAM_MEMBER_ALTERNATIVES

/**
 * The host subagent members this plugin drives, across both release lines.
 *
 * The two start spellings take different arguments: the older continuable start
 * nests the child request under `request`, while the 0.2.1-alpha.4 activation
 * spreads those fields into the spec and adds `delivery`. The adapter owns that
 * translation; the activation member is typed as the installed host declares it
 * so a release that renames a field fails here rather than at call time. The
 * older one-shot start instead takes its cancellation signal inside the request.
 */
export interface SubagentSeam {
  start?(provider: string, request: unknown): Promise<LegacyOneShotRun>
  startContinuable?(spec: ContinuableStartInput): Promise<ContinuableChildStart>
  startActivation?(spec: SubagentActivationSpec): Promise<ActivationChildStart>
  drainContinuableChildren?(parent: Agent, childIds: readonly SessionId[]): Promise<void>
  drainChildren?(parent: Agent, childIds: readonly SessionId[]): Promise<void>
  registerProvider?(provider: SubagentProvider): () => void
}

/** One resolved member spelling and a caller that keeps the service as its receiver. */
interface ResolvedMember {
  readonly name: string
  readonly call: (...args: never[]) => unknown
}

/**
 * Resolve the first live spelling for one operation from the member table.
 *
 * The returned caller applies the member with the seam as its receiver: a host
 * service method reads its own context from `this`, and a detached reference
 * loses it.
 */
function resolveMember(seam: SubagentSeam | undefined, operation: SeamOperation): ResolvedMember | undefined {
  const members = seam as unknown as Record<string, unknown> | undefined
  for (const name of SEAM_MEMBER_ALTERNATIVES[operation]) {
    const member = members?.[name]
    if (typeof member !== 'function') continue
    const call = (...args: never[]): unknown => Reflect.apply(member as (...values: never[]) => unknown, seam, args)
    return { name, call }
  }
  return undefined
}

/** The refusal for a host that exposes no spelling of one operation. */
function missingMember(operation: SeamOperation): Error {
  const alternatives = SEAM_MEMBER_ALTERNATIVES[operation]
  return new Error(`the host subagent service exposes no ${alternatives.join(' or ')} member`)
}

/**
 * Which mechanism carries the role instructions on the host line this seam serves.
 *
 * The 0.2.1 line removed the request `persona` field, so from
 * `0.2.1-alpha.2` on the plugin installs the child's own prompt section. The
 * member spelling is the line discriminator: `startContinuable` exists exactly
 * on the releases that still honor `persona`.
 */
export type RoleInstructionChannel = 'request-persona' | 'prompt-section'

/**
 * Resolve the role-instruction mechanism for the live host line.
 * @param seam - the live `ctx.subagents` service.
 * @returns the mechanism the plugin must use for this host.
 */
export function roleInstructionChannel(seam: SubagentSeam): RoleInstructionChannel {
  return resolveMember(seam, 'continuableChild')?.name === 'startContinuable' ? 'request-persona' : 'prompt-section'
}

/**
 * One activation spec in the newer host's spelling: the child request's fields
 * sit at the top level, and `delivery` states who receives the result.
 * @param input - provider, label, delegation request, and cancellation.
 * @param delivery - parent notification or caller-only result.
 * @returns the spec the activation member accepts.
 */
function activationSpec(input: ContinuableStartInput, delivery: 'parent' | 'caller'): SubagentActivationSpec {
  const request = (input.request ?? {}) as Omit<SubagentActivationSpec, 'provider' | 'label' | 'signal' | 'delivery' | 'childId'>
  return {
    ...request,
    provider: input.provider,
    label: input.label,
    signal: input.signal,
    delivery,
    ...(input.childId === undefined ? {} : { childId: input.childId })
  }
}

/**
 * Start one continuable child on whichever start member the host exposes.
 * @param seam - the live `ctx.subagents` service.
 * @param input - provider, label, delegation request, and cancellation.
 * @returns the child identity the host reserved.
 * @throws when the host exposes neither start member.
 */
export function startContinuableChild(seam: SubagentSeam, input: ContinuableStartInput): Promise<ContinuableChildStart> {
  const resolved = resolveMember(seam, 'continuableChild')
  if (resolved?.name === 'startContinuable') return (resolved.call as (spec: ContinuableStartInput) => Promise<ContinuableChildStart>)(input)
  if (resolved?.name === 'startActivation') {
    return (resolved.call as (spec: SubagentActivationSpec) => Promise<ActivationChildStart>)(activationSpec(input, 'parent')).then(activation => ({
      childId: activation.childId,
      ...(activation.messageId === undefined ? {} : { messageId: activation.messageId }),
      release: () => activation.dispose()
    }))
  }
  return Promise.reject(missingMember('continuableChild'))
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
export function startOneShotChild(seam: SubagentSeam, input: ContinuableStartInput): Promise<OneShotChildRun> {
  const resolved = resolveMember(seam, 'oneShotChild')
  if (resolved?.name === 'start') {
    type OneShotStart = (provider: string, request: unknown) => Promise<LegacyOneShotRun>
    // The older one-shot start reads cancellation from its request object.
    const request = { ...(input.request as Record<string, unknown>), signal: input.signal }
    return (resolved.call as OneShotStart)(input.provider, request).then(run => ({ runId: run.id, result: run.result, dispose: () => run.dispose() }))
  }
  if (resolved?.name === 'startActivation') {
    type ActivationStart = (spec: SubagentActivationSpec) => Promise<ActivationChildStart>
    return (resolved.call as ActivationStart)(activationSpec(input, 'caller')).then(activation => ({
      runId: activation.childId,
      result: activation.result,
      dispose: () => activation.dispose()
    }))
  }
  return Promise.reject(missingMember('oneShotChild'))
}

/**
 * Release selected resident continuable children on whichever drain member the
 * older host exposes.
 *
 * The activation line has no per-child drain: its service closes whole trees, so
 * a single child is released through the handle {@link startContinuableChild}
 * returns. Callers prefer that handle and fall back here.
 * @param seam - the live `ctx.subagents` service.
 * @param parent - exact live direct parent authorizing the release.
 * @param childIds - durable direct-child ids to release when resident.
 * @throws when the host exposes neither drain member.
 */
export function drainContinuableChildIds(seam: SubagentSeam, parent: Agent, childIds: readonly SessionId[]): Promise<void> {
  const resolved = resolveMember(seam, 'drainChildren')
  if (resolved === undefined) return Promise.reject(missingMember('drainChildren'))
  return (resolved.call as (parent: Agent, childIds: readonly SessionId[]) => Promise<void>)(parent, childIds)
}

/**
 * Register one subagent provider on the host service.
 * @param seam - the live `ctx.subagents` service.
 * @param provider - the provider implementation this plugin supplies.
 * @returns the host registration disposer.
 * @throws when the host exposes no provider registry.
 */
export function registerSubagentProvider(seam: SubagentSeam, provider: SubagentProvider): () => void {
  const resolved = resolveMember(seam, 'registerProvider')
  if (resolved === undefined) throw missingMember('registerProvider')
  return (resolved.call as (provider: SubagentProvider) => () => void)(provider)
}
