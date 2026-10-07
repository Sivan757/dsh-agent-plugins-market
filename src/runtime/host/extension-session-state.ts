import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import '@deepseek-ai/dsh-session-query'
import { z } from 'zod'
import { parseExtensionIds, type ExtensionSelection } from '../../contracts/extension-presets.js'

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
    selection: selectionSchema,
    recoveryOf: z
      .object({ ownerId: z.string().min(1), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })
      .strict()
      .optional()
  })
  .strict()
type Binding = z.infer<typeof bindingSchema>
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'market-extension-selection': { kind: 'market-extension-selection'; form: 'context'; binding: Binding }
  }
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
        if (this.status(event.agent).ready) {
          // The envelope's durable record is its inbox splice; the claimed copy is
          // filtered out before it can enter a request as placeholder user text.
          const decision = await next()
          if (decision.kind !== 'enter') return decision
          return { ...decision, messages: decision.messages.filter(message => message.source.kind !== EXTENSION_SESSION_SOURCE) }
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
      ctx.on('agent/disposed', ({ agent }) => {
        this.states.delete(agent)
        this.checkpoints.delete(agent)
        this.errors.delete(agent)
        this.unavailable.delete(agent)
        this.initializing.delete(agent)
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
    return {
      ready,
      revision: checkpoint?.latest?.revision ?? 0,
      recoverable: !ready && !this.disposed && !this.initializing.has(agent) && !!selection && error !== 'extension-session-corrupt',
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
          }
          checkpoint.latest = binding
        }
      }
      return { checkpoint, nonempty: observation.events.some(event => event.type === 'user/message' || event.type === 'agent/inbox/spliced') }
    } finally {
      observation[Symbol.dispose]()
    }
  }
  private async initializeOnce(agent: Agent, source?: string, signal?: AbortSignal): Promise<void> {
    const { checkpoint, nonempty } = await this.replay(agent)
    this.checkpoints.set(agent, checkpoint)
    const { latest } = checkpoint
    if (latest?.phase === 'pending') throw failure('extension-session-incomplete')
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
      } catch (error) {
        // Fail closed before unwinding: the restore path may not have marked the
        // agent unavailable yet, and gates must deny while the undo is in flight.
        this.fail(agent, error)
        await this.rollbackApplied(receipt, durable)
        throw error
      }
      return
    }
    const legacy = nonempty || source === 'resume' || source === 'legacy'
    const selection = selectionSchema.parse(latest?.selection ?? (await this.ports.initialSelection(agent, legacy ? 'legacy' : source)))
    checkpoint.initial ??= selection
    await this.commit(agent, { revision: 1, selection }, signal)
  }
  /** Recover only the validated last committed choice, or the original initial attempt. Never recapture defaults. */
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
        if (!selection) throw failure('extension-session-not-ready')
        this.checkpoints.set(agent, checkpoint)
        const revision = latest?.ownerId === agent.id ? latest.revision + 1 : 1
        if (!Number.isSafeInteger(revision)) throw failure('extension-session-conflict')
        const next = { revision, selection: structuredClone(selection) }
        signal.throwIfAborted()
        await this.commit(agent, next, signal, latest && { ownerId: latest.ownerId, revision: latest.revision })
        return structuredClone(next)
      } catch (error) {
        this.fail(agent, error)
        throw error
      }
    })
  }
  async change(agent: Agent, expectedRevision: number, selection: ExtensionSelection): Promise<ExtensionSessionSnapshot> {
    const captured = selectionSchema.parse(selection)
    return this.maintenance(agent, async signal => {
      await this.initialize(agent, undefined, signal)
      const current = this.read(agent)
      if (!current || current.revision !== expectedRevision) throw failure('extension-session-conflict')
      const next = { revision: current.revision + 1, selection: captured }
      if (!Number.isSafeInteger(next.revision)) throw failure('extension-session-conflict')
      signal.throwIfAborted()
      this.unavailable.add(agent)
      await this.commit(agent, next, signal)
      return structuredClone(next)
    })
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
  private async commit(agent: Agent, state: ExtensionSessionSnapshot, signal?: AbortSignal, recoveryOf?: Binding['recoveryOf']): Promise<void> {
    const binding: Binding = { version: 1, ownerId: agent.id, phase: 'pending', ...structuredClone(state), ...(recoveryOf ? { recoveryOf } : {}) }
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
    this.states.clear()
  }
}
