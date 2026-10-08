import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import '@deepseek-ai/dsh-session-query'
import { z } from 'zod'
import { parseExtensionIds, type ExtensionSelection } from '../../../../market-contracts/src/contracts/extension-presets.js'

export const EXTENSION_SESSION_SOURCE = 'market-extension-selection'
const selectionSchema = z
  .object({
    presetId: z.string().min(1).nullable(),
    presetName: z.string().min(1).max(80).nullable(),
    presetRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    modified: z.boolean(),
    enabledIds: z.array(z.string()).transform(ids => parseExtensionIds(ids))
  })
  .strict()
  .refine(value => (value.presetId === null) === (value.presetName === null) && (value.presetId === null) === (value.presetRevision === null))
const bindingSchema = z
  .object({
    version: z.literal(1),
    ownerId: z.string().min(1),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    phase: z.enum(['pending', 'committed']),
    requestRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    selection: selectionSchema,
    recoveryOf: z
      .object({ ownerId: z.string().min(1), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })
      .strict()
      .optional()
  })
  .strict()
type Binding = z.infer<typeof bindingSchema>
/** The metadata marker that wakes a driver after a recovery; it never enters a request. */
export const EXTENSION_SESSION_WAKE_SOURCE = 'market-extension-wake'
/** One durable request that becomes effective only at a safe boundary. */
const intentSchema = z
  .object({
    ownerId: z.string().min(1),
    /** The public selection CAS token, independent of the binding journal. */
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    selection: selectionSchema
  })
  .strict()
type Intent = z.infer<typeof intentSchema>
export const EXTENSION_INTENT_SOURCE = 'market-extension-intent'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'market-extension-selection': { kind: 'market-extension-selection'; form: 'context'; binding: Binding }
    'market-extension-wake': { kind: 'market-extension-wake'; form: 'context' }
    'market-extension-intent': { kind: 'market-extension-intent'; form: 'context'; intent: Intent }
  }
}
/** Whether one message kind is this service's own metadata rather than user input. */
function isPluginMetadata(kind: string): boolean {
  return kind === EXTENSION_SESSION_SOURCE || kind === EXTENSION_SESSION_WAKE_SOURCE || kind === EXTENSION_INTENT_SOURCE
}
export interface ExtensionSessionSnapshot {
  revision: number
  selection: ExtensionSelection
}
export interface ExtensionSessionStatus {
  ready: boolean
  /** Latest attempted transaction, used as the recovery compare-and-swap revision. */
  revision: number
  recoverable: boolean
  error?: string
  /** Recovery target when not ready; never an effective selection in that state. */
  selection?: ExtensionSelection
}
interface Checkpoint {
  latest?: Binding
  committed?: Binding
  initial?: ExtensionSelection
  /** The last durable request replayed from the log; effective only after promotion. */
  intent?: Intent
}
/**
 * Optional lease on one applied selection.
 *
 * An adapter returns one when it applied an effect it can still undo: the state
 * machine holds it until the committed binding is durable, then calls
 * {@link ExtensionApplyReceipt.commit}. Every pre-durable failure calls
 * {@link ExtensionApplyReceipt.rollback} instead, so an uncertain write never
 * leaves a half-applied selection behind. Returning nothing keeps an adapter that
 * owns its own rollback working unchanged.
 */
export interface ExtensionApplyReceipt {
  /**
   * Publish the applied effect. Synchronous by contract and must not throw: it runs
   * inside the commit sequence after durability, where awaiting would reopen the
   * window this transaction closes.
   */
  commit(): void
  /** Undo the applied effect. A rejection is a diagnostic, never a replacement for the original failure. */
  rollback(): Promise<void>
}
export interface ExtensionSessionStatePorts {
  /** Use agent.session.header.cwd, never a client path. Legacy captures global choices, not a workspace default. */
  initialSelection(agent: Agent, source?: string): Promise<ExtensionSelection>
  /**
   * Replace the complete agent-local selection; resource gates must reject unavailable service state.
   * Returns a receipt when the effect is still reversible, else nothing.
   */
  applySelection(agent: Agent, selection: ExtensionSelection): Promise<void | ExtensionApplyReceipt>
  /** Publish synchronous cache/schema invalidations after commit, before maintenance releases queued input. */
  committed?(agent: Agent): void
  /**
   * Whether this service governs one agent at all. Absent governs every agent,
   * which is what a workspace-agnostic host and the service's own tests rely on.
   * An agent the port rejects keeps its original host lifecycle: it is never
   * tracked, never granted a selection, never cancelled, and its steps pass
   * through untouched. An undecidable answer — the port throws — stays on the
   * governed path, so an unknown agent is denied instead of silently allowed.
   */
  eligible?(agent: Agent): boolean
}
function failure(code: string): Error {
  return Object.assign(new Error(code), { code })
}

/** Durable selections use known message envelopes; pending transactions reject replay after an uncertain failure. */
export class ExtensionSessionState {
  private readonly states = new Map<Agent, ExtensionSessionSnapshot>()
  private readonly initializing = new Map<Agent, Promise<void>>()
  private readonly checkpoints = new Map<Agent, Checkpoint>()
  private readonly errors = new Map<Agent, string>()
  private readonly lifetime = new AbortController()
  private readonly unavailable = new Set<Agent>()
  /** The capture classification each attempt used, so an explicit recovery replays it exactly. */
  private readonly captureSources = new Map<Agent, string | undefined>()
  /** Durable requests waiting for a safe boundary; the last one received wins. */
  private readonly intents = new Map<Agent, Intent>()
  /** The turn each pending request was made in: a boundary only exists in a later turn. */
  private readonly intentTurns = new Map<Agent, number | undefined>()
  /** Per-agent order for requests and promotions, so no two of them interleave. */
  private readonly requests = new Map<Agent, Promise<unknown>>()
  /** The turn each agent last entered, so a request can record the turn it came from. */
  private readonly currentTurns = new Map<Agent, number>()
  /** Single-flight promotion per agent: one turn boundary promotes once. */
  private readonly promoting = new Map<Agent, Promise<void>>()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly off: Array<() => void> = []
  private disposed = false
  private disposal?: Promise<void>
  constructor(
    private readonly ctx: Context,
    private readonly ports: ExtensionSessionStatePorts
  ) {
    this.off.push(
      ctx.on('agent/created', async ({ agent, source }) => {
        // An ungoverned agent is never tracked, so it can neither be cancelled
        // nor inherit a selection this service had no mandate to capture.
        if (!this.governs(agent)) return
        await this.initialize(agent, source).catch(() => {})
      })
    )
    this.off.push(
      ctx.on('agent/pre-step', async (event, next): Promise<PreStepDecision> => {
        if (!this.governs(event.agent)) return next()
        this.currentTurns.set(event.agent, event.turn)
        if (this.intents.get(event.agent) !== undefined && this.intentTurns.get(event.agent) === undefined) {
          // The request arrived before any turn was observed for it, so this turn is
          // the one it came from: a boundary exists only in a later turn. Seeding here
          // keeps that from costing one blocked turn at this turn's own first step.
          this.intentTurns.set(event.agent, event.turn)
        }
        // A request waiting for its boundary must not run under the superseded
        // authorization. Only the first step of a turn that started after the
        // request is that request's step: park it whole, promote from idle, and let
        // the filtered wake hand it back, so no model step is spent on the old
        // selection and no stale tool assembly is ever used.
        //
        // A later step of the same turn is mid-turn work. The host claims every
        // next-step message at every step, so a steer belongs here, and rejecting it
        // would block the running turn. Such a step keeps the committed selection.
        const intentTurn = this.intentTurns.get(event.agent)
        const newTurnStep = event.step === 1 && (intentTurn === undefined || event.turn > intentTurn)
        if (this.intents.get(event.agent) !== undefined && newTurnStep && event.messages.some(message => message.source.kind === 'user')) {
          const { agent } = event
          const strandedIds = new Set([...agent.inbox.nextStep, ...agent.inbox.nextTurn].map(message => message.id))
          let identityHeld = false
          for (const message of [...event.messages].reverse()) {
            if (strandedIds.has(message.id)) {
              identityHeld = true
              continue
            }
            agent.inbox.prepend('next-step', message)
            strandedIds.add(message.id)
          }
          this.promoteAfterIdle(agent)
          // An empty enter at the turn's first step completes that turn with no step
          // and no model call, while reject would label it blocked in the durable log.
          // The claim already removed these messages, so the prepend above is what
          // keeps the request intact for the wake to re-run. A claimed identity that is
          // somehow still pending is a corruption signal, and then reject fails closed.
          if (identityHeld) return Promise.resolve({ kind: 'reject' })
          return Promise.resolve({ kind: 'enter', messages: [] })
        }
        if (this.status(event.agent).ready) {
          // The envelope's durable record is its inbox splice; the claimed copy is
          // filtered out before it can enter a request as placeholder user text.
          const decision = await next()
          if (decision.kind !== 'enter') return decision
          // The durable envelope and the recovery wake marker are plugin metadata:
          // neither may enter a request as placeholder user text.
          return { ...decision, messages: decision.messages.filter(message => !isPluginMetadata(message.source.kind)) }
        }
        // The host claims input before this hook; reject alone would discard it.
        const { agent } = event
        const pendingIds = new Set([...agent.inbox.nextStep, ...agent.inbox.nextTurn].map(message => message.id))
        for (const message of [...event.messages].reverse()) {
          if (pendingIds.has(message.id)) continue
          agent.inbox.prepend('next-step', message)
          pendingIds.add(message.id)
        }
        return Promise.resolve({ kind: 'reject' })
      })
    )
    this.off.push(
      // A clean stop promotes the pending request after the last step of the turn
      // and before the next turn claims input, which is the only boundary where the
      // next request's tool assembly and the gates agree.
      ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
        if (this.disposed || !this.governs(agent) || this.intents.get(agent) === undefined) return
        signal.throwIfAborted()
        await this.promote(agent).catch(() => {})
      })
    )
    this.off.push(
      // A turn that ended without stopping (cancelled, aborted, failed) never
      // dispatches turn-stopping, so the idle transition promotes instead.
      ctx.on('agent/status', ({ agent, status }) => {
        if (status !== 'idle' || this.disposed || !this.governs(agent)) return
        if (this.intents.get(agent) === undefined) return
        this.promoteAfterIdle(agent)
      })
    )
    this.off.push(
      ctx.on('agent/disposed', ({ agent }) => {
        this.states.delete(agent)
        this.checkpoints.delete(agent)
        this.errors.delete(agent)
        this.unavailable.delete(agent)
        this.initializing.delete(agent)
        this.captureSources.delete(agent)
        this.intents.delete(agent)
        this.promoting.delete(agent)
        this.intentTurns.delete(agent)
        this.currentTurns.delete(agent)
        this.requests.delete(agent)
      })
    )
  }
  /** Whether this service governs one agent; an undecidable answer stays governed. */
  private governs(agent: Agent): boolean {
    if (this.ports.eligible === undefined) return true
    try {
      return this.ports.eligible(agent)
    } catch {
      return true
    }
  }
  /** Attach idle agents independently; busy agents remain denied until their current activity ends. */
  async start(): Promise<void> {
    await Promise.all(
      this.ctx.agents
        .list()
        .filter(agent => this.governs(agent))
        .map(agent => this.attach(agent))
    )
  }
  private async attach(agent: Agent): Promise<void> {
    if (!this.governs(agent)) return
    this.unavailable.add(agent)
    try {
      await this.maintenance(agent, signal => this.initialize(agent, 'legacy', signal))
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'extension-session-busy') return
      this.errors.set(agent, 'extension-session-busy')
      const signal = this.lifetime.signal
      let stop = () => {}
      const disposed = new Promise<void>(resolve => {
        const onAbort = () => resolve()
        signal.addEventListener('abort', onAbort, { once: true })
        stop = () => signal.removeEventListener('abort', onAbort)
      })
      const retry = Promise.race([agent.whenIdle(), disposed]).then(async () => {
        stop()
        if (this.disposed || this.ctx.agents.get(agent.id) !== agent) return
        this.errors.delete(agent)
        await this.attach(agent)
        // A failed retry leaves the session unavailable, and wake() refuses that
        // state itself; this call only offers the retry's outcome to that guard.
        this.wake(agent)
      })
      // initialize() already recorded this failure; the handler only detaches the rejection.
      void this.track(retry).catch(() => {})
    }
  }
  /** Return diagnostics without exposing an unavailable snapshot as effective state. */
  status(agent: Agent): ExtensionSessionStatus {
    // An ungoverned agent reports why it has no session state at all, so a route
    // or panel can name the reason instead of reading a permanent "not ready".
    if (!this.governs(agent)) return { ready: false, revision: 0, recoverable: false, error: 'extension-session-ineligible' }
    const ready = !this.disposed && !this.unavailable.has(agent) && this.states.has(agent)
    const checkpoint = this.checkpoints.get(agent)
    const error = this.errors.get(agent)
    const selection = ready ? this.states.get(agent)?.selection : (checkpoint?.committed?.selection ?? checkpoint?.initial)
    // A capture that failed before recording anything leaves no recovery target.
    // That is the one case where an explicit recovery re-runs the capture itself;
    // every other failure keeps the durable-record rule.
    // Only an attempt that actually ran can be retried: a busy attach records an
    // error without ever reaching the capture, and its own retry owns that state.
    const captureOnly = selection === undefined && error !== undefined && this.captureSources.has(agent)
    return {
      ready,
      revision: checkpoint?.latest?.revision ?? 0,
      recoverable: !ready && !this.disposed && !this.initializing.has(agent) && (selection !== undefined || captureOnly) && error !== 'extension-session-corrupt',
      ...(error ? { error } : {}),
      ...(selection ? { selection: structuredClone(selection) } : {})
    }
  }
  read(agent: Agent): ExtensionSessionSnapshot | undefined {
    if (this.disposed || this.unavailable.has(agent)) throw failure('extension-session-not-ready')
    // An ungoverned agent never receives a selection, so every gate reading it
    // denies managed resources instead of falling back to an implicit allow.
    if (!this.governs(agent)) return undefined
    const state = this.states.get(agent)
    return state && structuredClone(state)
  }
  initialize(agent: Agent, source?: string, signal?: AbortSignal): Promise<void> {
    if (this.disposed) return Promise.reject(failure('extension-session-not-ready'))
    if (!this.governs(agent)) return Promise.reject(failure('extension-session-ineligible'))
    const pending = this.initializing.get(agent)
    if (pending) return pending
    if (this.states.has(agent) && !this.unavailable.has(agent)) return Promise.resolve()
    if (this.errors.has(agent)) return Promise.reject(failure(this.errors.get(agent)!))
    this.unavailable.add(agent)
    const operation = this.initializeOnce(agent, source, signal ?? this.lifetime.signal)
      .catch(error => {
        this.fail(agent, error)
        throw error
      })
      .finally(() => this.initializing.delete(agent))
    this.initializing.set(agent, operation)
    return operation
  }
  private async replay(agent: Agent): Promise<{ checkpoint: Checkpoint; nonempty: boolean }> {
    const observation = await this.ctx.sessionQuery.observeSession(agent.id, { projectionMode: 'none' })
    const checkpoint: Checkpoint = {}
    const seen = new Map<string, string>()
    try {
      for (const event of observation.events) {
        const messages = event.type === 'user/message' ? [event.data] : event.type === 'agent/inbox/spliced' ? event.data.inserted : []
        for (const message of messages) {
          if (message.source.kind === EXTENSION_INTENT_SOURCE) {
            let intent: Intent
            try {
              intent = intentSchema.parse(message.source.intent)
            } catch {
              throw failure('extension-session-corrupt')
            }
            const serializedIntent = JSON.stringify(intent)
            const previousIntent = seen.get(message.id)
            if (previousIntent !== undefined) {
              if (previousIntent !== serializedIntent) throw failure('extension-session-corrupt')
              continue
            }
            seen.set(message.id, serializedIntent)
            if (intent.ownerId !== agent.id) {
              // An inherited request belongs to the session that made it: a fork keeps
              // the committed selection and drops the request.
              if (event.seq >= observation.inheritedEventCount) throw failure('extension-session-corrupt')
              continue
            }
            // The log is read in order, so the last request written is the one that wins.
            checkpoint.intent = intent
            continue
          }
          if (message.source.kind !== EXTENSION_SESSION_SOURCE) continue
          let binding: Binding
          try {
            binding = bindingSchema.parse(message.source.binding)
          } catch {
            throw failure('extension-session-corrupt')
          }
          const serialized = JSON.stringify(binding)
          const previous = seen.get(message.id)
          if (previous !== undefined) {
            // A repeated identity is one envelope seen twice: the durable splice that
            // carried it, then the step that claimed it, and after a fork the copy
            // carries the owner that wrote it rather than this agent. Only the first
            // occurrence can testify about live ownership.
            if (previous !== serialized) throw failure('extension-session-corrupt')
            continue
          }
          if (event.seq >= observation.inheritedEventCount && binding.ownerId !== agent.id) throw failure('extension-session-corrupt')
          seen.set(message.id, serialized)
          const { latest, committed, initial } = checkpoint
          if (binding.phase === 'pending') {
            const nextRevision = latest?.ownerId === binding.ownerId ? latest.revision + 1 : 1
            if (binding.revision !== nextRevision) throw failure('extension-session-corrupt')
            if (binding.recoveryOf) {
              if (
                !latest ||
                binding.recoveryOf.ownerId !== latest.ownerId ||
                binding.recoveryOf.revision !== latest.revision ||
                JSON.stringify(binding.selection) !== JSON.stringify(committed?.selection ?? initial)
              )
                throw failure('extension-session-corrupt')
            } else if (latest?.phase === 'pending') throw failure('extension-session-corrupt')
            checkpoint.initial ??= binding.selection
          } else {
            if (!latest || latest.phase !== 'pending' || JSON.stringify({ ...latest, phase: 'committed' }) !== serialized) throw failure('extension-session-corrupt')
            checkpoint.committed = binding
            // A request written before the newest commit was superseded by it.
            checkpoint.intent = undefined
          }
          checkpoint.latest = binding
        }
      }
      return { checkpoint, nonempty: observation.events.some(event => event.type === 'user/message' || event.type === 'agent/inbox/spliced') }
    } finally {
      observation[Symbol.dispose]()
    }
  }
  /** Run one capture through the adapter and commit it as revision 1. */
  private async capture(agent: Agent, source: string | undefined, signal?: AbortSignal): Promise<void> {
    const selection = selectionSchema.parse(await this.ports.initialSelection(agent, source))
    const checkpoint = this.checkpoints.get(agent)!
    checkpoint.initial ??= selection
    await this.commit(agent, { revision: 1, selection }, signal)
  }
  private async initializeOnce(agent: Agent, source?: string, signal?: AbortSignal): Promise<void> {
    const { checkpoint, nonempty } = await this.replay(agent)
    this.checkpoints.set(agent, checkpoint)
    const { latest } = checkpoint
    if (latest?.phase === 'pending') throw failure('extension-session-incomplete')
    if (checkpoint.intent !== undefined) this.intents.set(agent, checkpoint.intent)
    if (latest?.ownerId === agent.id) {
      // Re-publishing a replayed committed selection is a transaction too: the
      // adapter may hand back a receipt, and an interruption before the state is
      // installed must undo whatever it applied.
      let receipt: ExtensionApplyReceipt | undefined
      let durable = false
      try {
        signal?.throwIfAborted()
        receipt = (await this.ports.applySelection(agent, structuredClone(latest.selection))) ?? undefined
        signal?.throwIfAborted()
        // Same order as the ordinary commit path: durability, then publish the effect,
        // then this service's own state, then the ready callback.
        durable = true
        receipt?.commit()
        this.states.set(agent, { revision: latest.revision, selection: latest.selection })
        this.unavailable.delete(agent)
        this.errors.delete(agent)
        this.ports.committed?.(agent)
        if (this.intents.has(agent)) this.promoteAfterIdle(agent)
      } catch (error) {
        // Fail closed before unwinding: the restore path may not have marked the
        // agent unavailable yet, and gates must deny while the undo is in flight.
        this.fail(agent, error)
        await this.rollbackApplied(receipt, durable)
        throw error
      }
      return
    }
    if (latest?.selection !== undefined) {
      const replayed = selectionSchema.parse(latest.selection)
      // Re-applying keeps the published revision, so a client that cached it can
      // still compare against it after an attach.
      checkpoint.initial ??= replayed
      await this.commit(agent, { revision: 1, selection: replayed }, signal)
      return
    }
    // Remember which classification this attempt used: input parked while the
    // attempt runs makes the log nonempty, and a later explicit recovery must not
    // read that as pre-existing history and capture legacy defaults instead.
    const legacy = nonempty || source === 'resume' || source === 'legacy'
    const captureSource = legacy ? 'legacy' : source
    this.captureSources.set(agent, captureSource)
    await this.capture(agent, captureSource, signal)
  }
  /**
   * Recover only the validated last committed choice, or the original initial attempt.
   *
   * Never recapture defaults, with one exception: a capture that failed before it
   * recorded anything has no record to protect, so an explicit recovery re-runs that
   * capture with the classification the original attempt used.
   */
  recover(agent: Agent, expectedRevision: number): Promise<ExtensionSessionSnapshot> {
    return this.maintenance(agent, async signal => {
      const status = this.status(agent)
      if (status.ready || status.revision !== expectedRevision) throw failure('extension-session-conflict')
      if (!status.recoverable) throw failure(status.error ?? 'extension-session-not-ready')
      try {
        const { checkpoint } = await this.replay(agent)
        const latest = checkpoint.latest
        if ((latest?.revision ?? 0) !== expectedRevision) throw failure('extension-session-conflict')
        const selection = checkpoint.committed?.selection ?? checkpoint.initial ?? this.checkpoints.get(agent)?.initial
        if (!selection) {
          // Nothing durable records the failed attempt, so retrying the capture
          // itself loses nothing. Only an explicit recovery reaches this branch, a
          // repeated failure records again, and the next attempt waits for the next
          // call — this service never schedules a retry of its own.
          if (latest !== undefined || checkpoint.committed !== undefined || checkpoint.initial !== undefined) throw failure('extension-session-not-ready')
          // Publish the replayed checkpoint before the capture records into it: the
          // capture path amends the entry this map holds for the agent.
          this.checkpoints.set(agent, checkpoint)
          await this.capture(agent, this.captureSources.get(agent), signal)
          const captured = this.states.get(agent)
          if (captured === undefined) throw failure('extension-session-not-ready')
          this.wake(agent)
          return structuredClone(captured)
        }
        this.checkpoints.set(agent, checkpoint)
        const revision = latest?.ownerId === agent.id ? latest.revision + 1 : 1
        if (!Number.isSafeInteger(revision)) throw failure('extension-session-conflict')
        const next = { revision, selection: structuredClone(selection) }
        signal.throwIfAborted()
        await this.commit(agent, next, signal, latest && { ownerId: latest.ownerId, revision: latest.revision })
        this.wake(agent)
        return structuredClone(next)
      } catch (error) {
        this.fail(agent, error)
        throw error
      }
    })
  }
  async change(agent: Agent, expectedRevision: number, selection: ExtensionSelection, requestRevision?: number): Promise<ExtensionSessionSnapshot> {
    const captured = selectionSchema.parse(selection)
    return this.maintenance(agent, async signal => {
      await this.initialize(agent, undefined, signal)
      const current = this.read(agent)
      if (!current || current.revision !== expectedRevision) throw failure('extension-session-conflict')
      const next = { revision: current.revision + 1, selection: captured }
      if (!Number.isSafeInteger(next.revision)) throw failure('extension-session-conflict')
      signal.throwIfAborted()
      this.unavailable.add(agent)
      await this.commit(agent, next, signal, undefined, requestRevision)
      return structuredClone(next)
    })
  }
  /**
   * Accept one selection request.
   *
   * An idle agent commits immediately through the ordinary transaction. While a
   * turn owns the agent the request is only written durably: the effective
   * selection, every gate and every mount keep reading the committed snapshot
   * until a safe boundary promotes it, so nothing is staged or swapped while the
   * current turn's tools are live.
   * @param agent - the agent the selection belongs to.
   * @param expectedRevision - the revision the caller believes is current: the committed revision or the pending request's revision.
   * @param selection - the requested selection.
   * @returns whether it applied now, and the revision a caller compares against next.
   */
  async requestSelection(agent: Agent, expectedRevision: number, selection: ExtensionSelection): Promise<{ applied: boolean; revision: number }> {
    const captured = selectionSchema.parse(selection)
    // Requests and promotions run one at a time per agent, so two callers cannot
    // both read the same base and lose one another's write. The tracked promise
    // keeps disposal waiting for a request that is still writing.
    return this.track(
      this.serialize(agent, async () => {
        if (this.disposed) throw failure('extension-session-not-ready')
        // A session that is not ready authorizes nothing, even when an older snapshot
        // still sits in memory: accepting a change there would write against a
        // selection the gates refuse to use.
        if (!this.status(agent).ready) throw failure('extension-session-not-ready')
        const committed = this.states.get(agent)!.revision
        // Latest request wins. Once a request is pending only its own revision
        // compares, so a caller that never saw it cannot overwrite it, and each
        // request carries a revision of its own rather than repeating one.
        if (expectedRevision !== this.selectionRevision(agent)) throw failure('extension-session-conflict')
        const revision = this.selectionRevision(agent) + 1
        if (!Number.isSafeInteger(revision)) throw failure('extension-session-conflict')
        if (this.isIdle(agent)) {
          // Nothing is in flight, so this request is the selection: a pending request
          // it supersedes is dropped instead of being promoted over it later.
          try {
            await this.change(agent, committed, captured, revision)
            this.intents.delete(agent)
            this.intentTurns.delete(agent)
            return { applied: true, revision }
          } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'extension-session-busy') throw error
          }
        }
        const intent: Intent = { ownerId: agent.id, revision, selection: captured }
        await this.persistIntent(agent, intent)
        this.lifetime.signal.throwIfAborted()
        if (this.ctx.agents.get(agent.id) !== agent) throw failure('extension-session-not-ready')
        this.intents.set(agent, intent)
        // The turn is not part of the durable record: turn numbering is per attached
        // lifecycle, so a replayed request must not answer to a number from a past one.
        this.intentTurns.set(agent, this.currentTurns.get(agent))
        // The agent can leave its turn while the write is in flight. An idle session
        // has no later boundary to wait for, so the promote is scheduled here.
        if (this.isIdle(agent)) this.promoteAfterIdle(agent)
        return { applied: false, revision }
      })
    )
  }
  /** Public compare-and-swap token, independent of the sequential binding journal. */
  selectionRevision(agent: Agent): number {
    const committed = this.checkpoints.get(agent)?.committed
    return this.intents.get(agent)?.revision ?? (committed?.ownerId === agent.id ? (committed.requestRevision ?? committed.revision) : this.states.get(agent)?.revision) ?? 0
  }
  /** The pending request, for a caller that shows the intended selection. */
  intended(agent: Agent): { selection: ExtensionSelection; revision: number } | undefined {
    const intent = this.intents.get(agent)
    return intent === undefined ? undefined : { selection: structuredClone(intent.selection), revision: intent.revision }
  }
  /**
   * Make the pending request effective: durable request first, then the effect,
   * then the committed twin and the published snapshot, exactly like a change.
   * Single-flight per agent, so one boundary promotes once.
   * @param agent - the agent whose pending request becomes effective.
   */
  async promote(agent: Agent): Promise<void> {
    if (this.disposed || !this.governs(agent)) return
    const inFlight = this.promoting.get(agent)
    if (inFlight !== undefined) return inFlight
    const operation = this.track(this.serialize(agent, () => this.promoteNow(agent)))
    this.promoting.set(agent, operation)
    try {
      await operation
    } finally {
      if (this.promoting.get(agent) === operation) this.promoting.delete(agent)
    }
  }
  private async promoteNow(agent: Agent): Promise<void> {
    const intent = this.intents.get(agent)
    const current = this.states.get(agent)
    if (this.disposed || !this.status(agent).ready || intent === undefined || current === undefined) return
    try {
      this.intents.delete(agent)
      this.intentTurns.delete(agent)
      this.unavailable.add(agent)
      await this.commit(agent, { revision: current.revision + 1, selection: structuredClone(intent.selection) }, this.lifetime.signal, undefined, intent.revision)
    } catch (error) {
      // The durable request stays in the log; the service denies and lets explicit
      // recovery decide. It never retries on its own.
      this.fail(agent, error)
      throw error
    }
  }
  /**
   * Promote from the idle phase, for a turn that never reached a clean stop and a
   * request that raced the boundary. Re-wakes parked input so the same request
   * re-runs under the promoted selection.
   */
  private promoteAfterIdle(agent: Agent): void {
    if (this.disposed || this.intents.get(agent) === undefined) return
    const signal = this.lifetime.signal
    let stop = () => {}
    const disposed = new Promise<void>(resolve => {
      if (signal.aborted) {
        resolve()
        return
      }
      const onAbort = () => resolve()
      signal.addEventListener('abort', onAbort, { once: true })
      stop = () => signal.removeEventListener('abort', onAbort)
    })
    const settled = Promise.race([agent.whenIdle(), disposed]).then(async () => {
      stop()
      if (this.disposed || !this.status(agent).ready || !this.intents.has(agent) || this.ctx.agents.get(agent.id) !== agent) return
      try {
        await this.maintenance(agent, () => this.promote(agent))
      } catch {
        // Busy again: the next clean stop owns the request.
        return
      }
      this.wake(agent)
    })
    void this.track(settled).catch(() => {})
  }
  /**
   * Whether the host reports this agent idle. The call keeps the answer opaque to
   * control-flow narrowing, which a direct property comparison cannot.
   */
  private isIdle(agent: Agent): boolean {
    return agent.status === 'idle'
  }
  /**
   * Run one task at a time per agent. Each task starts after the previous settled,
   * whether it succeeded or failed, so a rejected write never blocks the next one.
   */
  private serialize<T>(agent: Agent, task: () => Promise<T>): Promise<T> {
    const previous = this.requests.get(agent) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.requests.set(
      agent,
      next.then(
        () => undefined,
        () => undefined
      )
    )
    return next
  }
  private async persistIntent(agent: Agent, intent: Intent): Promise<void> {
    const message = createUserMessage({
      source: { kind: EXTENSION_INTENT_SOURCE, form: 'context', intent },
      content: [{ type: 'text', text: 'Session extension selection request.' }]
    })
    agent.inject(message)
    // The insertion is durable evidence; no pending message must prevent the host's turn-stopping boundary.
    agent.inbox.remove(message.id)
    if (!(await this.ctx.sessions.flush(agent.session))) throw failure('extension-session-persistence-unavailable')
  }
  private maintenance<T>(agent: Agent, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(failure('extension-session-not-ready'))
    let operation: Promise<T>
    try {
      operation = agent.runMaintenance(task)
    } catch {
      return Promise.reject(failure('extension-session-busy'))
    }
    return this.track(operation)
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation)
    void operation.then(
      () => this.operations.delete(operation),
      () => this.operations.delete(operation)
    )
    return operation
  }
  /**
   * Start the driver for input stranded while this service denied the session.
   *
   * The stranded messages are already queued, so the wake carries no payload: the
   * marker is plugin metadata the same pre-step guard filters, and `steer` is the
   * published way to start a driver without cancelling live work (published
   * semantics: a wake during maintenance latches and replays at convergence).
   * Callers run it only after a committed recovery or a successful busy retry, and
   * this guard makes that common: an unavailable or disposed session must never
   * open a turn, so the check here is the single place that decides.
   */
  private wake(agent: Agent): void {
    if (this.disposed || !this.status(agent).ready) return
    // Only an ordinary human request wakes a driver. The inbox decides rather than
    // this instance's memory, because a host reload rebuilds queued input from the
    // log. An absent context form is the opaque default, not evidence of authorship,
    // so injected context from any producer waits for the user's next request
    // instead. This is deliberately narrower than the historical progress
    // classification: it decides whether to start new work, which the progress
    // field never did.
    const stranded = [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.source.kind === 'user')
    if (!stranded) return
    agent.steer(
      createUserMessage({
        source: { kind: EXTENSION_SESSION_WAKE_SOURCE, form: 'context' },
        content: [{ type: 'text', text: 'Session extension readiness restored.' }]
      })
    )
  }
  private fail(agent: Agent, error: unknown): void {
    // Fail-closed covers governed agents only: an ungoverned agent keeps its
    // host lifecycle, so a failed capture must never cancel it.
    if (!this.governs(agent)) return
    this.unavailable.add(agent)
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'extension-session-apply-failed'
    this.errors.set(agent, code)
    agent.cancel({ kind: 'disposed' }, { keepInbox: true })
  }
  private async persist(agent: Agent, binding: Binding): Promise<void> {
    agent.inject(
      createUserMessage({
        source: { kind: EXTENSION_SESSION_SOURCE, form: 'context', binding: structuredClone(binding) },
        content: [{ type: 'text', text: 'Session extension selection metadata.' }]
      })
    )
    this.checkpoints.get(agent)!.latest = binding
    if (!(await this.ctx.sessions.flush(agent.session))) throw failure('extension-session-persistence-unavailable')
  }
  private async commit(agent: Agent, state: ExtensionSessionSnapshot, signal?: AbortSignal, recoveryOf?: Binding['recoveryOf'], requestRevision?: number): Promise<void> {
    const previous = this.checkpoints.get(agent)?.latest
    const token = requestRevision ?? Math.max(state.revision, previous?.ownerId === agent.id ? (previous.requestRevision ?? 0) + 1 : 1)
    if (!Number.isSafeInteger(token)) throw failure('extension-session-conflict')
    const binding: Binding = {
      version: 1,
      ownerId: agent.id,
      phase: 'pending',
      ...structuredClone(state),
      ...(token === state.revision ? {} : { requestRevision: token }),
      ...(recoveryOf ? { recoveryOf } : {})
    }
    const checkpoint = this.checkpoints.get(agent)!
    checkpoint.initial ??= structuredClone(state.selection)
    let receipt: ExtensionApplyReceipt | undefined
    // Durability is the point of no return: past it the receipt must publish, never
    // roll back, so a throwing committed callback cannot undo an acknowledged write.
    let durable = false
    try {
      await this.persist(agent, binding)
      signal?.throwIfAborted()
      receipt = (await this.ports.applySelection(agent, structuredClone(state.selection))) ?? undefined
      signal?.throwIfAborted()
      const committed: Binding = { ...binding, phase: 'committed' }
      await this.persist(agent, committed)
      durable = true
      checkpoint.committed = committed
      // Publish before this service's own state lands, so an effect that must be
      // visible alongside the selection is in place by the time gates read it.
      receipt?.commit()
      this.states.set(agent, structuredClone(state))
      this.unavailable.delete(agent)
      this.errors.delete(agent)
      this.ports.committed?.(agent)
    } catch (error) {
      // Disk writes and resource effects have no shared transaction. Never acknowledge an
      // uncertain write: deny first, then undo, and let the original error be the outcome.
      this.fail(agent, error)
      await this.rollbackApplied(receipt, durable)
      throw error
    }
  }
  /**
   * Undo an applied-but-not-durable effect. A cleanup failure is reported as a
   * diagnostic: the original error is what the caller acts on, so it is never
   * replaced by whatever went wrong while unwinding.
   */
  private async rollbackApplied(receipt: ExtensionApplyReceipt | undefined, durable: boolean): Promise<void> {
    if (receipt === undefined || durable) return
    try {
      await receipt.rollback()
    } catch (error) {
      this.ctx.logger.warn('extension selection rollback failed: ' + String(error))
    }
  }
  dispose(): Promise<void> {
    return (this.disposal ??= this.finishDisposal())
  }
  private async finishDisposal(): Promise<void> {
    this.disposed = true
    this.lifetime.abort()
    await Promise.allSettled([...this.initializing.values(), ...this.operations])
    for (const off of this.off.splice(0)) off()
    this.captureSources.clear()
    this.intents.clear()
    this.promoting.clear()
    this.intentTurns.clear()
    this.currentTurns.clear()
    this.requests.clear()
    this.states.clear()
    // Everything still pending was awaited above, so a disposed service keeps no
    // per-agent bookkeeping: not a checkpoint, an error, an unavailable mark, an
    // in-flight initialization, or a tracked operation.
    this.checkpoints.clear()
    this.errors.clear()
    this.unavailable.clear()
    this.initializing.clear()
    this.operations.clear()
  }
}
