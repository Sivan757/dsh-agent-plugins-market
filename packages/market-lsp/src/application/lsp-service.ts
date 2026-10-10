/**
 * LSP use cases: the status surface, the user's direct server table, the
 * per-server enable switch, and the service-configuration editor for one
 * language-server declaration.
 *
 * Direct servers live in the shared Agent layout root (`~/.agents/lsp.json`)
 * and are merged with the suites' inline declarations at mount time; a
 * suite's own declaration stays source-owned and is never rewritten. The
 * per-server enable switch stays plugin state under the data root.
 */
import type { LspLegacySeam, LspLegacySeamMigration, LspStatusPayload } from '../../../market-contracts/src/contracts/lsp-status.js'
import { loadLspServers, saveLspServers } from './lsp/lsp-direct-config.js'
import { loadDisabledLspServers, saveDisabledLspServers } from './lsp/lsp-server-state.js'
import { buildLspStatus } from './lsp/lsp-status.js'
import { describeLegacySeam, findLegacyLspSeams, migrateLegacyLspSeam } from './lsp/profile-seam.js'
import type { ServerConfigPayload } from '../../../market-contracts/src/contracts/market.js'
import { qualifiedSuiteId } from '../../../market-catalog/src/index.js'
import { redactMcpConfig } from '../../../market-contracts/src/redaction.js'
import { restoreRedactedConfig } from '../../../market-contracts/src/redaction.js'
import { applyLspOverrides, lspConfig, saveLspOverride, validateServerLsp } from './lsp/validation.js'
import type { CatalogContext } from '../../../market-catalog/src/index.js'
import type { CatalogPorts, Localization, LocalizeFields, LspServerTable } from '../../../market-contracts/src/ports/ports.js'

export class LspService {
  constructor(
    private readonly context: CatalogContext,
    private readonly ports: CatalogPorts,
    private readonly localizeFields: LocalizeFields
  ) {}

  /** The LSP status surface: declared servers merged with mount diagnostics. */
  async status(): Promise<LspStatusPayload> {
    const snapshot = await this.context.snapshots.readUserCatalog()
    const direct = await loadLspServers(this.context.agentsRoot)
    // One preference read for the whole inventory: the host answers it by
    // projecting every active profile entry's live configuration, so resolving
    // it per declared server made this status scale with the server count.
    const localization: Localization = { locale: this.ports.localePreference(), localizeFields: this.localizeFields }
    const payload = buildLspStatus(await applyLspOverrides(this.context.dataRoot, snapshot.suites), this.ports.lspStatusSource, direct, localization)
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

  /** Read one LSP declaration without credential literals, or an unsaved creation template. */
  async serverConfig(id: string, create = false): Promise<ServerConfigPayload> {
    if (create) {
      return { kind: 'lsp', id: '', key: '', editable: true, config: { command: '', extensionToLanguage: {} } }
    }
    const config = await this.resolve(id)
    return { kind: 'lsp', id, key: config.key, editable: true, config: redactMcpConfig(config.value) as Record<string, unknown> }
  }

  /** Validate a complete replacement before writing; plugin checkouts remain untouched. */
  async saveServerConfig(id: string, config: unknown): Promise<void> {
    return this.context.enqueue(async () => {
      const current = await this.resolve(id)
      const value = restoreRedactedConfig(config, current.value)
      const server = validateServerLsp(current.key, value)
      if (current.suiteKey === 'direct') {
        const direct = await loadLspServers(this.context.agentsRoot)
        if (direct.errors.length > 0) throw new Error(direct.errors.join('; '))
        direct.servers[current.key] = server
        await saveLspServers(this.context.agentsRoot, { lspServers: Object.fromEntries(Object.entries(direct.servers).map(([key, spec]) => [key, lspConfig(spec)])) })
      } else await saveLspOverride(this.context.dataRoot, id, server)
      await this.context.notifyChanged(true)
    })
  }

  /**
   * Resolve one editable declaration: its key, owning suite, root, and the
   * public document the editor renders. A suite's replacement override is
   * applied first, so an edited declaration renders what will be mounted.
   */
  private async resolve(id: string): Promise<{ key: string; suiteKey: string; root: string; value: Record<string, unknown> }> {
    if (id.startsWith('direct/')) {
      const key = id.slice(7)
      const server = (await loadLspServers(this.context.agentsRoot)).servers[key]
      if (server === undefined) throw new Error('LSP server not found')
      return { key, suiteKey: 'direct', root: this.context.agentsRoot, value: lspConfig(server) }
    }
    const suites = await applyLspOverrides(this.context.dataRoot, (await this.context.snapshots.readUserCatalog()).suites)
    for (const suite of suites) {
      const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
      for (const [key, server] of Object.entries(suite.lsp?.servers ?? {})) {
        if (id === `${suiteKey}/${key}`) return { key, suiteKey, root: suite.root, value: lspConfig(server) }
      }
    }
    throw new Error('service configuration is not managed by this plugin')
  }
}
