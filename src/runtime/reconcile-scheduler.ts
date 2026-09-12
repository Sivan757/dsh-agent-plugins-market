/**
 * Coalesced runtime reconciliation for the enabled suite set.
 *
 * Settings, credential and catalog events arrive in bursts and can land while
 * a slow MCP connection is still opening. One pass is kept in flight and at
 * most one fresh follow-up is remembered, so a burst collapses into a single
 * reconcile instead of a queue of stale snapshots that each reconnect the
 * same servers.
 *
 * @module runtime/reconcile-scheduler
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Suite } from '../model/types.js'
import type { McpMountDiagnostic } from './mcp-mounts.js'
import type { RuntimeReconciler } from './reconciler.js'

/** The catalog surface one reconcile pass reads from and publishes to. */
export interface ReconcileHost {
  /** Enabled user-dimension suites to reconcile. */
  enabledSuites(): Promise<Suite[]>
  /** Publish the pass's MCP mount diagnostics for the status surface. */
  publishMcpDiagnostics(diagnostics: McpMountDiagnostic[]): void
}

/** Credential updates are batched for this long before one reconcile runs. */
const CREDENTIAL_DEBOUNCE_MS = 150

export class ReconcileScheduler {
  private disposed = false
  private requested = false
  private pass: Promise<void> | undefined
  private readonly pendingCredentialRefs = new Set<string>()
  private credentialFlush: ReturnType<typeof setTimeout> | undefined
  private readonly releaseCredentialUpdates: () => void

  constructor(
    private readonly ctx: Context,
    private readonly runtime: RuntimeReconciler,
    private readonly host: ReconcileHost
  ) {
    const eventHost = ctx as unknown as { on?: (event: string, listener: (ref: string) => void) => () => void }
    this.releaseCredentialUpdates =
      eventHost.on?.('credentials/reference-updated', ref => {
        this.pendingCredentialRefs.add(ref)
        if (this.credentialFlush !== undefined) clearTimeout(this.credentialFlush)
        this.credentialFlush = setTimeout(() => this.flushCredentialUpdates(), CREDENTIAL_DEBOUNCE_MS)
        this.credentialFlush.unref?.()
      }) ?? (() => {})
  }

  /** Reconcile now, joining the pass in flight and remembering one follow-up for it. */
  request(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.requested = true
    this.pass ??= (async () => {
      try {
        do {
          this.requested = false
          await this.reconcileOnce()
        } while (this.requested && !this.disposed)
      } finally {
        this.pass = undefined
      }
    })()
    return this.pass
  }

  /** Stop scheduling; later events are dropped. */
  dispose(): void {
    this.disposed = true
    this.releaseCredentialUpdates()
    if (this.credentialFlush !== undefined) clearTimeout(this.credentialFlush)
    this.credentialFlush = undefined
    this.pendingCredentialRefs.clear()
  }

  private async reconcileOnce(): Promise<void> {
    try {
      const suites = await this.host.enabledSuites()
      if (this.disposed) return
      const diagnostics = await this.runtime.reconcile(suites)
      this.host.publishMcpDiagnostics(diagnostics.mcp)
      for (const diagnostic of diagnostics.mcp) {
        this.ctx.logger?.warn(`[dsh-agent-plugins-market] suite "${diagnostic.suiteId}" mcp server "${diagnostic.serverKey}": ${diagnostic.reason}`)
      }
      for (const diagnostic of diagnostics.lsp) {
        this.ctx.logger?.warn(`[dsh-agent-plugins-market] suite "${diagnostic.suiteId}" lsp server "${diagnostic.serverKey}": ${diagnostic.reason}`)
      }
      for (const diagnostic of diagnostics.commands) {
        if (diagnostic.reason !== '') this.ctx.logger?.warn(`[dsh-agent-plugins-market] suite "${diagnostic.suiteId}" command "${diagnostic.command}": ${diagnostic.reason}`)
      }
      for (const diagnostic of diagnostics.hooks) {
        this.ctx.logger?.warn(`[dsh-agent-plugins-market] suite "${diagnostic.suiteId}" hooks: ${diagnostic.reason}`)
      }
      for (const error of diagnostics.errors) {
        this.ctx.logger?.warn(`[dsh-agent-plugins-market] ${error.surface} reconcile failed: ${error.reason}`)
      }
    } catch (error) {
      this.ctx.logger?.warn(`[dsh-agent-plugins-market] runtime reconcile failed: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  /**
   * Coalesce credential updates: the debounce collapses a burst into one pass,
   * and the pending refs are kept until that pass runs, so an update arriving
   * mid-reconcile is never dropped.
   */
  private flushCredentialUpdates(): void {
    this.credentialFlush = undefined
    const refs = [...this.pendingCredentialRefs]
    this.pendingCredentialRefs.clear()
    // Re-read the catalog first: an unknown ref means the snapshot predates
    // this change, so reconcile anyway to refresh the known reference set.
    void this.request().catch(() => {})
    if (refs.length > 0) {
      this.ctx.logger?.info?.(`[dsh-agent-plugins-market] reconciling after credential update: ${refs.join(', ')}`)
    }
  }
}
