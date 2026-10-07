/** Session-addressed preset operations; only acknowledged session changes replace live contributions. */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ExtensionPresetStore, ExtensionPresetError } from '../../application/state/extension-presets.js'
import { loadResourceFilters } from '../../application/state/resource-filters.js'
import { extensionResourceEnabled } from '../../application/extension-inventory.js'
import {
  captureExtensionSelection,
  type ExtensionResource,
  type ExtensionSelection,
  type ExtensionPresetInput,
  type ExtensionWindowPayload,
  type ExtensionHooksOverview
} from '../../contracts/extension-presets.js'
import type { ExtensionRouteService } from '../../routes-extension-presets.js'
import { ExtensionSessionState, EXTENSION_SESSION_SOURCE, type ExtensionApplyReceipt } from './extension-session-state.js'

export interface ExtensionRuntimePorts {
  dataRoot: string
  inventory(agent: Agent): Promise<ExtensionResource[]>
  applySelection(agent: Agent, selection: ExtensionSelection): Promise<void | ExtensionApplyReceipt>
  /** Whether this service governs one agent at all; absent governs every agent. */
  eligible?(agent: Agent): boolean
  ready?(agent: Agent, source?: string): Promise<void>
  committed?(agent: Agent): void
  /** The sessionless Hooks overview the settings workspace renders; hook declarations belong to the user, not to a session. */
  hooksOverview?(): Promise<ExtensionHooksOverview>
}
function failure(code: string): Error {
  return Object.assign(new Error(code), { code })
}
export function extensionWorkspace(agent: Agent): string {
  const cwd = agent.session.header.cwd
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw failure('extension-workspace-unavailable')
  return cwd
}

export class ExtensionRuntime implements ExtensionRouteService {
  readonly state: ExtensionSessionState
  private readonly store: ExtensionPresetStore
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
  private readonly lifetime = new AbortController()
  private disposed = false
  /** Per-agent read sequence: a slow earlier response must not overwrite a newer inventory. */
  private readonly reads = new Map<Agent, number>()
  private readonly targets = new Map<Agent, ExtensionSelection>()
  private readonly off: Array<() => void> = []
  constructor(
    private readonly ctx: Context,
    private readonly ports: ExtensionRuntimePorts
  ) {
    this.store = new ExtensionPresetStore(ports.dataRoot)
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
  /** Registration alone may inspect a pending target; execution must call allows. */
  registrationAllows(agent: Agent, resourceId: string, suiteId?: string): boolean {
    if (this.stale.has(agent)) return false
    const target = this.targets.get(agent)
    return target === undefined ? this.allows(agent, resourceId, suiteId) : this.selected(agent, target, resourceId, suiteId)
  }
  private selected(agent: Agent, selection: ExtensionSelection, resourceId: string, suiteId?: string): boolean {
    const resources = this.resources.get(agent) ?? []
    const row = resources.find(resource => resource.id === resourceId)
    // The caller names the suite with a bare 'source/suite' while the selection
    // holds 'market:source/suite' resource ids, and extensionResourceEnabled
    // already requires the authoritative parent (suiteResourceId) to be selected
    // and available. Comparing the caller's suiteId here could only ever deny a
    // granted call, so the argument is deliberately not consulted.
    void suiteId
    return row !== undefined && extensionResourceEnabled(row, selection, resources)
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
  private async refreshAgent(agent: Agent): Promise<void> {
    if (this.disposed || !this.dirty.has(agent) || this.refreshing.has(agent)) return
    const work = async (): Promise<void> => {
      const epoch = this.epoch
      await agent.runMaintenance(async signal => {
        const snapshot = this.state.status(agent)
        if (!snapshot.ready || !snapshot.selection) return
        await this.refreshInventory(agent)
        signal.throwIfAborted()
        if (this.stale.has(agent)) return
        this.targets.set(agent, snapshot.selection)
        let receipt: void | ExtensionApplyReceipt = undefined
        try {
          receipt = await this.ports.applySelection(agent, snapshot.selection)
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
      })
      this.refreshing.set(agent, deferred)
      void deferred.catch(error => this.ctx.logger.warn('extension refresh: ' + String(error)))
      return
    }
    const startedEpoch = this.epoch
    const pending = work().catch(error => {
      this.ctx.logger.warn('extension refresh: ' + String(error))
    })
    this.refreshing.set(agent, pending)
    await pending
    this.refreshing.delete(agent)
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
  private agent(sessionId: string): Agent {
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (!agent) throw failure('extension-session-not-found')
    extensionWorkspace(agent)
    return agent
  }
  private async initialSelection(agent: Agent, source?: string): Promise<ExtensionSelection> {
    const workspace = extensionWorkspace(agent)
    const resources = await this.refreshInventory(agent)
    const library = await this.store.read(workspace)
    const preset = source === 'legacy' ? undefined : library.presets.find(row => row.id === library.defaultPresetId)
    if (preset) return captureExtensionSelection(preset, [])
    const legacy = source === 'legacy' ? await loadResourceFilters(this.ports.dataRoot, workspace) : undefined
    const available = resources.filter(
      row =>
        row.control !== 'global-only' &&
        row.available &&
        row.globalEnabled !== false &&
        // The legacy resource filter predates the hooks face, so it carries no
        // evidence for it; those rows select like any other when no filter ran.
        (legacy === undefined || row.face === 'hooks' || (legacy.toggles[row.face] && !legacy.offEntries[row.face]?.includes(row.id)))
    )
    const ids = new Set(available.map(row => row.id))
    return captureExtensionSelection(
      null,
      available.filter(row => row.suiteResourceId === undefined || ids.has(row.suiteResourceId)).map(row => row.id)
    )
  }
  async window(sessionId: string): Promise<ExtensionWindowPayload> {
    const agent = this.agent(sessionId)
    const status = this.state.status(agent)
    // Not ready is a reportable state, not a failed read: the payload carries
    // the diagnostics plus a display-only snapshot that authorizes nothing.
    const state = status.ready ? this.state.read(agent) : undefined
    const [library, resources] = await Promise.all([this.store.read(extensionWorkspace(agent)), this.refreshInventory(agent)])
    const started = agent.session.snapshotEvents().some(event => {
      if (event.type === 'turn/start') return true
      const messages = event.type === 'user/message' ? [event.data] : event.type === 'agent/inbox/spliced' ? event.data.inserted : []
      return messages.some(message => message.source.kind !== EXTENSION_SESSION_SOURCE && !('form' in message.source))
    })
    return {
      sessionId,
      workspace: extensionWorkspace(agent),
      started,
      busy: agent.status !== 'idle',
      library,
      state: state ?? { revision: status.revision, selection: status.selection ?? captureExtensionSelection(null, []) },
      resources,
      status
    }
  }
  /** Recovery is an explicit, revision-checked act; it never invents a selection. */
  async recover(sessionId: string, revision: number): Promise<void> {
    const agent = this.agent(sessionId)
    if (this.dirty.has(agent) && this.state.status(agent).ready) {
      if (this.state.read(agent)?.revision !== revision) throw failure('extension-session-conflict')
      await this.refreshAgent(agent)
      if (this.dirty.has(agent)) throw failure('extension-refresh-pending')
    } else await this.state.recover(agent, revision)
    await this.ports.ready?.(agent)
  }
  async create(sessionId: string, revision: number, input: ExtensionPresetInput): Promise<void> {
    await this.store.create(extensionWorkspace(this.agent(sessionId)), revision, input)
  }
  async update(sessionId: string, revision: number, id: string, input: ExtensionPresetInput): Promise<void> {
    await this.store.update(extensionWorkspace(this.agent(sessionId)), revision, id, input)
  }
  async delete(sessionId: string, revision: number, id: string): Promise<void> {
    await this.store.delete(extensionWorkspace(this.agent(sessionId)), revision, id)
  }
  async setDefault(sessionId: string, revision: number, id: string | null): Promise<void> {
    await this.store.setDefault(extensionWorkspace(this.agent(sessionId)), revision, id)
  }
  async select(sessionId: string, revision: number, id: string | null): Promise<void> {
    const agent = this.agent(sessionId)
    const library = await this.store.read(extensionWorkspace(agent))
    const preset = library.presets.find(row => row.id === id)
    if (id !== null && !preset) throw new ExtensionPresetError('preset-not-found', 'extension preset no longer exists')
    const resources = await this.refreshInventory(agent)
    await this.state.change(
      agent,
      revision,
      captureExtensionSelection(
        preset ?? null,
        resources.filter(row => row.control !== 'global-only' && row.available && row.globalEnabled !== false).map(row => row.id)
      )
    )
    await this.ports.ready?.(agent)
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.lifetime.abort()
    await Promise.allSettled([...this.refreshing.values()])
    for (const off of this.off.splice(0)) off()
    await this.state.dispose()
    this.resources.clear()
    this.targets.clear()
    this.stale.clear()
    this.reads.clear()
    this.registeredIds.clear()
    this.appliedEpochs.clear()
    this.dirty.clear()
  }
}
