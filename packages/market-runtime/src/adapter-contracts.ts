/**
 * The mount adapters the runtime coordinator drives, stated as structural ports.
 *
 * The coordinator owns ordering, containment and disposal; the MCP and LSP
 * registries own their transports. Each port below lists exactly the members its
 * consumer calls, with the signatures those registries already carry, so the
 * composition root injects the implementations and no runtime module imports a
 * transport package. Diagnostic values cross the seam as the shared wire
 * contracts both registries re-export, so one failure keeps one type.
 *
 * @module adapter-contracts
 */
import type { Context } from '@deepseek-ai/cordis'
import type { McpBackend, McpMountDiagnostic } from '../../market-contracts/src/contracts/mcp.js'
import type { LspMountDiagnostic } from '../../market-contracts/src/contracts/lsp.js'
import type { LspMountStatusSource } from '../../market-contracts/src/ports/ports.js'
import type { LspServerSpec, Suite } from '../../market-contracts/src/model/types.js'
import type { ExtensionLspProvider, ExtensionMcpTool } from './runtime/host/extension-tool-gates.js'

/**
 * One suite's MCP override table, narrowed to what the coordinator reads: it
 * only marks a demanded server enabled. Every field of the registry's own row
 * type is optional, so this port and `McpSuiteOverrides` stay mutually
 * assignable and no cast is needed in either direction.
 */
export type McpOverridesPort = Record<string, { enabled?: boolean }>

/** The MCP mount surface the agent-scoped contributor drives over one context. */
export interface McpMountPort {
  setOverridesProvider(provider: () => Promise<Map<string, McpOverridesPort>>): void
  setBackendProvider(provider: () => Promise<McpBackend>): void
  setToolNamesProvider(provider: () => string[]): void
  reconcile(enabledSuites: Suite[]): Promise<McpMountDiagnostic[]>
  disposeAll(): Promise<void>
  toolOwnership(): ExtensionMcpTool[]
}

/** The complete MCP mount adapter the shared-service coordinator drives. */
export interface SharedMcpMountPort extends McpMountPort {
  setEntryFilter(filter: () => { allows(face: 'mcp', entryId: string): boolean }): void
  usesCredential(ref: string): boolean
  forceRemount(suiteId: string, serverKey: string): void
  forceRemountAll(): void
  serverOwner(serverName: string): { suiteId: string; serverKey: string } | undefined
  /**
   * Prove one suite's demanded servers are mounted by this adapter.
   *
   * Lives here rather than in the coordinator because the proof needs the mount
   * key this adapter derives for a server, which is transport knowledge.
   * @param suite - the suite whose demanded servers must be live.
   * @param diagnostics - the mount diagnostics of the pass that just ran.
   * @param failed - whether that pass already recorded an MCP mount error.
   * @throws when a demanded server is not the exact live owner of its key.
   */
  assertMounted(suite: Suite, diagnostics: readonly McpMountDiagnostic[], failed: boolean): void
}

/** The LSP mount adapter the coordinator drives and the status surfaces read. */
export interface LspMountPort extends LspMountStatusSource {
  setPluginDataRoot(root: string): void
  setDirectProvider(provider: () => Promise<Record<string, LspServerSpec>>): void
  setDisabledProvider(provider: () => Promise<Set<string>>): void
  setEntryFilter(filter: () => { allows(face: 'lsp', entryId: string): boolean }): void
  setDemandedProviderIdsProvider(provider: () => ReadonlySet<string>): void
  /** Current global disabled ids, without merging session demand. */
  globalDisabledProviderIds(): Promise<ReadonlySet<string>>
  providerOwnership(): ExtensionLspProvider[]
  ownsTool(): boolean
  reconcile(enabledSuites: Suite[]): Promise<LspMountDiagnostic[]>
  disposeAll(): Promise<void>
}

/** The mount adapters one reconciler drives; the composition root builds both. */
export interface RuntimeMounts {
  readonly mcp: SharedMcpMountPort
  readonly lsp: LspMountPort
}

/**
 * Create one MCP mount over a caller-supplied context.
 *
 * The agent-scoped contributor mounts project servers and the workspace-pooled
 * host bridge into contexts it does not own, so it takes the factory rather than
 * an instance; the composition root closes over the concrete registry.
 */
export type McpMountFactory = (ctx: Context, dataRoot: string) => McpMountPort
