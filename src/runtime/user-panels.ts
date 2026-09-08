/**
 * User panel storage: the persistence layer behind the skills / commands /
 * agent-personas panels. Each surface owns one directory of Markdown files
 * under `<userRoot>/user/<kind>/`, so user-authored entries survive restarts,
 * are trivially hand-editable, and stay outside suite checkouts.
 *
 * Skills entries follow the SKILL.md frontmatter grammar (`name`,
 * `description`, optional `whenToUse`, invocation controls) plus a
 * `disabled: true` panel control; commands follow Claude Code command
 * frontmatter (`description`, optional `argument-hint`, `disabled`); agent
 * personas follow Claude Code agents frontmatter (`name`, `description`,
 * optional `whenToUse`, `tools`, `model`, `disabled`).
 * @module runtime/user-panels
 */

import { join } from 'node:path'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillSource } from '@deepseek-ai/dsh-skill'
import { deleteEntryFile, entryExists, listEntryFiles, readEntryFile, USER_ENTRY_NAME, userEntryDir, writeEntryFile, type UserEntryFile } from './user-store.js'
import type { HostTranslate } from './host-locale.js'
/** The skill-source label user-panel entries carry into the skill registry. */
export const USER_PANEL_SKILL_SOURCE = 'user-panel' satisfies SkillSource
/** Agent personas register as `persona-<name>` skills with this source. */
export const USER_PERSONA_SKILL_SOURCE = 'user-persona' satisfies SkillSource

/** Ranks sit behind every shipped root so real files always win a name clash. */
const USER_PANEL_RANK = 600
const USER_PERSONA_RANK = 610

/** A user panel entry as the HTTP layer serializes it. */
export interface UserPanelEntry {
  /** Entry identity: the file's base name. */
  name: string
  description: string
  /** True when the entry is disabled through its `disabled` frontmatter key. */
  disabled: boolean
  /** The parsed frontmatter record (name, description, hint, tools, model, …). */
  metadata: Record<string, unknown>
  /** Absolute file path. */
  path: string
  /** The body after frontmatter removal. */
  content: string
  rawText: string
  origin: 'user'
}

/** Throwing CRUD over one panel directory, shared by the three panels. */
export class UserPanelStore {
  constructor(
    private readonly dataRoot: string,
    private readonly kind: 'skills' | 'commands' | 'agents',
    /** Extra name grammar for this panel (runs after USER_ENTRY_NAME). */
    private readonly extraNameCheck: (name: string) => boolean = () => true
  ) {}

  /** The panel's directory under the data root. */
  dirPath(): string {
    return userEntryDir(this.dataRoot, this.kind)
  }

  /** The plugin data root the panel lives under. */
  root(): string {
    return this.dataRoot
  }

  private get dir(): string {
    return this.dirPath()
  }

  /** Every entry, sorted by name; missing metadata falls back to the name. */
  async list(): Promise<UserPanelEntry[]> {
    const files = await listEntryFiles(this.dir)
    return files.map(file => this.serialize(file))
  }

  /** One entry's full record, including the raw file text. */
  async get(name: string): Promise<UserPanelEntry | undefined> {
    if (!USER_ENTRY_NAME.test(name)) return undefined
    const file = await readEntryFile(join(this.dir, `${name}.md`), name)
    if (file === undefined) return undefined
    return this.serialize(file)
  }

  /**
   * Project one parsed file onto the wire shape. The description prefers the
   * strict frontmatter parse (multi-line YAML like `description: |` survives
   * intact there) and falls back to the shallow line record.
   */
  private serialize(file: UserEntryFile): UserPanelEntry {
    const strictDescription = typeof file.description === 'string' && file.description !== '' ? file.description : undefined
    const shallowDescription = typeof file.meta['description'] === 'string' && file.meta['description'] !== '' ? file.meta['description'] : ''
    return {
      name: file.fallbackName,
      description: strictDescription ?? shallowDescription,
      disabled: file.meta['disabled'] === true,
      metadata: file.meta,
      path: file.file,
      content: file.body,
      rawText: file.text,
      origin: 'user'
    }
  }

  /** Create an entry; refuses an occupied name. */
  async create(name: string, text: string): Promise<UserPanelEntry> {
    if (!USER_ENTRY_NAME.test(name) || !this.extraNameCheck(name))
      throw new Error(`invalid name "${name}" — use lowercase letters, digits, and dashes, starting with a letter or digit`)
    if (await entryExists(this.dir, name)) throw new Error(`an entry named "${name}" already exists`)
    await writeEntryFile(this.dir, name, text)
    const created = await this.get(name)
    if (created === undefined) throw new Error(`entry "${name}" vanished after write`)
    return created
  }

  /** Replace one entry's file content wholesale. */
  async update(name: string, text: string): Promise<void> {
    if (!USER_ENTRY_NAME.test(name) || !this.extraNameCheck(name)) throw new Error(`invalid entry name "${name}"`)
    if (!(await entryExists(this.dir, name))) throw new Error(`no entry named "${name}"`)
    await writeEntryFile(this.dir, name, text)
  }

  /** Delete one entry; a missing file is a no-op (idempotent delete). */
  async remove(name: string): Promise<void> {
    if (!USER_ENTRY_NAME.test(name)) throw new Error(`invalid entry name "${name}"`)
    await deleteEntryFile(this.dir, name)
  }
}

/** Locate the three stores; constructed once per plugin activation. */
export function createUserPanelStores(dataRoot: string): {
  skills: UserPanelStore
  commands: UserPanelStore
  agents: UserPanelStore
} {
  return {
    skills: new UserPanelStore(dataRoot, 'skills', isUserSkillEntryName),
    commands: new UserPanelStore(dataRoot, 'commands'),
    agents: new UserPanelStore(dataRoot, 'agents', isUserSkillEntryName)
  }
}

/**
 * The skills/agents panels accept only harness skill-grammar names
 * (`[a-z0-9-]`, no underscores): a candidate name reaching the skill
 * registry's `get()` with an invalid name is dropped there, and several
 * consumers validate strictly, so `_`-named entries would be dead weight.
 * Commands keep the looser command grammar (`_` allowed).
 */
export function isUserSkillEntryName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

interface UserSkillLocator {
  kind: 'skill' | 'persona'
  name: string
}

/**
 * Skill provider over the user skills and agent-personas panels. Disabled
 * entries (frontmatter `disabled: true`) never surface in discovery; skills
 * register under their own names and personas under `persona-<name>`, so the
 * model can load a persona card as an instruction body without colliding
 * with suite skills of the same name.
 */
export class UserPanelSkillProvider implements SkillProvider {
  readonly name = 'user-panel'

  constructor(
    private readonly skills: UserPanelStore,
    private readonly personas: UserPanelStore,
    private readonly t: HostTranslate
  ) {}

  async list(_options: SkillLookupOptions): Promise<SkillCandidate[]> {
    const candidates: SkillCandidate[] = []
    const [skills, personas] = await Promise.all([this.skills.list(), this.personas.list()])
    for (const entry of skills) {
      if (entry.disabled || !isUserSkillEntryName(entry.name)) continue
      candidates.push({
        name: entry.name,
        description: this.t('userSkillDescription', { description: entry.description === '' ? entry.name : entry.description }),
        ...(typeof entry.metadata['whenToUse'] === 'string' && entry.metadata['whenToUse'] !== '' ? { whenToUse: entry.metadata['whenToUse'] } : {}),
        invocation: {
          modelInvocable: entry.metadata['disable-model-invocation'] !== true,
          userInvocable: entry.metadata['user-invocable'] !== false
        },
        source: USER_PANEL_SKILL_SOURCE,
        provider: this.name,
        rank: USER_PANEL_RANK,
        locator: { kind: 'skill', name: entry.name } satisfies UserSkillLocator,
        path: entry.path,
        resourceBase: { kind: 'directory', path: this.skills.dirPath() }
      })
    }
    for (const entry of personas) {
      if (entry.disabled || !isUserSkillEntryName(entry.name)) continue
      const description = this.t('userPersonaDescription', { description: entry.description === '' ? entry.name : entry.description })
      candidates.push({
        name: `persona-${entry.name}`,
        description,
        ...(typeof entry.metadata['whenToUse'] === 'string' && entry.metadata['whenToUse'] !== '' ? { whenToUse: entry.metadata['whenToUse'] } : {}),
        invocation: { modelInvocable: true, userInvocable: true },
        source: USER_PERSONA_SKILL_SOURCE,
        provider: this.name,
        rank: USER_PERSONA_RANK,
        locator: { kind: 'persona', name: entry.name } satisfies UserSkillLocator,
        path: entry.path,
        resourceBase: { kind: 'directory', path: this.personas.dirPath() }
      })
    }
    return candidates
  }

  async get(candidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as UserSkillLocator
    const store = locator.kind === 'skill' ? this.skills : this.personas
    const entry = await store.get(locator.name)
    if (entry === undefined || entry.disabled) return undefined
    return {
      name: candidate.name,
      description: candidate.description,
      ...(typeof entry.metadata['whenToUse'] === 'string' && entry.metadata['whenToUse'] !== '' ? { whenToUse: entry.metadata['whenToUse'] } : {}),
      invocation: candidate.invocation,
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: store.dirPath() },
      path: entry.path,
      content:
        locator.kind === 'persona'
          ? `Use market_agent with action run and role ${JSON.stringify(entry.name)} to execute this role with its saved model and tool restrictions.\n\n${entry.content}`
          : entry.content
    }
  }
}
