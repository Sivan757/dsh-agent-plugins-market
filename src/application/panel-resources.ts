/** Installed suite and user resources share one inventory; paths never come from HTTP callers. */
import { readFile, realpath, stat } from 'node:fs/promises'
import { isDeepStrictEqual as deepEqual } from 'node:util'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { UserPanelEntryWire, UserPanelKind } from '../contracts/market.js'
import type { DocumentTranslation } from '../contracts/translation.js'
import { defaultMarkdownResources, resourceText } from '../catalog/component-files.js'
import { pluginRootOf } from '../catalog/plugin-variables.js'
import { isWithin, suiteDataDir } from '../catalog/paths.js'
import { parseSkillFrontmatter, stripFrontmatter } from '../catalog/skills-parse.js'
import { parseFrontmatterRecord } from './panels/user-store.js'
import type { LocalizeDocument, LocalizeFields } from './ports.js'
/**
 * The user-panel store surface the panel resources drive (structural).
 *
 * The store always reads whole documents, and only the single-entry read hands
 * one back over the wire; the raw text stays inside this module so the list
 * view never serializes it.
 */
interface UserPanelEntries {
  list(strict?: boolean): Promise<PanelEntryRecord[]>
  create(name: string, text: string): Promise<UserPanelEntryWire>
  update(name: string, text: string): Promise<void>
  remove(name: string): Promise<void>
}
import type { Catalog } from './catalog.js'
import type { CatalogSnapshot } from './snapshot-cache.js'

/** One panel entry with its document, as this module keeps it in memory. */
interface PanelEntryRecord extends UserPanelEntryWire {
  rawText: string
}

/** One in-memory row: the entry and the identity its translation fields are keyed by. */
interface PanelRow {
  entry: PanelEntryRecord
  translationId: string
  /**
   * Whether the suite or its surface toggle switched this entry off, kept apart
   * from the document's own state: the entry read re-derives the document half,
   * and recombining needs this half to survive it. Absent on user-authored rows,
   * which answer to no suite.
   */
  suiteDisabled?: boolean
}

/** The routes consume this structural surface, also implemented by user-only stores in tests. */
/** One panel read: the entries, and how many description fields it left in flight. */
export interface PanelRead {
  entries: UserPanelEntryWire[]
  /** Fields this read queued that have not landed yet; 0 means the text is settled. */
  translationPending: number
}

export interface PanelResourceStore {
  /**
   * Entries plus the translation work this read queued. A reader that wants the
   * translated text polls this until the count reaches zero; one that only
   * needs the rows calls {@link PanelResourceStore.list}.
   *
   * The rows carry no document text: it was the bulk of the response, and only
   * the one entry a reader opens needs it — {@link PanelResourceStore.get}.
   * @param strict - propagate I/O failures instead of skipping the entry.
   * @param force - re-derive every row instead of answering from the row cache;
   * the panel's Refresh button is what a user presses when they want the
   * working tree as it stands now.
   */
  read(strict?: boolean, force?: boolean): Promise<PanelRead>
  /** Strict runtime reads propagate I/O failures so catalogs cannot publish partial replacements. */
  list(strict?: boolean): Promise<UserPanelEntryWire[]>
  /**
   * One entry with the file's current document, for the surface that reads or
   * rewrites it. Every field the document itself supplies comes from one read of
   * it, so the answer is one revision of the entry rather than a fresh document
   * beside cached metadata.
   */
  get(id: string): Promise<UserPanelEntryWire | undefined>
  /**
   * One entry's document translated for the panel's locale, chunk by chunk.
   *
   * The entry is re-read here rather than accepted from the caller: the route
   * above it only names an entry, so a page cannot hand this layer arbitrary
   * text to spend the operator's translation quota on. The body is split and
   * the chunks this read could not answer for are queued; the caller polls
   * until `pending` reaches zero.
   */
  translateDocument(id: string): Promise<DocumentTranslation>
  create(name: string, text: string): Promise<UserPanelEntryWire>
  update(id: string, text: string): Promise<void>
  remove(id: string): Promise<void>
}

/**
 * Id of one suite-owned document, whichever surface addresses it. The leading
 * `[` is what distinguishes a plugin entry from a user-authored one;
 * `update`/`remove` use {@link isPluginResourceId} to tell them apart, and the
 * market detail page keys its document translations by the same value so one
 * file stays one cache entry across both surfaces.
 */
export function pluginResourceId(sourceId: string, suiteId: string, kind: UserPanelKind, name: string): string {
  return JSON.stringify([sourceId, suiteId, kind, name])
}

/** Whether a panel entry id addresses a file inside an installed suite. */
export function isPluginResourceId(id: string): boolean {
  return id.startsWith('[')
}

/**
 * Frontmatter keys beyond the enable switch that a panel control may diff on a
 * plugin document, per kind: the harness invocation pair on skills, and the
 * model-routing keys the persona form edits on agents.
 */
const FLIPPABLE_KEYS: Record<UserPanelKind, readonly string[]> = {
  skills: ['disable-model-invocation', 'user-invocable'],
  commands: [],
  agents: ['model', 'provider', 'reasoning_effort', 'reasoningEffort']
}

/**
 * How long one set of scanned rows may be reused.
 *
 * The memo exists to collapse the reads one interaction produces — the re-read
 * after a mutation, the detail open, the next panel's read — and to absorb one
 * tick of the client's 1.5 s translation poll. It must not outlive that: the
 * scan reads file contents, so an out-of-band edit stays invisible to a reused
 * row for as long as the bound allows. Ageing the rows on the snapshot object
 * alone would inherit the user snapshot's 30 s TTL — the keep-warm refresh
 * replaces that object only every 0.8 of it — leaving a hand edit invisible for
 * tens of seconds. Two seconds is one poll interval plus the slack a slow read
 * needs, so a poll landing a tick after the read that armed it is still free,
 * while a hand edit is visible by the next poll at the latest — and Refresh
 * re-reads unconditionally.
 */
export const ROW_CACHE_MAX_AGE_MS = 2_000

/** Everything one plugin document contributes to its row, read out of its text once. */
function documentFields(rawText: string, skills: boolean): { rawText: string; metadata: Record<string, unknown>; description: string; disabled: boolean } {
  let metadata: Record<string, unknown>
  try {
    metadata = parseFrontmatterRecord(rawText)
  } catch (error) {
    metadata = { disabled: true, validationError: String(error) }
  }
  const skill = skills ? parseSkillFrontmatter(rawText, undefined) : undefined
  const invocationOff = typeof skill === 'object' && !skill.invocation.modelInvocable && !skill.invocation.userInvocable
  return {
    rawText,
    metadata,
    description: typeof metadata.description === 'string' ? metadata.description : '',
    disabled: metadata.disabled === true || invocationOff
  }
}

/**
 * Build the three panel stores over one catalog.
 *
 * Translation reaches the panels as a callback rather than a direct
 * collaborator: the catalog owns the localizer, and a panel only needs the
 * resolved field set for one entry. Each panel binds its own kind, which is
 * also the translation surface its entries belong to.
 */
export function createPanelResources(catalog: Catalog, users: Record<UserPanelKind, UserPanelEntries>, projectCwd?: string): Record<UserPanelKind, PanelResourceStore> {
  const localizeFields: LocalizeFields = (surface, id, fields, locale) => catalog.translateFields(surface, id, fields, locale)
  const localizeDocument: LocalizeDocument = (surface, id, text, locale) => catalog.translateDocument(surface, id, text, locale)
  return {
    skills: new PanelResources(catalog, users.skills, 'skills', localizeFields, localizeDocument, projectCwd),
    commands: new PanelResources(catalog, users.commands, 'commands', localizeFields, localizeDocument, projectCwd),
    agents: new PanelResources(catalog, users.agents, 'agents', localizeFields, localizeDocument, projectCwd)
  }
}

class PanelResources implements PanelResourceStore {
  /**
   * The last filesystem-derived rows, and the inputs they were derived from.
   *
   * The client re-reads a panel while its translations land, and a read that
   * walks every suite document and stats every row on each of those ticks is
   * what this cache exists to prevent. The rows change whenever a document
   * changes on disk — the scan reads file contents, so a hand edit moves a
   * description, an enable state, or a modification stamp — and no in-process
   * signal reports that. The rows are therefore reused only
   * while three inputs hold: the catalog snapshot object (a new one means the
   * catalog re-discovered, so suite ownership and file lists may have moved),
   * this store's mutation counter, and {@link ROW_CACHE_MAX_AGE_MS}, which
   * bounds how old a served row may be. Translation fields are resolved per
   * read, because those do change under a static snapshot.
   */
  private cached: { snapshot: CatalogSnapshot; mutations: number; complete: boolean; at: number; rows: PanelRow[] } | undefined
  /** Bumped around every mutation this store performs, so its own edits never read back stale. */
  private mutations = 0

  constructor(
    private catalog: Catalog,
    private users: UserPanelEntries,
    private kind: UserPanelKind,
    private localizeFields: LocalizeFields,
    /** Same seam as {@link localizeFields}, for the document body rather than its fields. */
    private localizeDocument: LocalizeDocument,
    private readonly projectCwd?: string
  ) {}

  async read(strict = false, force = false): Promise<PanelRead> {
    let translationPending = 0
    // One preference read for the whole panel, handed to every row below. The
    // host answers the preference by projecting every profile entry's live
    // configuration, so asking per row turned a large panel into that many
    // projections on the read path.
    const locale = this.catalog.localePreference
    const entries = (await this.rows(strict, force)).map(row => {
      const presented = this.present(row, locale)
      translationPending += presented.pending
      // The list carries no document text: the client fetches the entry it
      // opens, and shipping every document made the response several times
      // larger than the rows it described. The raw user store supplies both
      // spellings of one document — the file as authored and its stripped
      // body — so both have to go; the entry read keeps them.
      const wire: UserPanelEntryWire = { ...presented.entry }
      delete wire.rawText
      delete wire.content
      return wire
    })
    return { entries, translationPending }
  }

  async list(strict = false): Promise<UserPanelEntryWire[]> {
    return (await this.read(strict)).entries
  }

  async get(id: string): Promise<UserPanelEntryWire | undefined> {
    const row = await this.detail(id)
    if (row === undefined) return undefined
    const shown = this.present(row, this.catalog.localePreference)
    return { ...shown.entry, ...(shown.pending > 0 ? { translationPending: shown.pending } : {}) }
  }

  async translateDocument(id: string): Promise<DocumentTranslation> {
    const row = await this.detail(id)
    if (row === undefined) throw new Error(`no entry named "${id}"`)
    // The body only: frontmatter is metadata the overview block already shows,
    // and a provider asked to translate YAML answers with YAML that no longer
    // parses. One preference read for the whole document, like every other
    // localized read here.
    return this.localizeDocument(this.kind, row.translationId, stripFrontmatter(row.entry.rawText), this.catalog.localePreference)
  }

  create(name: string, text: string): Promise<UserPanelEntryWire> {
    return this.mutating(() => this.users.create(name, text))
  }

  /**
   * A plugin resource is writable only when it sits inside the user dimension
   * root; suite checkouts elsewhere on disk stay read-only. The user-panel
   * store lives in the shared Agent layout root instead, so containment is
   * measured against the catalog's root, not the panel directory.
   */
  private async pluginPath(entry: UserPanelEntryWire): Promise<string> {
    if (entry.origin !== 'plugin') throw new Error('Unknown installed plugin resource')
    if (entry.path.endsWith('.json')) throw new Error('Inline manifest resources are read-only; edit their source manifest')
    const root = await realpath(this.catalog.userRoot)
    const path = await realpath(entry.path)
    if (!isWithin(root, path)) throw new Error('External source files are read-only; create a user resource to customize them')
    return path
  }

  async update(id: string, text: string): Promise<void> {
    if (!isPluginResourceId(id)) {
      await this.mutating(() => this.users.update(id, text))
      return
    }
    const previous = await this.detail(id)
    if (previous === undefined) throw new Error('Unknown installed plugin resource')
    await this.mutating(async () => {
      this.assertStateFlipOnly(previous.entry.rawText, text)
      await writeFileAtomic(await this.pluginPath(previous.entry), text, { mode: 0o644 })
    })
  }

  /**
   * A suite owns its files' content: the panel may only flip state frontmatter.
   * The document body must stay byte-identical, and the frontmatter diff is
   * confined to `disabled` everywhere, plus {@link FLIPPABLE_KEYS}'s per-kind
   * control keys — the harness invocation pair on skills, model routing on
   * agents.
   */
  private assertStateFlipOnly(previousText: string, text: string): void {
    if (stripFrontmatter(previousText) !== stripFrontmatter(text)) throw new Error('plugin resources are read-only; the suite owns their content')
    const before = parseFrontmatterRecord(previousText)
    const after = parseFrontmatterRecord(text)
    const flippable = new Set(['disabled', ...FLIPPABLE_KEYS[this.kind]])
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (flippable.has(key)) continue
      if (!deepEqual(before[key], after[key])) {
        throw new Error('plugin resources are read-only; only the enable state can be changed')
      }
    }
  }

  async remove(id: string): Promise<void> {
    // Plugin files belong to their suite checkout; install/uninstall manages them.
    if (isPluginResourceId(id)) throw new Error('plugin resources are managed by their suite; uninstall the suite instead')
    return this.mutating(() => this.users.remove(id))
  }

  /**
   * Run one mutation with the row cache invalidated on both sides of it.
   *
   * The entry bump drops rows derived before the write; the exit bump drops
   * rows that a read racing the write could have derived from the old file, so
   * no read after a mutation can answer with pre-mutation text.
   */
  private async mutating<T>(work: () => Promise<T>): Promise<T> {
    this.mutations += 1
    try {
      return await work()
    } finally {
      this.mutations += 1
    }
  }

  /**
   * The filesystem-derived rows for the current snapshot.
   *
   * Rows are reused while every input holds: the catalog snapshot object, this
   * store's mutation counter, and {@link ROW_CACHE_MAX_AGE_MS} of age. A read
   * that races a mutation never publishes its rows, so the next read re-derives
   * them; a read that asks for a genuine re-read never reuses them at all.
   * @param strict - propagate I/O failures instead of skipping the entry.
   * @param force - skip the reuse test and scan, replacing whatever is cached.
   */
  private async rows(strict: boolean, force = false): Promise<PanelRow[]> {
    const snapshot = this.projectCwd === undefined ? await this.catalog.readUserCatalog() : await this.catalog.readProjectCatalog(this.projectCwd)
    const cached = this.cached
    const fresh = cached !== undefined && this.catalog.now() - cached.at <= ROW_CACHE_MAX_AGE_MS
    const reusable = !force && fresh && cached !== undefined && cached.snapshot === snapshot && cached.mutations === this.mutations && (cached.complete || !strict)
    if (reusable) return cached.rows
    const mutations = this.mutations
    const rows = await this.scan(strict, snapshot)
    if (this.mutations === mutations) {
      // A strict scan saw every entry a later relaxed one would: it stays usable.
      const complete = strict || (cached !== undefined && cached.snapshot === snapshot && cached.mutations === mutations && cached.complete)
      this.cached = { snapshot, mutations, complete, at: this.catalog.now(), rows }
    }
    return rows
  }

  /** One row from the (age-bounded) scan, by the id the panel addresses it with. */
  private async find(id: string, force = false): Promise<PanelRow | undefined> {
    return (await this.rows(false, force)).find(candidate => (candidate.entry.id ?? candidate.entry.name) === id)
  }

  /**
   * One row whose document-derived fields all come from one read of its file.
   *
   * A caller that opens a document may also rewrite it, so it must not diff or
   * seed from a cached projection: mixing a freshly read document with fields
   * derived from an older one hands back a row that never existed on disk — new
   * text beside the old description, enable state, and modification stamp. The
   * identity and the suite-level state still come from the age-bounded scan;
   * everything read out of the document is re-derived here.
   *
   * An unreadable document fails the read instead of falling back to the cached
   * text. {@link PanelResources.update} diffs against what this returns and then
   * replaces the file through a temp file plus rename, which a directory the
   * process can write but not read accepts happily: answering from the cache
   * would replace a document nobody read with the panel's stale idea of it. A
   * file that is gone is a gone entry, the same way the scan treats it.
   */
  private async detail(id: string): Promise<PanelRow | undefined> {
    const row = await this.find(id)
    if (row === undefined) return undefined
    if (row.entry.origin === 'user') {
      // The user store owns its entries' derivation — the declared name, the
      // validation verdict, the frontmatter-stripped body — so its own fresh
      // list is the answer rather than a re-parse here.
      const fresh = (await this.users.list(false)).find(candidate => (candidate.id ?? candidate.name) === id)
      return fresh === undefined ? undefined : this.stamp({ ...row, entry: fresh })
    }
    const rawText = await readFile(row.entry.path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (rawText === undefined) return undefined
    const fields = documentFields(rawText, this.kind === 'skills')
    // The suite half comes from the row, the document half from the read just
    // made: the entry's off state is the disjunction of the two.
    return this.stamp({ ...row, entry: { ...row.entry, ...fields, disabled: (row.suiteDisabled ?? false) || fields.disabled } })
  }

  /** Stamp one row's own last modification; the caller has just read its file. */
  private async stamp(row: PanelRow): Promise<PanelRow> {
    try {
      const stats = await stat(row.entry.path)
      return { ...row, entry: { ...row.entry, updatedAt: new Date(stats.mtimeMs).toISOString() } }
    } catch {
      return row
    }
  }

  /** Resolve one row's translation fields against the live cache. */
  private present(row: PanelRow, locale: string): { entry: PanelEntryRecord; pending: number } {
    const localized = this.localizeFields(this.kind, row.translationId, { name: row.entry.name, description: row.entry.description }, locale)
    return { entry: { ...row.entry, ...localized.fields }, pending: localized.pending }
  }

  /** Read every user and installed-suite document for one snapshot. */
  private async scan(strict: boolean, snapshot: CatalogSnapshot): Promise<PanelRow[]> {
    const rows: PanelRow[] = []
    if (this.projectCwd === undefined) for (const entry of await this.users.list(strict)) rows.push({ entry, translationId: entry.id ?? entry.name })
    for (const suite of snapshot.suites) {
      if ((this.projectCwd === undefined && !this.catalog.isInstalled(suite.sourceId, suite.id)) || suite.remote !== undefined) continue
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
        const fields = documentFields(rawText, this.kind === 'skills')
        const suiteOff = !suite.enabled || suite.activeSurfaces[this.kind] === false
        rows.push({
          // The entry is addressed by the identity the panel already uses for
          // it, so the same document always lands on the same cache entry.
          translationId: pluginResourceId(suite.sourceId, suite.id, this.kind, name),
          suiteDisabled: suiteOff,
          entry: {
            id: pluginResourceId(suite.sourceId, suite.id, this.kind, name),
            name,
            origin: 'plugin',
            suiteName: suite.manifest.name,
            ...fields,
            // Off when the document, the suite, or this surface says so.
            disabled: suiteOff || fields.disabled,
            path: file,
            ...(pluginRootOf(suite) === undefined ? {} : { suiteRoot: suite.root, suiteData: suiteDataDir(this.catalog.dataRoot, suite.sourceId, suite.id) })
          }
        })
      }
    }
    // One pass stamps each entry's own last modification: the scan reads every
    // file's text anyway, and both origins get the same treatment here.
    return await Promise.all(rows.map(row => this.stamp(row)))
  }
}
