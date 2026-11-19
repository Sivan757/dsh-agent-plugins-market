/** Session-addressed preset operations; only acknowledged session changes replace live contributions. */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ExtensionPresetStore, ExtensionPresetError } from '../../application/state/extension-presets.js'
import { loadResourceFilters } from '../../application/state/resource-filters.js'
import { extensionResourceEnabled } from '../../application/extension-authorization.js'
import {
  CONFIGURATION_PARENT_IDS,
  captureExtensionSelection,
  type ExtensionResource,
  type ExtensionSelection,
  type ExtensionPresetInput,
  type ExtensionWindowPayload,
  type ExtensionHooksOverview,
  type ExtensionHookRunInput,
  type ExtensionHookRunResult
} from '../../../../market-contracts/src/contracts/extension-presets.js'
import type { ExtensionRouteService } from '../../extension-service.js'
import { ExtensionSessionState, type ExtensionApplyReceipt } from './extension-session-state.js'
import type { ExtensionToolDenialReason } from './extension-tool-gates.js'
import { ExtensionProgressReader } from './extension-progress.js'
import { extensionSelectionProjection, type ExtensionSelectionView } from './extension-selection-projection.js'
import { SessionProjectionReader } from './projection-reader.js'
import { DEFAULT_INVENTORY_RETRY, inventoryRetryDelay, type InventoryRetryPolicy } from './inventory-retry.js'

export interface ExtensionRuntimePorts {
  dataRoot: string
  /**
   * Schedule for re-reading one session's inventory after a postponed or failed
   * refresh. Omitted keeps {@link DEFAULT_INVENTORY_RETRY}; the composition root
   * resolves the configured values and passes them here.
   */
  inventoryRetry?: InventoryRetryPolicy
  inventory(agent: Agent): Promise<ExtensionResource[]>
  applySelection(agent: Agent, selection: ExtensionSelection): Promise<void | ExtensionApplyReceipt>
  /** Whether this service governs one agent at all; absent governs every agent. */
  eligible?(agent: Agent): boolean
  ready?(agent: Agent, source?: string): Promise<void>
  committed?(agent: Agent): void
  /** The sessionless Hooks overview the settings workspace renders; hook declarations belong to the user, not to a session. */
  hooksOverview?(): Promise<ExtensionHooksOverview>
  /** Run one declared command hook as a dry run; the composition resolves the declaration and owns the shell. */
  hookRun?(input: ExtensionHookRunInput): Promise<ExtensionHookRunResult>
  /**
   * Select one output style for the session's workspace.
   *
   * An output style is a single choice rather than a set of switches, so it cannot ride
   * the surface selection the way a capability does: a preset that names one needs this
   * call to take effect. Absent leaves the style where it is.
   */
  applyOutputStyle?(agent: Agent, styleId: string): Promise<void>
}
function failure(code: string): Error {
  return Object.assign(new Error(code), { code })
}
/** Whether two selections name the same ids, whatever their order. */
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const seen = new Set(left)
  return right.every(id => seen.has(id))
}
export function extensionWorkspace(agent: Agent): string {
  const cwd = agent.session.header.cwd
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw failure('extension-workspace-unavailable')
  return cwd
}

/**
 * The host seam that turns one persisted session into a live agent.
 *
 * Every agent-bound read and write the host serves goes through it, so a
 * session-scoped control answers from the same place instead of asking the
 * person to start a turn before the control works.
 */
interface SessionAgentActivator {
  resolveAgent(sessionId: SessionId): Promise<{ agent?: Agent; error?: { code?: string; message?: string } }>
}
/**
 * How long one failed activation is remembered.
 *
 * The panel polls, so a session that cannot be activated right now (another
 * process holds its writer, for example) must cost one seam call per window
 * rather than one per read.
 */
const ACTIVATION_RETRY_MS = 10_000

export class ExtensionRuntime implements ExtensionRouteService {
  readonly state: ExtensionSessionState
  private readonly store: ExtensionPresetStore
  /** Folded session progress; the log scan is only the no-registry fallback. */
  private readonly progress: ExtensionProgressReader
  /** The committed selection the composer chip renders, folded by the host for the client. */
  private readonly selection: SessionProjectionReader<'marketExtensionSelection', ExtensionSelectionView>
  private readonly resources = new Map<Agent, ExtensionResource[]>()
  /** Agents whose cached inventory predates the current catalog; authorization fails closed until re-read. */
  private readonly stale = new Set<Agent>()
  /** Bumped on every catalog change: a read that began earlier may not publish its answer. */
  private epoch = 0
  private readonly dirty = new Set<Agent>()
  /** Eligible inventory at the last successful rebuild; selection and current availability still gate every call. */
  private readonly registeredIds = new Map<Agent, Set<string>>()
  private readonly appliedEpochs = new Map<Agent, number>()
  private readonly refreshing = new Map<Agent, Promise<void>>()
  /** Activations in flight, so two reads of one session share a single resume. */
  private readonly activating = new Map<string, Promise<Agent>>()
  /** The last activation failure per session; a failed resume is retried once per window, not once per poll. */
  private readonly activationFailures = new Map<string, { at: number; error: Error }>()
  private readonly lifetime = new AbortController()
  private disposed = false
  /** Per-agent read sequence: a slow earlier response must not overwrite a newer inventory. */
  private readonly reads = new Map<Agent, number>()
  private readonly targets = new Map<Agent, ExtensionSelection>()
  /** Retries armed for an agent whose refresh could not finish yet. */
  private readonly retries = new Map<Agent, ReturnType<typeof setTimeout>>()
  private readonly retryAttempts = new Map<Agent, number>()
  /** Agents already reported as being on the slow schedule. */
  private readonly retryWarned = new Set<Agent>()
  private readonly retry: InventoryRetryPolicy
  private readonly off: Array<() => void> = []
  constructor(
    private readonly ctx: Context,
    private readonly ports: ExtensionRuntimePorts
  ) {
    this.retry = ports.inventoryRetry ?? DEFAULT_INVENTORY_RETRY
    this.store = new ExtensionPresetStore(ports.dataRoot)
    this.progress = new ExtensionProgressReader(ctx)
    this.selection = new SessionProjectionReader(ctx, extensionSelectionProjection, 'dsh-agent-plugins-market: extension selection projection')
    this.state = new ExtensionSessionState(ctx, {
      ...(ports.eligible === undefined ? {} : { eligible: (agent: Agent) => ports.eligible?.(agent) === true }),
      initialSelection: (agent, source) => this.initialSelection(agent, source),
      committed: agent => {
        if (this.appliedEpochs.get(agent) === this.epoch) this.dirty.delete(agent)
        try {
          ports.committed?.(agent)
        } catch (error) {
          this.dirty.add(agent)
          throw error
        }
      },
      applySelection: async (agent, selection) => {
        const epoch = this.epoch
        await this.refreshInventory(agent)
        this.targets.set(agent, selection)
        try {
          const receipt = await ports.applySelection(agent, selection)
          if (!this.stale.has(agent) && epoch === this.epoch) {
            this.appliedEpochs.set(agent, epoch)
            this.registeredIds.set(agent, this.availableIds(agent))
          }
          return receipt
        } finally {
          this.targets.delete(agent)
        }
      }
    })
    this.off.push(
      ctx.on('agent/created', async ({ agent, source }) => {
        await ports.ready?.(agent, source)
      })
    )
    this.off.push(
      ctx.on('agent/disposed', ({ agent }) => {
        this.resources.delete(agent)
        this.targets.delete(agent)
        this.dirty.delete(agent)
        this.stale.delete(agent)
        this.reads.delete(agent)
        this.registeredIds.delete(agent)
        this.appliedEpochs.delete(agent)
        this.cancelRetry(agent)
      })
    )
  }
  async start(): Promise<void> {
    await this.state.start()
    for (const agent of this.ctx.agents.list()) await this.ports.ready?.(agent, 'legacy')
  }
  ready(agent: Agent): boolean {
    try {
      return this.state.read(agent) !== undefined
    } catch {
      return false
    }
  }
  /**
   * Why one agent's managed capabilities are denied right now, if they are.
   *
   * A stale agent, a session that has not published its selection yet and a
   * withdrawn resource produce the same model-facing failure, so the status
   * surface needs the difference: the first two are transient, the third is
   * not.
   * @param agent - the agent to describe.
   * @returns the reason one of its capabilities is denied, or undefined.
   */
  denialReason(agent: Agent): ExtensionToolDenialReason | undefined {
    if (this.stale.has(agent)) return 'extension-inventory-pending'
    // A session that has no selection yet denies every managed capability while
    // it attaches. The denial is transient, so the model is told to retry
    // rather than to ask the user to enable a resource the user already chose.
    const status = this.state.status(agent)
    if (!status.ready && status.error === undefined) return 'extension-selection-pending'
    return undefined
  }
  allows(agent: Agent, resourceId: string, suiteId?: string): boolean {
    if (this.stale.has(agent)) return false
    if (this.dirty.has(agent) && !this.registeredIds.get(agent)?.has(resourceId)) return false
    try {
      const snapshot = this.state.read(agent)
      return snapshot !== undefined && this.selected(agent, snapshot.selection, resourceId, suiteId)
    } catch {
      return false
    }
  }
  private availableIds(agent: Agent): Set<string> {
    return new Set((this.resources.get(agent) ?? []).filter(row => row.available && row.control !== 'global-only').map(row => row.id))
  }
  /**
   * The selection a default capture follows the catalog to.
   *
   * A selection that names no preset is the global switch set, read as ids, and a snapshot
   * cannot contain a resource that did not exist when it was taken. The rows the catalog
   * offers now join it, so a suite or a skill installed mid-session is granted, injected
   * and shown without a manual preset switch.
   *
   * The same reading removes what the switches turned off: a capture that predates a
   * global disable stops naming the row instead of carrying it forever, so the session
   * stops running it and the panel stops showing it as selected. A row the inventory has
   * not read is not a row the catalog withdrew, so an id the catalog does not list stays:
   * a partial read must never shrink a selection on its own.
   *
   * A preset selection is the preset's own list and never moves, and a capture taken from
   * the pre-preset resource filters is frozen: those filters were the person's own switches.
   */
  private followingSelection(agent: Agent, selection: ExtensionSelection): ExtensionSelection {
    if (selection.presetId !== null || selection.frozen === true) return selection
    const resources = this.resources.get(agent) ?? []
    const usable = (row: { available?: boolean; control?: string; globalEnabled?: boolean }): boolean =>
      row.available !== false && row.control !== 'global-only' && row.globalEnabled !== false
    const read = new Map(resources.map(row => [row.id, row]))
    const kept = selection.enabledIds.filter(id => {
      const row = read.get(id)
      return row === undefined || usable(row)
    })
    const keptIds = new Set(kept)
    const added = resources.filter(row => usable(row) && !keptIds.has(row.id)).map(row => row.id)
    return { ...selection, enabledIds: [...kept, ...added] }
  }

  /** Registration alone may inspect a pending target; execution must call allows. */
  registrationAllows(agent: Agent, resourceId: string, suiteId?: string): boolean {
    if (this.stale.has(agent)) return false
    const target = this.targets.get(agent)
    return target === undefined ? this.allows(agent, resourceId, suiteId) : this.selected(agent, target, resourceId, suiteId)
  }
  private selected(agent: Agent, selection: ExtensionSelection, resourceId: string, suiteId?: string): boolean {
    const resources = this.resources.get(agent) ?? []
    const row = resources.find(resource => resource.id === resourceId)
    // A capture is the global switch set, so it grants nothing the catalog has
    // switched off since it was taken. The next catalog read prunes the id; this
    // is what makes the switch true in between, including on the resume that
    // applies a committed capture before any read has run.
    const options = { capture: selection.presetId === null && selection.frozen !== true }
    // A configuration parent publishes no row anywhere: the hooks bridge and the
    // mount filter still address it by its suite id, so the grant is derived from
    // the children it owns, exactly as extensionResourceEnabled derives it for a
    // parent row that does exist.
    if (row === undefined) {
      if (!CONFIGURATION_PARENT_IDS.has(resourceId)) return false
      return resources.some(child => child.suiteResourceId === resourceId && extensionResourceEnabled(child, selection, resources, options))
    }
    // The caller names the suite with a bare 'source/suite' while the selection
    // holds 'market:source/suite' resource ids, and extensionResourceEnabled
    // already requires the authoritative parent (suiteResourceId) to be selected
    // and available. Comparing the caller's suiteId here could only ever deny a
    // granted call, so the argument is deliberately not consulted.
    void suiteId
    return extensionResourceEnabled(row, selection, resources, options)
  }
  /**
   * A catalog change can revoke a global resource at any moment, so every live
   * agent's cached inventory is dropped and authorization denies until the
   * inventory has been re-read from the new catalog. Callers never wait for a
   * panel poll to observe a disable or uninstall.
   */
  invalidate(): void {
    this.epoch += 1
    for (const agent of this.ctx.agents.list()) {
      if (this.ports.eligible?.(agent) === false) continue
      this.stale.add(agent)
      this.dirty.add(agent)
    }
  }
  /** Re-read every live agent's inventory; an agent whose read fails stays denied. */
  async refreshAll(): Promise<void> {
    await Promise.all(
      this.ctx.agents
        .list()
        .filter(agent => this.ports.eligible?.(agent) !== false)
        .map(agent => this.refreshAgent(agent))
    )
  }
  /**
   * Arm the next retry for an agent whose refresh could not complete.
   *
   * The fail-closed window is correct while a catalog read is pending, but it
   * must not be permanent: `refreshAgent` bails for a session that is still
   * attaching and for one whose inventory read failed, and nothing else would
   * come back for an idle agent. The retry is what closes the window, and it
   * keeps closing it, slowing to the resolved ceiling rather than stopping. A
   * schedule that gave up would reintroduce the same permanent denial later.
   */
  private scheduleRetry(agent: Agent): void {
    if (this.disposed || this.retries.has(agent) || !this.dirty.has(agent)) return
    const attempt = this.retryAttempts.get(agent) ?? 0
    this.retryAttempts.set(agent, attempt + 1)
    const delay = inventoryRetryDelay(this.retry, attempt)
    if (delay >= this.retry.maxMs) this.warnSlowRetry(agent, delay)
    const timer = setTimeout(() => {
      this.retries.delete(agent)
      if (this.disposed || this.ctx.agents.get(agent.id) !== agent) return
      void this.refreshAgent(agent).catch(error => this.ctx.logger?.warn('extension refresh retry: ' + String(error)))
    }, delay)
    timer.unref?.()
    this.retries.set(agent, timer)
  }

  /**
   * Say once, per agent, that its inventory read is now on the slow schedule.
   *
   * A person reading the log needs to know the retry is still armed and slow,
   * not that it stopped. Repeating it every attempt would bury the first line.
   */
  private warnSlowRetry(agent: Agent, delayMs: number): void {
    if (this.retryWarned.has(agent)) return
    this.retryWarned.add(agent)
    this.ctx.logger?.warn(
      `[dsh-agent-plugins-market] session ${agent.id}: extension inventory is still unreadable; managed capabilities stay denied while it is retried every ${String(delayMs)}ms`
    )
  }

  /** Drop a pending retry and its attempt budget. */
  private cancelRetry(agent: Agent): void {
    const timer = this.retries.get(agent)
    if (timer !== undefined) clearTimeout(timer)
    this.retries.delete(agent)
    this.retryAttempts.delete(agent)
    this.retryWarned.delete(agent)
  }

  private async refreshAgent(agent: Agent): Promise<void> {
    if (this.disposed || !this.dirty.has(agent) || this.refreshing.has(agent)) return
    /** The selection the catalog asked for, committed once the maintenance slot is free. */
    let follow: ExtensionSelection | undefined
    const work = async (): Promise<void> => {
      const epoch = this.epoch
      await agent.runMaintenance(async signal => {
        const snapshot = this.state.status(agent)
        // A session that is still attaching can neither be refreshed nor called
        // ready. Leaving it dirty with no schedule is the permanent denial this
        // retry exists to prevent.
        if (!snapshot.ready || !snapshot.selection) {
          this.scheduleRetry(agent)
          return
        }
        await this.refreshInventory(agent)
        signal.throwIfAborted()
        if (this.stale.has(agent)) {
          // The epoch moved during the read, so this answer may not publish.
          // Another pass will follow, and this retry covers an idle agent.
          this.scheduleRetry(agent)
          return
        }
        // A default capture follows the catalog: the rows it gained join the selection and
        // the rows it switched off leave it. The commit that follows grants, injects and
        // shows the result in one step, and it runs outside this maintenance block: a
        // commit inside it would wait for the very maintenance it is running in.
        const followed = this.followingSelection(agent, snapshot.selection)
        if (!sameIds(followed.enabledIds, snapshot.selection.enabledIds)) {
          follow = followed
          return
        }
        const selection = snapshot.selection
        this.targets.set(agent, selection)
        let receipt: void | ExtensionApplyReceipt = undefined
        try {
          receipt = await this.ports.applySelection(agent, selection)
          signal.throwIfAborted()
          if (epoch !== this.epoch) {
            const staleReceipt = receipt
            receipt = undefined
            await staleReceipt?.rollback()
            return
          }
          receipt?.commit()
        } catch (error) {
          try {
            await receipt?.rollback()
          } catch (cleanupError) {
            this.ctx.logger.warn(String(cleanupError))
          }
          throw error
        } finally {
          this.targets.delete(agent)
        }
        this.registeredIds.set(agent, this.availableIds(agent))
        this.dirty.delete(agent)
        this.cancelRetry(agent)
        try {
          this.ports.committed?.(agent)
        } catch (error) {
          this.dirty.add(agent)
          throw error
        }
      })
    }
    if (agent.status !== 'idle') {
      // Availability can revoke a capability during a turn without taking over the host's input queue.
      try {
        await this.refreshInventory(agent)
      } catch (error) {
        this.ctx.logger.warn('extension inventory refresh: ' + String(error))
      }
      let removeAbort = () => {}
      const aborted = new Promise<void>(resolve => {
        const stop = () => resolve()
        this.lifetime.signal.addEventListener('abort', stop, { once: true })
        removeAbort = () => this.lifetime.signal.removeEventListener('abort', stop)
      })
      const deferred = Promise.race([agent.whenIdle(), aborted]).then(async () => {
        removeAbort()
        this.refreshing.delete(agent)
        if (!this.disposed && this.ctx.agents.get(agent.id) === agent) await this.refreshAgent(agent)
        // A busy agent heals through whenIdle, but only once: if that refresh
        // could not finish either, the retry is what comes back.
        if (!this.disposed && this.dirty.has(agent)) this.scheduleRetry(agent)
      })
      this.refreshing.set(agent, deferred)
      void deferred.catch(error => this.ctx.logger.warn('extension refresh: ' + String(error)))
      return
    }
    const startedEpoch = this.epoch
    const pending = work().catch(error => {
      this.ctx.logger.warn('extension refresh: ' + String(error))
      this.scheduleRetry(agent)
    })
    this.refreshing.set(agent, pending)
    await pending
    this.refreshing.delete(agent)
    // The catalog asked for rows this selection did not name: commit the followed selection
    // now that the maintenance slot is free, so the grant, the injection and the panel all
    // move in one step.
    if (follow !== undefined && !this.disposed) {
      const followed = follow
      const committed = this.state.read(agent)
      if (committed !== undefined) {
        try {
          await this.state.change(agent, committed.revision, followed)
        } catch (error) {
          this.ctx.logger.warn('extension refresh: ' + String(error))
          this.scheduleRetry(agent)
        }
      }
    }
    if (!this.disposed && this.dirty.has(agent) && startedEpoch !== this.epoch) await this.refreshAgent(agent)
  }

  async refreshInventory(agent: Agent): Promise<ExtensionResource[]> {
    const epoch = this.epoch
    const sequence = (this.reads.get(agent) ?? 0) + 1
    this.reads.set(agent, sequence)
    const resources = await this.ports.inventory(agent)
    // Publish only when this is still the newest read and the catalog has not
    // changed since it started: a read that predates a revoke must never clear
    // the stale mark, and a slow answer must never overwrite a newer inventory.
    if (this.reads.get(agent) === sequence && epoch === this.epoch) {
      this.resources.set(agent, resources)
      this.stale.delete(agent)
      if (this.dirty.has(agent)) this.ports.committed?.(agent)
    }
    return resources
  }
  /** The settings Hooks tab: sessionless by design, so no agent is resolved and no session state is consulted. */
  async hooksOverview(): Promise<ExtensionHooksOverview> {
    if (this.ports.hooksOverview === undefined) throw failure('extension-hooks-unavailable')
    return this.ports.hooksOverview()
  }
  /** One declared hook's dry run: the composition resolves the command, this service only gates availability and forwards. */
  async hookRun(input: ExtensionHookRunInput): Promise<ExtensionHookRunResult> {
    if (this.ports.hookRun === undefined) throw failure('extension-hook-run-unavailable')
    return this.ports.hookRun(input)
  }
  /**
   * The live Agent for one session, activating a persisted one on the way.
   *
   * A composer control has to answer whenever its conversation is open. The host
   * resumes a persisted session for every agent-bound read and write it serves,
   * so this asks the same seam instead of holding a wait state until the person
   * sends a message. A host that composes no seam keeps the not-found answer.
   *
   * @param sessionId - the session whose Agent the request addresses.
   * @returns the live or newly activated Agent.
   * @throws extension-session-not-found when the host cannot activate the session.
   */
  private async agent(sessionId: string): Promise<Agent> {
    const live = this.ctx.agents.get(SessionId(sessionId))
    if (live !== undefined) {
      extensionWorkspace(live)
      return live
    }
    const activated = await this.activate(sessionId)
    extensionWorkspace(activated)
    return activated
  }
  /**
   * Resolve a persisted session into a live Agent through the host's own seam.
   *
   * Concurrent reads of one session share one attempt, and a failed attempt is
   * remembered for {@link ACTIVATION_RETRY_MS}: the client polls, so retrying on
   * every read would spend one resume, and one session writer, per interval.
   *
   * @param sessionId - the session to activate.
   * @returns the live Agent the host published.
   * @throws The seam's own failure code, or extension-session-not-found without a seam.
   */
  private async activate(sessionId: string): Promise<Agent> {
    if (this.disposed) throw failure('extension-session-not-found')
    const remembered = this.activationFailures.get(sessionId)
    if (remembered !== undefined && Date.now() - remembered.at < ACTIVATION_RETRY_MS) throw remembered.error
    const inflight = this.activating.get(sessionId)
    if (inflight !== undefined) return inflight
    const seam = this.ctx.get('sessionController') as SessionAgentActivator | undefined
    if (seam === undefined) throw failure('extension-session-not-found')
    const attempt = seam
      .resolveAgent(SessionId(sessionId))
      .then(result => {
        if (result.agent === undefined) {
          const code = result.error?.code ?? 'extension-session-not-found'
          const error = Object.assign(new Error(result.error?.message ?? code), { code })
          this.activationFailures.set(sessionId, { at: Date.now(), error })
          throw error
        }
        this.activationFailures.delete(sessionId)
        return result.agent
      })
      .finally(() => {
        if (this.activating.get(sessionId) === attempt) this.activating.delete(sessionId)
      })
    this.activating.set(sessionId, attempt)
    return attempt
  }
  /**
   * The selection a child session starts from.
   *
   * A child session has no panel of its own: nobody chooses its resources, so a
   * capture that invents an authorization the parent never gave is a guess, and
   * the gate then denies what the parent's own session granted. The parent's
   * committed selection is the answer, and the fork path already treats it as
   * the child's own: a forked child's log carries the parent's committed
   * binding, which the session state commits as the child's revision 1.
   *
   * @param agent - the child agent.
   * @returns the parent's committed selection, or undefined when there is no
   * live parent or the parent has no selection of its own.
   */
  private inheritedSelection(agent: Agent): ExtensionSelection | undefined {
    const parentSession = agent.session.header.parentSession
    if (parentSession === undefined) return undefined
    const parent = this.ctx.agents.get(parentSession)
    if (parent === undefined) return undefined
    try {
      return this.state.read(parent)?.selection
    } catch {
      return undefined
    }
  }
  private async initialSelection(agent: Agent, source?: string): Promise<ExtensionSelection> {
    // A child session follows the session that started it. The workspace
    // default is the answer for a session nobody chose anything for.
    const inherited = this.inheritedSelection(agent)
    if (inherited !== undefined) return inherited
    const workspace = extensionWorkspace(agent)
    const resources = await this.refreshInventory(agent)
    const library = await this.store.read(workspace)
    const preset = source === 'legacy' ? undefined : library.presets.find(row => row.id === library.defaultPresetId)
    if (preset) {
      // A session that starts on the workspace default gets that preset's style too: the
      // selection carries the id, but nothing else would turn it into a chosen style.
      await this.applyStyleOf(agent, preset.enabledIds)
      return captureExtensionSelection(preset, [])
    }
    const legacy = source === 'legacy' ? await loadResourceFilters(this.ports.dataRoot, workspace) : undefined
    const available = resources.filter(
      row =>
        row.control !== 'global-only' &&
        row.available &&
        row.globalEnabled !== false &&
        // The legacy resource filter predates the hooks face, so it carries no
        // evidence for it; those rows select like any other when no filter ran.
        (legacy === undefined ||
          row.face === 'hooks' ||
          row.face === 'instructions' ||
          row.face === 'outputStyles' ||
          (legacy.toggles[row.face] && !legacy.offEntries[row.face]?.includes(row.id)))
    )
    // The guard set keeps every available id, the configuration parents
    // included: the child-keeps-parent check below must still see them. Only
    // the published selection drops a configuration parent, whose grant is
    // derived from the selected children at read time.
    const ids = new Set(available.map(row => row.id))
    const captured = captureExtensionSelection(
      null,
      available.filter(row => row.suiteResourceId === undefined || ids.has(row.suiteResourceId)).map(row => row.id)
    )
    // The pre-preset filters were this workspace's own switches: a later catalog change must
    // not add to what they left on, or the session would silently outgrow the person's choice.
    return legacy === undefined ? captured : { ...captured, frozen: true }
  }
  async window(sessionId: string): Promise<ExtensionWindowPayload> {
    const agent = await this.agent(sessionId)
    const library = await this.store.read(extensionWorkspace(agent))
    // A failed inventory read is a reportable state, not a dead panel: the
    // panel is the surface that has to say why the session's tools are gone, so
    // it answers from the cached rows and names the pending read.
    let resources: ExtensionResource[]
    let readFailed = false
    try {
      resources = await this.refreshInventory(agent)
    } catch (error) {
      readFailed = true
      resources = [...(this.resources.get(agent) ?? [])]
      this.ctx.logger.warn('extension inventory read: ' + String(error))
      this.scheduleRetry(agent)
    }
    // The answer never reports a fold that is still running: the panel is the
    // surface that has to speak, so it waits for the session's initialization it
    // did not start and reports the failure when that failed.
    await this.state.whenInitialized(agent)
    await this.state.whenSelectionSettled(agent)
    const status = this.state.status(agent)
    // Not ready is a reportable state, not a failed read: the payload carries
    // the diagnostics plus a display-only snapshot that authorizes nothing.
    const state = status.ready ? this.state.read(agent) : undefined
    const started = this.progress.read(agent.session)
    const intent = this.state.intended(agent)
    return {
      sessionId,
      workspace: extensionWorkspace(agent),
      started,
      busy: agent.status !== 'idle',
      library,
      state: state ?? { revision: status.revision, selection: status.selection ?? captureExtensionSelection(null, []) },

      // The pending request rides the payload so the manager shows what is coming
      // without a banner and cannot snap back to the superseded selection.
      ...(intent === undefined ? {} : { intendedSelection: intent.selection, intendedRevision: intent.revision }),
      // The last accepted selection revision, effective or pending: the CAS base a
      // client keeps across a promotion, which never moves backwards.
      selectionRevision: this.state.selectionRevision(agent),
      resources,
      // A ready session can still be denied for a moment while its catalog read
      // is in flight. The panel names that instead of reporting a missing tool.
      status: readFailed || this.stale.has(agent) ? { ...status, inventoryPending: true } : status
    }
  }
  /**
   * Recovery is an explicit, revision-checked act; it never invents a selection.
   *
   * Resolving does NOT mean the session's managed capabilities are live. It
   * means the durable selection is restored and this service owns the rest:
   *
   * - the ready branch rejects with `extension-refresh-pending` when its own
   *   refresh could not land, so a caller cannot mistake a still-denied session
   *   for a recovered one,
   * - the not-ready branch can resolve while the session is ready and every
   *   managed capability is still denied, because the post-recovery inventory
   *   read failed and the retry is armed. Read {@link allows} or
   *   {@link denialReason} before treating a resolved recovery as usable,
   * - either branch leaves a retry armed when work is still outstanding, so a
   *   failed recovery is never an agent with work queued and nobody coming back.
   * @param sessionId - the session to recover.
   * @param revision - the compare-and-swap revision the caller last observed.
   */
  async recover(sessionId: string, revision: number): Promise<void> {
    const agent = await this.agent(sessionId)
    if (this.dirty.has(agent) && this.state.status(agent).ready) {
      if (this.state.read(agent)?.revision !== revision) throw failure('extension-session-conflict')
      await this.refreshAgent(agent)
      if (this.dirty.has(agent)) throw failure('extension-refresh-pending')
    } else {
      // The not-ready branch may replay the selection, which reads the
      // inventory, and it then re-reads again to publish. Either read can fail,
      // and both must end the same way: the agent keeps or regains its durable
      // selection, and a retry is armed. Leaving it dirty with nothing scheduled
      // is the in-between state this method must never produce.
      try {
        await this.state.recover(agent, revision)
      } catch (error) {
        if (this.dirty.has(agent)) this.scheduleRetry(agent)
        throw error
      }
      try {
        await this.refreshInventory(agent)
        if (this.dirty.has(agent) && !this.stale.has(agent)) await this.refreshAgent(agent)
      } catch (error) {
        // The recovered selection is durable and the session is ready, so the
        // read failure is reported and the retry takes it from here. Rethrowing
        // would tell the caller recovery failed when it did not.
        this.ctx.logger.warn('extension inventory refresh after recovery: ' + String(error))
      }
      // Unconditional: a stale mark, a dirty mark, or a failed read all end in a
      // scheduled attempt rather than a session nobody comes back for.
      if (this.dirty.has(agent)) this.scheduleRetry(agent)
    }
    await this.ports.ready?.(agent)
  }
  async create(sessionId: string, revision: number, input: ExtensionPresetInput): Promise<void> {
    await this.store.create(extensionWorkspace(await this.agent(sessionId)), revision, input)
  }
  async update(sessionId: string, revision: number, id: string, input: ExtensionPresetInput): Promise<void> {
    const agent = await this.agent(sessionId)
    const workspace = extensionWorkspace(agent)
    await this.store.update(workspace, revision, id, input)
    // An edit to the preset this session is running, or has already asked for, is a
    // request for this session alone: every other session keeps its own snapshot.
    const library = await this.store.read(workspace)
    const revised = library.presets.find(row => row.id === id)
    // A pending request is the newer intent, so it decides both whether this edit
    // concerns this session and which revision the new request compares against.
    const intended = this.state.intended(agent)
    const effective = this.state.status(agent).ready ? this.state.read(agent) : undefined
    const selection = intended?.selection ?? effective?.selection
    if (revised === undefined || selection?.presetId !== id) return
    const resources = await this.refreshInventory(agent)
    await this.state.requestSelection(
      agent,
      this.state.selectionRevision(agent),
      captureExtensionSelection(
        revised,
        resources.filter(row => row.control !== 'global-only' && row.available && row.globalEnabled !== false).map(row => row.id)
      )
    )
  }
  async delete(sessionId: string, revision: number, id: string): Promise<void> {
    await this.store.delete(extensionWorkspace(await this.agent(sessionId)), revision, id)
  }
  async setDefault(sessionId: string, revision: number, id: string | null): Promise<void> {
    await this.store.setDefault(extensionWorkspace(await this.agent(sessionId)), revision, id)
  }
  async select(sessionId: string, revision: number, id: string | null): Promise<void> {
    const agent = await this.agent(sessionId)
    const library = await this.store.read(extensionWorkspace(agent))
    const preset = library.presets.find(row => row.id === id)
    if (id !== null && !preset) throw new ExtensionPresetError('preset-not-found', 'extension preset no longer exists')
    const resources = await this.refreshInventory(agent)
    // A request made while a turn owns the session is durable intent, not an
    // application: the committed selection keeps authorizing until the boundary.
    const outcome = await this.state.requestSelection(
      agent,
      revision,
      captureExtensionSelection(
        preset ?? null,
        resources.filter(row => row.control !== 'global-only' && row.available && row.globalEnabled !== false).map(row => row.id)
      )
    )
    if (outcome.applied) {
      if (preset !== undefined) await this.applyStyleOf(agent, preset.enabledIds)
      await this.ports.ready?.(agent)
    }
  }

  /**
   * Select the output style a set of preset ids carries, when one does.
   *
   * The style rides the preset as an id, like a capability; the surface selection ignores
   * it, so this call is what makes it real. A failure here must not fail the preset: every
   * capability in it already applies, and the panel reports the style's own state.
   *
   * @param agent - the session whose workspace chooses the style.
   * @param ids - the preset's selection.
   */
  private async applyStyleOf(agent: Agent, ids: readonly string[]): Promise<void> {
    const styleId = ids.find(row => row.startsWith('outputStyles:'))?.slice('outputStyles:'.length)
    if (styleId === undefined || this.ports.applyOutputStyle === undefined) return
    try {
      await this.ports.applyOutputStyle(agent, styleId)
    } catch {
      // Reported by the style surface itself; the preset still applies.
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true
    for (const timer of this.retries.values()) clearTimeout(timer)
    this.retries.clear()
    this.retryAttempts.clear()
    this.retryWarned.clear()
    this.lifetime.abort()
    await Promise.allSettled([...this.refreshing.values()])
    for (const off of this.off.splice(0)) off()
    await this.progress.dispose()
    await this.selection.dispose()
    await this.state.dispose()
    this.resources.clear()
    this.targets.clear()
    this.stale.clear()
    this.reads.clear()
    this.registeredIds.clear()
    this.appliedEpochs.clear()
    this.dirty.clear()
    this.activating.clear()
    this.activationFailures.clear()
  }
}
