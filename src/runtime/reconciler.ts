/**
 * Runtime reconciliation for enabled suites.
 *
 * One catalog snapshot is fanned out to the existing MCP, command, hook, and
 * LSP mount adapters. The adapters remain separate because their host surfaces
 * and failure semantics differ; this module owns ordering, containment, and
 * disposal only.
 */
import type { Context } from '@deepseek-ai/cordis'
import { CommandMountRegistry, type CommandMountDiagnostic } from './commands-mounts.js'
import { HooksMountRegistry, type HooksMountDiagnostic } from './hooks-mounts.js'
import { LspMountRegistry, type LspMountDiagnostic } from './lsp-mounts.js'
import { McpMountRegistry, type McpMountDiagnostic } from './mcp-mounts.js'
import type { Suite } from '../model/types.js'
import { bindHostLocale, type HostTranslate } from './host-locale.js'

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
  private disposed = false

  constructor(ctx: Context, dataRoot: string, t: HostTranslate = bindHostLocale(undefined)) {
    this.mcp = new McpMountRegistry(ctx, dataRoot)
    this.commands = new CommandMountRegistry(ctx, t)
    this.hooks = new HooksMountRegistry(ctx)
    this.lspRegistry = new LspMountRegistry(ctx)
  }

  /** The LSP mount registry, consumed by the LSP status surface. */
  get lsp(): LspMountRegistry {
    return this.lspRegistry
  }

  /** Install the per-suite MCP overrides provider used at mount time. */
  setMcpOverridesProvider(provider: () => Promise<Map<string, import('./mcp-overrides.js').McpSuiteOverrides>>): void {
    this.mcp.setOverridesProvider(provider)
  }

  /** Install the live tool-name provider used for foreign-namespace mount guards. */
  setMcpToolNamesProvider(provider: () => string[]): void {
    this.mcp.setToolNamesProvider(provider)
  }

  /** Install the backend provider deciding which MCP client mounts each server. */
  setMcpBackendProvider(provider: () => Promise<import('./mcp-backend.js').McpBackend>): void {
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
    // Network-backed MCP startup must not delay local commands, hooks or LSP.
    // Each surface retains its own order when catalog mutations overlap.
    await Promise.all([
      reconcileSurface('mcp', () => this.mcp.reconcile(suites)),
      reconcileSurface('commands', () => this.commands.reconcile(suites)),
      reconcileSurface('hooks', () => this.hooks.reconcile(suites)),
      reconcileSurface('lsp', () => this.lspRegistry.reconcile(suites))
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
