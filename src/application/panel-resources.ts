/** Installed suite and user resources share one inventory; paths never come from HTTP callers. */
import { readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import type { UserPanelEntryWire, UserPanelKind } from '../contracts/market.js'
import { listMdFiles } from '../catalog/surfaces.js'
import { stripFrontmatter } from '../catalog/skills-parse.js'
import { parseFrontmatterRecord } from '../runtime/user-store.js'
import type { UserPanelStore } from '../runtime/user-panels.js'
import type { Catalog } from './catalog.js'

/** The routes consume this structural surface, also implemented by user-only stores in tests. */
export interface PanelResourceStore {
  list(): Promise<UserPanelEntryWire[]>
  get(id: string): Promise<UserPanelEntryWire | undefined>
  create(name: string, text: string): Promise<UserPanelEntryWire>
  update(id: string, text: string): Promise<void>
  remove(id: string): Promise<void>
}

export function createPanelResources(catalog: Catalog, users: Record<UserPanelKind, UserPanelStore>): Record<UserPanelKind, PanelResourceStore> {
  return {
    skills: new PanelResources(catalog, users.skills, 'skills'),
    commands: new PanelResources(catalog, users.commands, 'commands'),
    agents: new PanelResources(catalog, users.agents, 'agents')
  }
}

class PanelResources implements PanelResourceStore {
  constructor(
    private catalog: Catalog,
    private users: UserPanelStore,
    private kind: UserPanelKind
  ) {}

  async list(): Promise<UserPanelEntryWire[]> {
    const entries: UserPanelEntryWire[] = await this.users.list()
    const snapshot = await this.catalog.readUserCatalog()
    const installed = new Set((await this.catalog.overview()).suites.filter(suite => suite.installed).map(suite => JSON.stringify([suite.sourceId, suite.suiteId])))
    for (const suite of snapshot.suites) {
      if (!installed.has(JSON.stringify([suite.sourceId, suite.id])) || suite.remote !== undefined) continue
      const files =
        this.kind === 'skills'
          ? suite.skills.map(skill => ({ name: skill.name, file: skill.file }))
          : (await listMdFiles(join(suite.root, this.kind))).map(file => ({ name: file.slice(0, -3), file: join(suite.root, this.kind, file) }))
      for (const { name, file } of files) {
        const rawText = await readFile(file, 'utf8')
        let metadata: Record<string, unknown>
        try {
          metadata = parseFrontmatterRecord(rawText)
        } catch (error) {
          metadata = { disabled: true, validationError: String(error) }
        }
        entries.push({
          id: JSON.stringify([suite.sourceId, suite.id, this.kind, name]),
          name,
          origin: 'plugin',
          suiteName: suite.manifest.name,
          disabled: !suite.enabled || suite.activeSurfaces?.[this.kind] === false || metadata.disabled === true,
          metadata,
          rawText,
          content: stripFrontmatter(rawText),
          path: file,
          description: typeof metadata.description === 'string' ? metadata.description : ''
        })
      }
    }
    return entries
  }

  async get(id: string): Promise<UserPanelEntryWire | undefined> {
    return (await this.list()).find(entry => (entry.id ?? entry.name) === id)
  }

  create(name: string, text: string): Promise<UserPanelEntryWire> {
    return this.users.create(name, text)
  }

  private async pluginPath(id: string): Promise<string> {
    const entry = await this.get(id)
    if (entry?.origin !== 'plugin') throw new Error('Unknown installed plugin resource')
    const root = await realpath(this.users.root())
    const path = await realpath(entry.path)
    const rel = relative(root, path)
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('External source files are read-only; create a user resource to customize them')
    return path
  }

  async update(id: string, text: string): Promise<void> {
    if (!id.startsWith('[')) return this.users.update(id, text)
    parseFrontmatterRecord(text)
    await writeFile(await this.pluginPath(id), text, 'utf8')
  }

  async remove(id: string): Promise<void> {
    if (!id.startsWith('[')) return this.users.remove(id)
    await unlink(await this.pluginPath(id))
  }
}
