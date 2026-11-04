/**
 * The live output-style selection for each open workspace.
 *
 * One style is selected per workspace and injected as a single system-prompt
 * section. The section provider is synchronous: the host assembles a prompt
 * without awaiting a disk read, so this service keeps the resolved selection in
 * memory, republishes it after every successful write, and refreshes it whenever
 * a read asks for the current truth.
 *
 * Every style is a Markdown file: one the person wrote in their Agent layout, one a
 * suite ships under `output-styles/`, or one the workspace keeps in
 * `.claude/output-styles/`. Nothing is captured and nothing runs: a suite that
 * injects persona text from a SessionStart hook is a hook, and the hooks surface owns
 * it.
 * @module runtime/host/output-style-service
 */
import { deleteUserStyle, readProjectStyles, readUserStyles, writeUserStyle, type SuiteStyleEntry } from '../../application/output-styles.js'
import { renderOutputStyleSection } from './output-style-render.js'
import { loadOutputStyle, saveOutputStyleSelection, type OutputStyleState } from '../../application/state/output-style.js'
import { OUTPUT_STYLE_NONE_ID, type OutputStyleRow, type OutputStylesPayload } from '../../../../market-contracts/src/contracts/output-styles.js'

/**
 * What this service needs from the catalog side.
 *
 * The runtime cannot list suites: that belongs to the composition root, which owns
 * the catalog. A profile that supplies no port still has the person's own styles and
 * the workspace's project styles, and simply offers no suite rows.
 */
export interface OutputStyleSuitePort {
  /** Every enabled suite that ships Markdown styles. */
  styleFiles(): Promise<SuiteStyleEntry[]>
}

/** One workspace's resolved selection, kept for the synchronous section provider. */
interface CachedSelection {
  state: OutputStyleState
  /** The exact section text, or an empty string when the selection injects nothing. */
  injected: string
}

export class OutputStyleService {
  private readonly cache = new Map<string, CachedSelection>()
  /** Mutations run one at a time so two selections cannot interleave. */
  private tail: Promise<void> = Promise.resolve()

  /**
   * @param dataRoot - the plugin data root the selection documents live under.
   * @param agentsRoot - the Agent layout root holding user-authored styles.
   * @param suites - the catalog side, or undefined in a profile without a catalog.
   */
  constructor(
    private readonly dataRoot: string,
    private readonly agentsRoot: string,
    private readonly suites?: OutputStyleSuitePort
  ) {}

  /** Run one mutation after every earlier one. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const running = this.tail.then(work)
    this.tail = running.then(
      () => undefined,
      () => undefined
    )
    return running
  }

  /**
   * Re-read one workspace's selection and every style it may point at.
   *
   * Called at mount, after every mutation, and by every read: a read is where the
   * page learns that a style file changed, so the same pass updates the text the
   * session already holds.
   * @param workspace - the workspace whose selection to resolve.
   */
  async refresh(workspace: string): Promise<void> {
    const state = await loadOutputStyle(this.dataRoot, workspace)
    this.cache.set(workspace, await this.resolve(workspace, state))
  }

  /** The section text one workspace contributes, synchronously, from cache. */
  sectionText(workspace: string): string {
    return this.cache.get(workspace)?.injected ?? ''
  }

  /**
   * The whole page read: every style, the selection, and the injected text.
   * @param workspace - the workspace whose selection is read.
   * @param includeProject - whether project styles are listed; a page with no live
   * session answers for no workspace, so it must not report one's files.
   */
  async payload(workspace: string, includeProject = true): Promise<OutputStylesPayload> {
    await this.refresh(workspace)
    const cached = this.cache.get(workspace)
    return {
      styles: await this.rows(workspace, includeProject),
      selected: cached?.state.styleId ?? OUTPUT_STYLE_NONE_ID,
      workspace,
      injected: cached?.injected ?? ''
    }
  }

  /**
   * Every selectable style, in trust order, from all three sources.
   * @param workspace - the workspace whose project styles are read too.
   * @param includeProject - false for a page that answers for no workspace.
   */
  async rows(workspace: string, includeProject = true): Promise<OutputStyleRow[]> {
    const users = await readUserStyles(this.agentsRoot)
    const suites = await this.suiteRows()
    if (!includeProject) return [...users, ...suites]
    const project = await readProjectStyles(workspace).catch(() => [])
    return [...users, ...suites, ...project]
  }

  /** One row per suite style file. */
  private async suiteRows(): Promise<OutputStyleRow[]> {
    if (this.suites === undefined) return []
    let entries: SuiteStyleEntry[]
    try {
      entries = await this.suites.styleFiles()
    } catch {
      // A catalog that cannot answer costs the suite rows, never the page.
      return []
    }
    return entries.map(entry => ({
      id: `suite:${entry.suiteKey}:${entry.name}`,
      label: entry.name,
      description: entry.description,
      body: entry.body,
      source: 'suite' as const,
      suiteKey: entry.suiteKey,
      suiteName: entry.suiteName,
      file: entry.file
    }))
  }

  /**
   * Select one style for a workspace.
   *
   * An unknown id is refused rather than stored: a selection nobody can render
   * would silently turn the previous style off, and the page would report a
   * choice the prompt does not contain.
   * @param workspace - the workspace whose selection changes.
   * @param styleId - the requested style id.
   * @returns the committed page read.
   */
  async select(workspace: string, styleId: string, includeProject = true): Promise<OutputStylesPayload> {
    await this.enqueue(async () => {
      if (styleId !== OUTPUT_STYLE_NONE_ID) {
        const styles = await this.rows(workspace, includeProject)
        if (!styles.some(row => row.id === styleId)) throw new Error(`unknown output style "${styleId}"`)
      }
      await saveOutputStyleSelection(this.dataRoot, workspace, styleId)
    })
    return this.payload(workspace, includeProject)
  }

  /** Create or replace one user-authored style. */
  async saveUserStyle(name: string, description: string, body: string): Promise<void> {
    await writeUserStyle(this.agentsRoot, name, description, body)
  }

  /** Remove one user-authored style, restoring the default when it was selected. */
  async removeUserStyle(workspace: string, name: string): Promise<void> {
    await deleteUserStyle(this.agentsRoot, name)
    const state = await loadOutputStyle(this.dataRoot, workspace)
    if (state.styleId === `user:${name}`) await saveOutputStyleSelection(this.dataRoot, workspace, OUTPUT_STYLE_NONE_ID)
    await this.refresh(workspace)
  }

  /**
   * Resolve one selection against the styles that exist right now.
   *
   * An id nobody can render falls back to the default selection, which is how a
   * deleted user style, an uninstalled suite, or a removed project file stops
   * injecting anything.
   */
  private async resolve(workspace: string, state: OutputStyleState): Promise<CachedSelection> {
    const selected = state.styleId
    if (selected === OUTPUT_STYLE_NONE_ID) return { state, injected: '' }
    const styles = await this.rows(workspace)
    const row = styles.find(entry => entry.id === selected)
    if (row === undefined) return { state: { styleId: OUTPUT_STYLE_NONE_ID }, injected: '' }
    return { state, injected: renderOutputStyleSection(row.label, row.body) }
  }
}
