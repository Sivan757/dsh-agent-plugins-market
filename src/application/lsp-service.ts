/**
 * LSP use cases: the status surface, the user's direct server table, and the
 * per-server enable switch.
 *
 * Direct servers live in the shared Agent layout root (`~/.agents/lsp.json`)
 * and are merged with the suites' inline declarations at mount time; a
 * suite's own declaration stays source-owned and is never rewritten. The
 * per-server enable switch stays plugin state under the data root.
 */
import type { LspLegacySeam, LspLegacySeamMigration, LspStatusPayload } from '../contracts/lsp-status.js'
import { loadLspServers, saveLspServers } from './lsp/lsp-direct-config.js'
import { loadDisabledLspServers, saveDisabledLspServers } from './lsp/lsp-server-state.js'
import { buildLspStatus } from './lsp/lsp-status.js'
import { describeLegacySeam, findLegacyLspSeams, migrateLegacyLspSeam } from './lsp/profile-seam.js'
import { applyLspOverrides, lspConfig, validateServerLsp } from './server-config.js'
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
    const payload = buildLspStatus(await applyLspOverrides(this.context.dataRoot, snapshot.suites), this.ports.lspStatusSource, direct)
    // The profile scan is filesystem work, so it runs only while the conflict
    // it explains is actually on screen — the panel polls this while rows start.
    if (payload.entries.some(entry => entry.state === 'conflict')) payload.legacySeam = await this.legacySeam()
    return payload
  }

  /** The profile layer behind a reported seam conflict, when one can be found. */
  private async legacySeam(): Promise<LspLegacySeam | undefined> {
    const seams = await findLegacyLspSeams()
    const seam = seams[0]
    if (seam === undefined) return undefined
    return {
      profile: seam.profile,
      patchPath: seam.patchPath,
      rows: seam.rows.map(row => ({ id: row.id, name: row.name })),
      otherProfiles: seams.slice(1).map(other => other.profile),
      restartRequired: seam.patchReload !== 'live',
      summary: describeLegacySeam(seam)
    }
  }

  /**
   * Remove one profile's legacy LSP layer, then re-reconcile.
   *
   * The removal edits a file the user owns, so the profile is matched against
   * what was actually found on disk instead of trusting the request.
   */
  async migrateLegacySeam(profile: string): Promise<LspLegacySeamMigration> {
    return this.context.enqueue(async () => {
      const seams = await findLegacyLspSeams()
      const seam = seams.find(candidate => candidate.profile === profile)
      if (seam === undefined) throw new Error(`the profile "${profile}" no longer registers an LSP layer`)
      const result = await migrateLegacyLspSeam(seam)
      await this.context.notifyChanged(true)
      return { profile: result.profile, patchPath: result.patchPath, backupPath: result.backupPath, restartRequired: result.restartRequired }
    })
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
