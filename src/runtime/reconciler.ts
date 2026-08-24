/**
 * Runtime reconciliation for enabled suites.
 *
 * One catalog snapshot is fanned out to the existing MCP, command, and hook
 * mount adapters. The adapters remain separate because their host surfaces and
 * failure semantics differ; this module owns ordering, containment, and
 * disposal only.
 */
import type { Context } from '@deepseek-ai/cordis'
import { CommandMountRegistry, type CommandMountDiagnostic } from './commands-mounts.js'
import { HooksMountRegistry, type HooksMountDiagnostic } from './hooks-mounts.js'
import { McpMountRegistry, type McpMountDiagnostic } from './mcp-mounts.js'
import type { Suite } from '../model/types.js'
import { bindHostLocale, type HostTranslate } from './host-locale.js'

/** Diagnostics returned by one runtime reconciliation pass. */
export interface RuntimeDiagnostics {
  mcp: McpMountDiagnostic[]
  commands: CommandMountDiagnostic[]
  hooks: HooksMountDiagnostic[]
  errors: Array<{ surface: 'mcp' | 'commands' | 'hooks'; reason: string }>
}

export class RuntimeReconciler {
  private readonly mcp: McpMountRegistry
  private readonly commands: CommandMountRegistry
  private readonly hooks: HooksMountRegistry

  constructor(ctx: Context, dataRoot: string, t: HostTranslate = bindHostLocale(undefined)) {
    this.mcp = new McpMountRegistry(ctx, dataRoot)
    this.commands = new CommandMountRegistry(ctx, t)
    this.hooks = new HooksMountRegistry(ctx)
  }

  /** Reconcile all runtime surfaces against one enabled-suite snapshot. */
  async reconcile(enabledSuites: readonly Suite[]): Promise<RuntimeDiagnostics> {
    const suites = [...enabledSuites]
    const diagnostics: RuntimeDiagnostics = { mcp: [], commands: [], hooks: [], errors: [] }
    try {
      diagnostics.mcp = await this.mcp.reconcile(suites)
    } catch (error) {
      diagnostics.errors.push({ surface: 'mcp', reason: messageOf(error) })
    }
    try {
      diagnostics.commands = await this.commands.reconcile(suites)
    } catch (error) {
      diagnostics.errors.push({ surface: 'commands', reason: messageOf(error) })
    }
    try {
      diagnostics.hooks = await this.hooks.reconcile(suites)
    } catch (error) {
      diagnostics.errors.push({ surface: 'hooks', reason: messageOf(error) })
    }
    return diagnostics
  }

  /** Dispose all live mounts and registrations. */
  async dispose(): Promise<void> {
    await this.mcp.disposeAll()
    await this.hooks.disposeAll()
    this.commands.disposeAll()
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
