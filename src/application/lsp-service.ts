/**
 * LSP use cases: the status surface, the user's direct server table, and the
 * per-server enable switch.
 *
 * Direct servers live in the shared Agent layout root (`~/.agents/lsp.json`)
 * and are merged with the suites' inline declarations at mount time; a
 * suite's own declaration stays source-owned and is never rewritten. The
 * per-server enable switch stays plugin state under the data root.
 */
import type { LspStatusPayload } from '../contracts/lsp-status.js'
import { loadLspServers, saveLspServers } from '../runtime/lsp-direct-config.js'
import { loadDisabledLspServers, saveDisabledLspServers } from '../runtime/lsp-server-state.js'
import { buildLspStatus } from '../runtime/lsp-status.js'
import { applyLspOverrides, lspConfig, validateServerLsp } from '../runtime/server-config.js'
import type { CatalogContext } from './catalog-context.js'
import type { CatalogPorts, LspServerTable } from './ports.js'

export class LspService {
  constructor(
    private readonly context: CatalogContext,
    private readonly ports: CatalogPorts
  ) {}

  /** The LSP status surface: declared servers merged with mount diagnostics. */
  async status(): Promise<LspStatusPayload> {
    const snapshot = await this.context.snapshots.readUserCatalog()
    const direct = await loadLspServers(this.context.agentsRoot)
    return buildLspStatus(await applyLspOverrides(this.context.dataRoot, snapshot.suites), this.ports.lspStatusSource, direct)
  }

  /** The user's direct LSP server table (normalized specs). */
  async servers(): Promise<LspServerTable> {
    return (await loadLspServers(this.context.agentsRoot)).servers
  }

  /** Create one direct LSP declaration without replacing other user servers. */
  async addServer(name: string, config: unknown): Promise<void> {
    return this.context.enqueue(async () => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error('invalid LSP server name')
      const direct = await loadLspServers(this.context.agentsRoot)
      if (direct.errors.length > 0) throw new Error(direct.errors.join('; '))
      if (Object.hasOwn(direct.servers, name)) throw new Error('LSP server already exists')
      const spec = validateServerLsp(name, config)
      await saveLspServers(this.context.agentsRoot, {
        lspServers: { ...Object.fromEntries(Object.entries(direct.servers).map(([key, value]) => [key, lspConfig(value)])), [name]: lspConfig(spec) }
      })
      await this.context.notifyChanged(true)
    })
  }

  /** Validate and persist the user's direct LSP server table. */
  async setServers(raw: unknown): Promise<LspServerTable> {
    return this.context.enqueue(async () => {
      const { servers } = await saveLspServers(this.context.agentsRoot, raw)
      await this.context.notifyChanged(true)
      return servers
    })
  }

  /** Enable or disable one declared language server by row id. */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    return this.context.enqueue(async () => {
      const disabled = await loadDisabledLspServers(this.context.dataRoot)
      if (enabled) disabled.delete(id)
      else disabled.add(id)
      await saveDisabledLspServers(this.context.dataRoot, disabled)
      await this.context.notifyChanged(true)
    })
  }
}
