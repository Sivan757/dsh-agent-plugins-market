/** Installed suite and user resources share one inventory; paths never come from HTTP callers. */
import { realpath, stat, unlink } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { UserPanelEntryWire, UserPanelKind } from '../contracts/market.js'
import { defaultMarkdownResources, resourceText } from '../catalog/component-files.js'
import { pluginRootOf } from '../catalog/plugin-variables.js'
import { isWithin, suiteDataDir } from '../catalog/paths.js'
import { stripFrontmatter } from '../catalog/skills-parse.js'
import { parseFrontmatterRecord } from './panels/user-store.js'
/** The user-panel store surface the panel resources drive (structural). */
interface UserPanelEntries {
  list(strict?: boolean): Promise<UserPanelEntryWire[]>
  create(name: string, text: string): Promise<UserPanelEntryWire>
  update(name: string, text: string): Promise<void>
  remove(name: string): Promise<void>
}
import type { Catalog } from './catalog.js'

/** The routes consume this structural surface, also implemented by user-only stores in tests. */
export interface PanelResourceStore {
  /** Strict runtime reads propagate I/O failures so catalogs cannot publish partial replacements. */
  list(strict?: boolean): Promise<UserPanelEntryWire[]>
  get(id: string): Promise<UserPanelEntryWire | undefined>
  create(name: string, text: string): Promise<UserPanelEntryWire>
  update(id: string, text: string): Promise<void>
  remove(id: string): Promise<void>
}

/**
 * Id of one panel entry backed by a file inside an installed suite's checkout.
 * The leading `[` is what distinguishes a plugin entry from a user-authored
 * one; `update`/`remove` use {@link isPluginResourceId} to tell them apart.
 */
export function pluginResourceId(sourceId: string, suiteId: string, kind: UserPanelKind, name: string): string {
  return JSON.stringify([sourceId, suiteId, kind, name])
}

/** Whether a panel entry id addresses a file inside an installed suite. */
export function isPluginResourceId(id: string): boolean {
  return id.startsWith('[')
}

export function createPanelResources(catalog: Catalog, users: Record<UserPanelKind, UserPanelEntries>): Record<UserPanelKind, PanelResourceStore> {
  return {
    skills: new PanelResources(catalog, users.skills, 'skills'),
    commands: new PanelResources(catalog, users.commands, 'commands'),
    agents: new PanelResources(catalog, users.agents, 'agents')
  }
}

class PanelResources implements PanelResourceStore {
  constructor(
    private catalog: Catalog,
    private users: UserPanelEntries,
    private kind: UserPanelKind
  ) {}

  async list(strict = false): Promise<UserPanelEntryWire[]> {
    const entries: UserPanelEntryWire[] = await this.users.list(strict)
    const snapshot = await this.catalog.readUserCatalog()
    for (const suite of snapshot.suites) {
      if (!this.catalog.isInstalled(suite.sourceId, suite.id) || suite.remote !== undefined) continue
      const files =
        this.kind === 'skills'
          ? suite.skills.map(skill => ({ name: skill.name, file: skill.file }))
          : (suite.resources?.[this.kind] ?? (await defaultMarkdownResources(suite.root, this.kind)))
      for (const resource of files) {
        const { name, file } = resource
        const rawText = await resourceText(resource).catch(error => {
          if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          return undefined
        })
        if (rawText === undefined) continue
        let metadata: Record<string, unknown>
        try {
          metadata = parseFrontmatterRecord(rawText)
        } catch (error) {
          metadata = { disabled: true, validationError: String(error) }
        }
        entries.push({
          id: pluginResourceId(suite.sourceId, suite.id, this.kind, name),
          name,
          origin: 'plugin',
          suiteName: suite.manifest.name,
          disabled: !suite.enabled || suite.activeSurfaces[this.kind] === false || metadata.disabled === true,
          metadata,
          rawText,
          content: stripFrontmatter(rawText),
          path: file,
          description: typeof metadata.description === 'string' ? metadata.description : '',
          ...(pluginRootOf(suite) === undefined ? {} : { suiteRoot: suite.root, suiteData: suiteDataDir(this.catalog.dataRoot, suite.sourceId, suite.id) })
        })
      }
    }
    // One pass stamps each entry's own last modification: the panel reads every
    // file's text anyway, and both origins get the same treatment here.
    return await Promise.all(
      entries.map(async entry => {
        try {
          const stats = await stat(entry.path)
          return { ...entry, updatedAt: new Date(stats.mtimeMs).toISOString() }
        } catch {
          return entry
        }
      })
    )
  }

  async get(id: string): Promise<UserPanelEntryWire | undefined> {
    return (await this.list()).find(entry => (entry.id ?? entry.name) === id)
  }

  create(name: string, text: string): Promise<UserPanelEntryWire> {
    return this.users.create(name, text)
  }

  /**
   * A plugin resource is writable only when it sits inside the user dimension
   * root; suite checkouts elsewhere on disk stay read-only. The user-panel
   * store lives in the shared Agent layout root instead, so containment is
   * measured against the catalog's root, not the panel directory.
   */
  private async pluginPath(id: string): Promise<string> {
    const entry = await this.get(id)
    if (entry?.origin !== 'plugin') throw new Error('Unknown installed plugin resource')
    if (entry.path.endsWith('.json')) throw new Error('Inline manifest resources are read-only; edit their source manifest')
    const root = await realpath(this.catalog.userRoot)
    const path = await realpath(entry.path)
    if (!isWithin(root, path)) throw new Error('External source files are read-only; create a user resource to customize them')
    return path
  }

  async update(id: string, text: string): Promise<void> {
    if (!isPluginResourceId(id)) return this.users.update(id, text)
    parseFrontmatterRecord(text)
    await writeFileAtomic(await this.pluginPath(id), text, { mode: 0o644 })
  }

  async remove(id: string): Promise<void> {
    if (!isPluginResourceId(id)) return this.users.remove(id)
    await unlink(await this.pluginPath(id))
  }
}
