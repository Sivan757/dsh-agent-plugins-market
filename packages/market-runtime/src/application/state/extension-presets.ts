/** Workspace-owned extension presets. Reads do not cache; writers serialize across local host processes. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { writeJsonDocument } from '../../../../market-catalog/src/index.js'
import {
  parseExtensionIds,
  parseExtensionName,
  stripConfigurationParentIds,
  type ExtensionPreset,
  type ExtensionPresetInput,
  type ExtensionPresetLibrary
} from '../../../../market-contracts/src/contracts/extension-presets.js'

export class ExtensionPresetError extends Error {
  constructor(
    readonly code: 'preset-conflict' | 'preset-not-found' | 'preset-name-conflict' | 'preset-state-invalid',
    message: string
  ) {
    super(message)
    this.name = 'ExtensionPresetError'
  }
}

function workspaceKey(workspace: string): string {
  if (!isAbsolute(workspace)) throw new Error('extension presets require an absolute workspace')
  return normalize(workspace)
}

/** The workspace path is validated and hashed; names and clipboard data never determine a path. */
export function extensionPresetLibraryPath(dataRoot: string, workspace: string): string {
  return join(dataRoot, 'extension-presets', createHash('sha256').update(workspaceKey(workspace)).digest('hex') + '.json')
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ExtensionPresetError('preset-state-invalid', 'invalid extension preset state')
  return value as Record<string, unknown>
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
    throw new ExtensionPresetError('preset-state-invalid', 'invalid extension preset revision')
  }
  return value
}

function parsePreset(value: unknown): ExtensionPreset {
  const row = record(value)
  if (typeof row.id !== 'string' || row.id === '' || row.id.length > 128 || row.revision === 0) {
    throw new ExtensionPresetError('preset-state-invalid', 'invalid extension preset identity')
  }
  return { id: row.id, revision: revision(row.revision), name: parseExtensionName(row.name), enabledIds: parseExtensionIds(row.enabledIds) }
}

function parseLibrary(value: unknown, workspace: string): ExtensionPresetLibrary {
  if (value === undefined) return { revision: 0, defaultPresetId: null, presets: [] }
  const document = record(value)
  if (document.version !== 1 || document.workspace !== workspaceKey(workspace) || !Array.isArray(document.presets) || document.presets.length > 256) {
    throw new ExtensionPresetError('preset-state-invalid', 'invalid workspace extension preset library')
  }
  const presets = document.presets.map(parsePreset)
  if (new Set(presets.map(preset => preset.id)).size !== presets.length || new Set(presets.map(preset => preset.name)).size !== presets.length) {
    throw new ExtensionPresetError('preset-state-invalid', 'duplicate extension preset identity or name')
  }
  const defaultId = document.defaultPresetId
  if (defaultId !== null && (typeof defaultId !== 'string' || !presets.some(preset => preset.id === defaultId))) {
    throw new ExtensionPresetError('preset-state-invalid', 'extension default refers to a missing preset')
  }
  return { revision: revision(document.revision), defaultPresetId: defaultId, presets }
}

export class ExtensionPresetStore {
  constructor(private readonly dataRoot: string) {}

  /** Read current disk state; corruption and access failures reject rather than erasing saved choices. */
  async read(workspace: string): Promise<ExtensionPresetLibrary> {
    let text: string
    try {
      text = await readFile(extensionPresetLibraryPath(this.dataRoot, workspace), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return parseLibrary(undefined, workspace)
      throw error
    }
    try {
      return parseLibrary(JSON.parse(text), workspace)
    } catch {
      throw new ExtensionPresetError('preset-state-invalid', 'invalid workspace extension preset library')
    }
  }

  /** Create a named preset at the caller's observed library revision; configuration parents never persist. */
  create(workspace: string, expectedRevision: number, input: ExtensionPresetInput): Promise<ExtensionPresetLibrary> {
    const parsed = { name: parseExtensionName(input.name), enabledIds: stripConfigurationParentIds(parseExtensionIds(input.enabledIds)) }
    return this.mutate(workspace, expectedRevision, library => {
      if (library.presets.length >= 256) throw new Error('workspace extension preset limit reached')
      this.assertName(library, parsed.name)
      library.presets.push({ ...parsed, id: randomUUID(), revision: 1 })
    })
  }

  /** Replace one preset and advance its revision; existing session snapshots are not touched. */
  update(workspace: string, expectedRevision: number, id: string, input: ExtensionPresetInput): Promise<ExtensionPresetLibrary> {
    const parsed = { name: parseExtensionName(input.name), enabledIds: stripConfigurationParentIds(parseExtensionIds(input.enabledIds)) }
    return this.mutate(workspace, expectedRevision, library => {
      const preset = this.requirePreset(library, id)
      this.assertName(library, parsed.name, id)
      Object.assign(preset, parsed, { revision: revision(preset.revision) + 1 })
    })
  }

  /** Choose only the default for future sessions. Null captures global choices for new sessions. */
  setDefault(workspace: string, expectedRevision: number, id: string | null): Promise<ExtensionPresetLibrary> {
    return this.mutate(workspace, expectedRevision, library => {
      if (id !== null) this.requirePreset(library, id)
      library.defaultPresetId = id
    })
  }

  /** Delete a preset and clear its default pointer atomically; sessions retain their copies. */
  delete(workspace: string, expectedRevision: number, id: string): Promise<ExtensionPresetLibrary> {
    return this.mutate(workspace, expectedRevision, library => {
      this.requirePreset(library, id)
      library.presets = library.presets.filter(preset => preset.id !== id)
      if (library.defaultPresetId === id) library.defaultPresetId = null
    })
  }

  private requirePreset(library: ExtensionPresetLibrary, id: string): ExtensionPreset {
    const preset = library.presets.find(preset => preset.id === id)
    if (preset === undefined) throw new ExtensionPresetError('preset-not-found', 'extension preset no longer exists')
    return preset
  }

  private assertName(library: ExtensionPresetLibrary, name: string, exceptId?: string): void {
    if (library.presets.some(preset => preset.name === name && preset.id !== exceptId)) {
      throw new ExtensionPresetError('preset-name-conflict', 'an extension preset with this name already exists')
    }
  }

  private async mutate(workspace: string, expectedRevision: number, change: (library: ExtensionPresetLibrary) => void): Promise<ExtensionPresetLibrary> {
    revision(expectedRevision)
    const path = extensionPresetLibraryPath(this.dataRoot, workspace)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    return withFileLock(path, async () => {
      const library = await this.read(workspace)
      if (library.revision !== expectedRevision) throw new ExtensionPresetError('preset-conflict', 'extension presets changed; reload before saving')
      change(library)
      library.revision++
      await writeJsonDocument(path, { version: 1, workspace: workspaceKey(workspace), ...library })
      return library
    })
  }
}
