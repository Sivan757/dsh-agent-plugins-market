/**
 * User panel storage: the persistence layer behind the skills / commands /
 * agent-personas panels. Each surface owns one directory of Markdown
 * documents under the shared Agent layout root (`~/.agents/<kind>/`), so
 * user-authored entries survive restarts, are trivially hand-editable, and
 * stay outside suite checkouts.
 *
 * Skills entries follow the SKILL.md frontmatter grammar (`name`,
 * `description`, optional `whenToUse`, invocation controls) plus a
 * `disabled: true` panel control; commands follow Claude Code command
 * frontmatter (`description`, optional `argument-hint`, `disabled`); agent
 * personas follow Claude Code agents frontmatter (`name`, `description`,
 * optional `whenToUse`, `tools`, `model`, `disabled`).
 *
 * Every panel reads the flat `<name>.md` children of its directory. The
 * commands and agent-persona panels also read every `.md` document at any
 * depth, addressing a nested entry by its path relative to the panel
 * directory (`git/commit`, `review/code`), so subdirectories another Agent
 * tool writes are picked up. The skills panel keeps the cross-tool
 * `<name>/SKILL.md` directory spelling and reads it from the top level only,
 * matching the harness's own reader of `~/.agents/skills`.
 *
 * An entry's name is the one its document declares — the same name the
 * harness reader derives from that file — else its document name, and the
 * panel addresses, edits, and deletes the entry by that name. A document that
 * reader would reject is listed disabled with the reason instead of joining
 * the catalog, and a skill is switched off by writing that reader's own
 * invocation controls, so the off state lives in the file rather than in this
 * provider.
 * @module runtime/user-panels
 */

import { dirname } from 'node:path'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillSource } from '@deepseek-ai/dsh-skill'
import { skillEntryRejection } from '../catalog/skills-parse.js'
import {
  deleteEntryDocument,
  entryExists,
  listEntryDocuments,
  listEntryFiles,
  readEntryDocument,
  resolveEntryDocument,
  SKILL_ENTRY_SHAPES,
  USER_ENTRY_NAME,
  USER_ENTRY_PATH,
  userEntryDir,
  writeEntryDocument,
  writeEntryFile,
  type EntryDocument,
  type EntryShape,
  type UserEntryFile
} from './user-store.js'
/** The skill-source label user-panel entries carry into the skill registry. */
export const USER_PANEL_SKILL_SOURCE = 'user-panel' satisfies SkillSource

/**
 * Panel skills register ahead of the harness reader that maps this same
 * directory (`dsh-skill-filesystem` roots `~/.agents/skills` as `user-agents`
 * at rank 500), so the panel's localized description and its name precedence
 * apply to the entries it serves. Project roots (100-300) and the user's
 * `~/.dsh` skills (400) still outrank it, and it beats the suite user rank
 * (450), so a skill the user wrote by hand wins over one an installed suite
 * ships under the same name.
 *
 * Switching a skill off is not this provider's job: the panel writes the
 * harness's own invocation pair into the document, which every reader of that
 * file honors.
 */
const USER_PANEL_RANK = 440

/** A user panel entry as the HTTP layer serializes it. */
export interface UserPanelEntry {
  /**
   * Entry name: the name its document declares, else its document name — the
   * file's base name, or, on a nested panel, the document's path relative to
   * the panel directory (`git/commit`).
   */
  name: string
  description: string
  /** True when the entry is disabled, either by its `disabled` frontmatter key or by a failed validation. */
  disabled: boolean
  /** The parsed frontmatter record (name, description, hint, tools, model, …). */
  metadata: Record<string, unknown>
  /** Absolute file path. */
  path: string
  /** How the entry is spelled on disk. */
  shape: EntryShape
  /** The body after frontmatter removal. */
  content: string
  rawText: string
  origin: 'user'
}

/** How one panel store treats names and on-disk spellings. */
export interface UserPanelStoreOptions {
  /** Extra grammar one path segment must satisfy (runs after USER_ENTRY_NAME on each segment). */
  extraNameCheck?: (name: string) => boolean
  /** The document spellings this panel serves, most preferred first. */
  shapes?: readonly EntryShape[]
  /**
   * Read every subdirectory of the panel directory and address an entry by its
   * path relative to that directory. Off for the skills panel, whose reader
   * sees top-level documents only.
   */
  nested?: boolean
  /**
   * Rejection for a document this panel must not register, or `undefined` when
   * it may. Skills validate against the harness reader that shares their
   * directory; commands and personas are this plugin's own surfaces.
   */
  validate?: (file: UserEntryFile) => string | undefined
  /**
   * Read the harness's own invocation controls as this panel's disabled state:
   * a document that switches both off (`disable-model-invocation: true` and
   * `user-invocable: false`) is off here too, which is the state every reader
   * of the file agrees on. Only the skills panel sets it; commands and
   * personas are switched through the panel's own `disabled` key.
   */
  honorInvocationControls?: boolean
}

/** Throwing CRUD over one panel directory, shared by the three panels. */
export class UserPanelStore {
  private readonly shapes: readonly EntryShape[]
  private readonly extraNameCheck: (name: string) => boolean
  private readonly namePattern: RegExp
  private readonly nested: boolean
  private readonly validate: ((file: UserEntryFile) => string | undefined) | undefined
  private readonly honorInvocationControls: boolean

  constructor(
    private readonly agentsRoot: string,
    private readonly kind: 'skills' | 'commands' | 'agents',
    options: UserPanelStoreOptions = {}
  ) {
    this.shapes = options.shapes ?? ['file']
    this.extraNameCheck = options.extraNameCheck ?? (() => true)
    this.nested = options.nested === true
    this.namePattern = this.nested ? USER_ENTRY_PATH : USER_ENTRY_NAME
    this.validate = options.validate
    this.honorInvocationControls = options.honorInvocationControls === true
  }

  /** The panel's directory under the Agent layout root. */
  dirPath(): string {
    return userEntryDir(this.agentsRoot, this.kind)
  }

  private get dir(): string {
    return this.dirPath()
  }

  /** The path grammar plus the panel's per-segment extra grammar. */
  private validName(name: string): boolean {
    return this.namePattern.test(name) && name.split('/').every(segment => this.extraNameCheck(segment))
  }

  /**
   * Resolve the document one entry name addresses. The name a panel entry
   * carries is the one its document declares, which is only the document path
   * by convention, so a name that matches no path is matched against the
   * declared names of the served documents.
   */
  private async document(name: string): Promise<EntryDocument | undefined> {
    const direct = await resolveEntryDocument(this.dir, name, this.shapes, false, this.nested)
    if (direct !== undefined) return direct
    for (const candidate of await listEntryDocuments(this.dir, false, this.shapes, this.nested)) {
      const file = await readEntryDocument(candidate)
      if (file?.name === name) return candidate
    }
    return undefined
  }

  /** Every entry, sorted by name; strict snapshots propagate temporary I/O failures. */
  async list(strict = false): Promise<UserPanelEntry[]> {
    const files = await listEntryFiles(this.dir, strict, this.shapes, this.nested)
    return files.map(file => this.serialize(file))
  }

  /** One entry's full record, including the raw file text. */
  async get(name: string): Promise<UserPanelEntry | undefined> {
    const document = await this.document(name)
    if (document === undefined) return undefined
    const file = await readEntryDocument(document)
    return file === undefined ? undefined : this.serialize(file)
  }

  /**
   * Project one parsed file onto the wire shape. The description prefers the
   * strict frontmatter parse (multi-line YAML like `description: |` survives
   * intact there) and falls back to the shallow line record.
   *
   * A document the panel must not register stays listed and editable but reads
   * as disabled with the reason in its metadata, the same shape an unparseable
   * frontmatter already produced — hiding it would leave the user no way to
   * find or fix it.
   */
  private serialize(file: UserEntryFile): UserPanelEntry {
    const strictDescription = typeof file.description === 'string' && file.description !== '' ? file.description : undefined
    const shallowDescription = typeof file.meta['description'] === 'string' && file.meta['description'] !== '' ? file.meta['description'] : ''
    const parseError = typeof file.meta['validationError'] === 'string' ? file.meta['validationError'] : undefined
    const rejection = parseError ?? this.validate?.(file)
    // Both invocation controls off is the panel's off state as well: the switch
    // writes that pair, and either key alone is an authoring choice (a
    // user-invocable-only skill, for instance) that stays switched on.
    const invocationOff = this.honorInvocationControls && file.invocation !== undefined && !file.invocation.modelInvocable && !file.invocation.userInvocable
    return {
      // The declared name is the entry's name; a document that declares none
      // the registry would accept is listed under its own file name, which is
      // the name that keeps it addressable and fixable. `path` carries the
      // document either way.
      name: rejection === undefined ? file.name : file.documentName,
      description: strictDescription ?? shallowDescription,
      disabled: file.meta['disabled'] === true || invocationOff || rejection !== undefined,
      metadata: rejection === undefined ? file.meta : { ...file.meta, disabled: true, validationError: rejection },
      path: file.file,
      shape: file.shape,
      content: file.body,
      rawText: file.text,
      origin: 'user'
    }
  }

  /** Create an entry; refuses an occupied name. New entries use the flat `<name>.md` spelling, creating any parent directories. */
  async create(name: string, text: string): Promise<UserPanelEntry> {
    if (!this.validName(name)) throw new Error(`invalid name "${name}" — use lowercase letters, digits, and dashes, starting with a letter or digit`)
    if (await entryExists(this.dir, name, this.shapes, this.nested)) throw new Error(`an entry named "${name}" already exists`)
    await writeEntryFile(this.dir, name, text)
    const created = await this.get(name)
    if (created === undefined) throw new Error(`entry "${name}" vanished after write`)
    return created
  }

  /** Replace one entry's content wholesale, keeping the spelling it already has. */
  async update(name: string, text: string): Promise<void> {
    if (!this.validName(name)) throw new Error(`invalid entry name "${name}"`)
    const document = await this.document(name)
    if (document === undefined) throw new Error(`no entry named "${name}"`)
    await writeEntryDocument(document, text)
  }

  /** Delete one entry; a missing file is a no-op (idempotent delete). */
  async remove(name: string): Promise<void> {
    if (!this.namePattern.test(name)) throw new Error(`invalid entry name "${name}"`)
    const document = await this.document(name)
    if (document === undefined) return
    await deleteEntryDocument(document)
  }
}

/** Locate the three stores; constructed once per plugin activation. */
export function createUserPanelStores(agentsRoot: string): {
  skills: UserPanelStore
  commands: UserPanelStore
  agents: UserPanelStore
} {
  return {
    skills: new UserPanelStore(agentsRoot, 'skills', {
      extraNameCheck: isUserSkillEntryName,
      shapes: SKILL_ENTRY_SHAPES,
      validate: file => skillEntryRejection(file.text),
      honorInvocationControls: true
    }),
    commands: new UserPanelStore(agentsRoot, 'commands', { nested: true }),
    agents: new UserPanelStore(agentsRoot, 'agents', { extraNameCheck: isUserSkillEntryName, nested: true })
  }
}

/**
 * The skills/agents panels accept only harness skill-grammar path segments
 * (`[a-z0-9-]`, no underscores): a candidate name reaching the skill
 * registry's `get()` with an invalid name is dropped there, and several
 * consumers validate strictly, so `_`-named entries would be dead weight. A
 * nested persona applies this to each segment. Commands keep the looser
 * command grammar (`_` allowed).
 */
export function isUserSkillEntryName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

interface UserSkillLocator {
  name: string
}

/**
 * Skill provider over user skills only. Agent definitions belong to the
 * subagent catalog and never become skill candidates or slash entries.
 */
export class UserPanelSkillProvider implements SkillProvider {
  readonly name = 'user-panel'

  constructor(private readonly skills: UserPanelStore) {}

  async list(_options: SkillLookupOptions): Promise<SkillCandidate[]> {
    const candidates: SkillCandidate[] = []
    const skills = await this.skills.list()
    for (const entry of skills) {
      if (entry.disabled || !isUserSkillEntryName(entry.name)) continue
      candidates.push({
        // The entry's name is the one its document declares, which is also the
        // name the harness's own reader derives from the same file.
        name: entry.name,
        // The entry's own description verbatim; a user-entry label is our
        // packaging, and this description reaches the same model-facing
        // catalog a suite skill does.
        description: entry.description === '' ? entry.name : entry.description,
        ...(typeof entry.metadata['whenToUse'] === 'string' && entry.metadata['whenToUse'] !== '' ? { whenToUse: entry.metadata['whenToUse'] } : {}),
        invocation: {
          modelInvocable: entry.metadata['disable-model-invocation'] !== true,
          userInvocable: entry.metadata['user-invocable'] !== false
        },
        source: USER_PANEL_SKILL_SOURCE,
        provider: this.name,
        rank: USER_PANEL_RANK,
        locator: { name: entry.name } satisfies UserSkillLocator,
        path: entry.path,
        resourceBase: { kind: 'directory', path: this.resourceDirectory(entry) }
      })
    }
    return candidates
  }

  async get(candidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as UserSkillLocator
    const store = this.skills
    const entry = await store.get(locator.name)
    if (entry === undefined || entry.disabled) return undefined
    return {
      name: candidate.name,
      description: candidate.description,
      ...(typeof entry.metadata['whenToUse'] === 'string' && entry.metadata['whenToUse'] !== '' ? { whenToUse: entry.metadata['whenToUse'] } : {}),
      invocation: candidate.invocation,
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: this.resourceDirectory(entry) },
      path: entry.path,
      content: entry.content
    }
  }

  /**
   * Relative resources resolve beside the document that references them: a
   * directory-shaped skill owns `references/`, `scripts/` and the like next to
   * its `SKILL.md`, while a flat entry resolves against the panel directory.
   */
  private resourceDirectory(entry: UserPanelEntry): string {
    return entry.shape === 'skill-directory' ? dirname(entry.path) : this.skills.dirPath()
  }
}
