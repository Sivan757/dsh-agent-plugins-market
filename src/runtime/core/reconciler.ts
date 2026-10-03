/**
 * Runtime reconciliation for enabled suites.
 *
 * One catalog snapshot is fanned out to the existing MCP, command, hook, and
 * LSP mount adapters. The adapters remain separate because their host surfaces
 * and failure semantics differ; this module owns ordering, containment, and
 * disposal only.
 */
import type { Context } from '@deepseek-ai/cordis'
import { CommandMountRegistry, type CommandMountDiagnostic } from '../surfaces/commands-mounts.js'
import { HooksMountRegistry, type HooksMountDiagnostic } from '../surfaces/hooks-mounts.js'
import { LspMountRegistry, type LspMountDiagnostic } from '../lsp/lsp-mounts.js'
import { McpMountRegistry, type McpMountDiagnostic } from '../mcp/mcp-mounts.js'
import type { Suite } from '../../model/types.js'
import { bindHostLocale, type HostTranslate } from '../host/host-locale.js'

/**
 * The per-surface mount gates one reconcile pass reads.
 *
 * A switched-off surface is gated here rather than by filtering the suite
 * snapshot: the reconciler owns both the MCP and the LSP mount branch, so
 * dropping suites from the shared list would unmount a sibling surface's
 * mounts along with it. Gating each branch instead keeps the two orthogonal —
 * an off MCP mount reconciles to zero servers while the same suites keep their
 * language servers.
 */
export interface RuntimeSurfaceGates {
  /** Whether the named surface may mount on this pass. */
  allows(surface: RuntimeSurfaceKey): boolean
}

/**
 * The toggle keys the reconciler's own mount branches answer to.
 *
 * Hooks have no per-workspace switch, so that branch stays ungated; skills and
 * agents mount through their own providers and the market through its routes.
 */
export type RuntimeSurfaceKey = 'commands' | 'mcp' | 'lsp'

/** Diagnostics returned by one runtime reconciliation pass. */
export interface RuntimeDiagnostics {
  mcp: McpMountDiagnostic[]
  commands: CommandMountDiagnostic[]
  hooks: HooksMountDiagnostic[]
  lsp: LspMountDiagnostic[]
  errors: Array<{ surface: 'mcp' | 'commands' | 'hooks' | 'lsp'; reason: string }>
}

export class RuntimeReconciler {
  private readonly mcp: McpMountRegistry
  private readonly commands: CommandMountRegistry
  private readonly hooks: HooksMountRegistry
  private readonly lspRegistry: LspMountRegistry
  private readonly queues = new Map<keyof Omit<RuntimeDiagnostics, 'errors'>, Promise<void>>()
  private gates: RuntimeSurfaceGates | undefined
  private disposed = false

  constructor(ctx: Context, dataRoot: string, t: HostTranslate = bindHostLocale(undefined)) {
    this.mcp = new McpMountRegistry(ctx, dataRoot)
    this.commands = new CommandMountRegistry(ctx, t, dataRoot)
    this.hooks = new HooksMountRegistry(ctx)
    this.lspRegistry = new LspMountRegistry(ctx)
    this.lspRegistry.setPluginDataRoot(dataRoot)
  }

  /** The LSP mount registry, consumed by the LSP status surface. */
  get lsp(): LspMountRegistry {
    return this.lspRegistry
  }

  /** Install the per-workspace entry filter on the MCP mount registry. */
  setMcpEntryFilter(filter: () => { allows(face: 'mcp', entryId: string): boolean }): void {
    this.mcp.setEntryFilter(filter)
  }

  /** Install the per-workspace entry filter on the command mount registry. */
  setCommandsEntryFilter(filter: () => { allows(face: 'commands', entryId: string): boolean }): void {
    this.commands.setEntryFilter(filter)
  }

  /**
   * Install the per-workspace surface gates, read on every pass.
   *
   * Set after construction because the toggle service is built later in
   * composition; until then every surface mounts, which is the all-on default.
   */
  setSurfaceGates(gates: RuntimeSurfaceGates): void {
    this.gates = gates
  }

  /** Install the per-suite MCP overrides provider used at mount time. */
  setMcpOverridesProvider(provider: () => Promise<Map<string, import('../../application/mcp/mcp-overrides.js').McpSuiteOverrides>>): void {
    this.mcp.setOverridesProvider(provider)
  }

  /** Install the live tool-name provider used for foreign-namespace mount guards. */
  setMcpToolNamesProvider(provider: () => string[]): void {
    this.mcp.setToolNamesProvider(provider)
  }

  /** Install the backend provider deciding which MCP client mounts each server. */
  setMcpBackendProvider(provider: () => Promise<import('../../application/mcp/mcp-backend.js').McpBackend>): void {
    this.mcp.setBackendProvider(provider)
  }

  /** Whether the current MCP snapshot uses one credential reference. */
  usesCredential(ref: string): boolean {
    return this.mcp.usesCredential(ref)
  }

  /** Flag one MCP mount for an explicit rebuild on the next reconcile. */
  forceMcpRemount(suiteId: string, serverKey: string): void {
    this.mcp.forceRemount(suiteId, serverKey)
  }

  /** Flag every live MCP mount for a rebuild on the next reconcile. */
  forceMcpRemountAll(): void {
    this.mcp.forceRemountAll()
  }

  /** The mount key owning one derived serverName; undefined when not mounted here. */
  mcpServerOwner(serverName: string): { suiteId: string; serverKey: string } | undefined {
    return this.mcp.serverOwner(serverName)
  }

  /** Reconcile all runtime surfaces against one enabled-suite snapshot. */
  async reconcile(enabledSuites: readonly Suite[]): Promise<RuntimeDiagnostics> {
    const suites = [...enabledSuites]
    const diagnostics: RuntimeDiagnostics = { mcp: [], commands: [], hooks: [], lsp: [], errors: [] }
    if (this.disposed) return diagnostics
    const reconcileSurface = <K extends keyof Omit<RuntimeDiagnostics, 'errors'>>(surface: K, reconcile: () => Promise<RuntimeDiagnostics[K]>): Promise<void> => {
      const run = (this.queues.get(surface) ?? Promise.resolve()).then(async () => {
        if (this.disposed) return
        try {
          diagnostics[surface] = await reconcile()
        } catch (error) {
          diagnostics.errors.push({ surface, reason: messageOf(error) })
        }
      })
      this.queues.set(surface, run)
      return run
    }
    // Each switchable surface answers its own gate by reconciling to "nothing
    // wanted", which is the same unmount-to-empty pass a removed suite already
    // produces. The suite list itself is never filtered: MCP, commands and LSP
    // all mount from this one snapshot, so dropping a suite for one surface
    // would tear down its mounts on the others.
    const gated = (surface: 'commands' | 'mcp' | 'lsp'): Suite[] => (this.gates?.allows(surface) === false ? [] : suites)
    // Network-backed MCP startup must not delay local commands, hooks or LSP.
    // Each surface retains its own order when catalog mutations overlap.
    await Promise.all([
      reconcileSurface('mcp', () => this.mcp.reconcile(gated('mcp'))),
      reconcileSurface('commands', () => this.commands.reconcile(gated('commands'))),
      reconcileSurface('hooks', () => this.hooks.reconcile(suites)),
      reconcileSurface('lsp', () => this.lspRegistry.reconcile(gated('lsp')))
    ])
    return diagnostics
  }

  /** Dispose all live mounts and registrations. */
  async dispose(): Promise<void> {
    this.disposed = true
    const disposeSurface = async (surface: keyof Omit<RuntimeDiagnostics, 'errors'>, dispose: () => void | Promise<void>): Promise<void> => {
      await this.queues.get(surface)
      await dispose()
    }
    await Promise.all([
      disposeSurface('mcp', () => this.mcp.disposeAll()),
      disposeSurface('commands', () => this.commands.disposeAll()),
      disposeSurface('hooks', () => this.hooks.disposeAll()),
      disposeSurface('lsp', () => this.lspRegistry.disposeAll())
    ])
    this.queues.clear()
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
