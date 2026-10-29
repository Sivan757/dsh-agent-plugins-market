/**
 * The live output-style selection for each open workspace.
 *
 * One style is selected per workspace and injected as a single system-prompt
 * section. The section provider is synchronous: the host assembles a prompt
 * without awaiting a disk read, so this service keeps the resolved selection in
 * memory, republishes it after every successful write, and refreshes it whenever
 * a read asks for the current truth.
 *
 * The three sources are merged here without reinterpreting any of them. A suite
 * style carries only text a person captured explicitly, bound to the fingerprint
 * of the declaration it came from, so a suite that changes shows as stale rather
 * than replaying text nobody re-approved.
 * @module runtime/host/output-style-service
 */
import { deleteUserStyle, parseCapturedStyle, readUserStyles, suiteStyleFingerprint, writeUserStyle, type SuiteStyleCandidate } from '../../application/output-styles.js'
import { renderOutputStyleSection } from './output-style-render.js'
import { loadOutputStyle, saveOutputStyleCapture, saveOutputStyleSelection, defaultOutputStyleState, type OutputStyleState } from '../../application/state/output-style.js'
import {
  OUTPUT_STYLE_NONE_ID,
  type OutputStyleCaptureResult,
  type OutputStyleCaptured,
  type OutputStyleRow,
  type OutputStylesPayload
} from '../../../../market-contracts/src/contracts/output-styles.js'

/**
 * What this service needs from the catalog side.
 *
 * The runtime cannot list suites or run a hook: both belong to the composition
 * root, which owns the catalog and the shell seam. A profile that supplies no
 * port still has builtin and user styles, and simply offers no suite rows.
 */
export interface OutputStyleSuitePort {
  /** Every enabled suite that declares a SessionStart hook, with its fingerprint. */
  candidates(): Promise<SuiteStyleCandidate[]>
  /**
   * Run one suite's SessionStart hook once, bounded, and return its text.
   * @param suiteKey - the suite address, `sourceId/suiteId`.
   * @param fingerprint - the fingerprint the caller saw, so a suite that changed
   * between the read and the capture is refused instead of stored under a stale key.
   */
  capture(suiteKey: string, fingerprint: string): Promise<string>
}

/** One workspace's resolved selection, kept for the synchronous section provider. */
interface CachedSelection {
  state: OutputStyleState
  /** The exact section text, or an empty string when the selection injects nothing. */
  injected: string
  /** How the selection's capture relates to the suite on disk now. */
  capture: 'current' | 'stale' | 'missing'
}

/** The service's own view of one workspace. */
type WorkspaceState = CachedSelection

export class OutputStyleService {
  private readonly cache = new Map<string, WorkspaceState>()
  /** Mutations run one at a time so a select and a capture cannot interleave. */
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
   * Called at mount, after every mutation, and by every read: a read is where
   * the page learns that a suite changed, so the same pass updates the text the
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

  /** The whole page read: every style, the selection, the capture, and the injected text. */
  async payload(workspace: string): Promise<OutputStylesPayload> {
    await this.refresh(workspace)
    const cached = this.cache.get(workspace) ?? (await this.resolve(workspace, defaultOutputStyleState()))
    const styles = await this.rows(workspace)
    return {
      styles,
      selected: cached.state.styleId,
      ...(cached.state.captured === undefined ? {} : { captured: cached.state.captured }),
      workspace,
      injected: cached.injected
    }
  }

  /**
   * Select one style for a workspace.
   *
   * An unknown id is refused rather than stored: a selection nobody can render
   * would silently turn the previous style off, and the page would report a
   * choice the prompt does not contain. A suite style needs a capture that still
   * matches its declaration, because the text is the style.
   * @param workspace - the workspace whose selection changes.
   * @param styleId - the requested style id.
   * @returns the committed page read.
   */
  async select(workspace: string, styleId: string): Promise<OutputStylesPayload> {
    await this.enqueue(async () => {
      const styles = await this.rows(workspace)
      const target = styles.find(row => row.id === styleId)
      if (target === undefined) throw new Error(`unknown output style "${styleId}"`)
      if (target.source === 'suite' && target.capture !== 'current') throw new Error(`output style "${target.label}" has no current capture; capture it first`)
      await saveOutputStyleSelection(this.dataRoot, workspace, styleId)
    })
    return this.payload(workspace)
  }

  /**
   * Capture one suite style's text through its own SessionStart hook.
   *
   * The page calls this only when a person asks for it. That is the whole reason
   * the flow is explicit: the text is a suite's process output, capture runs a
   * program once, and what enters the prompt afterwards is stored text a person
   * read beforehand.
   * @param workspace - the workspace whose capture record is updated.
   * @param suiteKey - the suite address, `sourceId/suiteId`.
   * @returns the captured text and the fingerprint it is bound to.
   */
  async capture(workspace: string, suiteKey: string): Promise<OutputStyleCaptureResult> {
    const candidate = await this.candidate(suiteKey)
    const text = normalizeCaptured(parseCapturedStyle(await this.requireSuites().capture(suiteKey, candidate.fingerprint)))
    await this.enqueue(async () => {
      await saveOutputStyleCapture(this.dataRoot, workspace, { suiteKey, fingerprint: candidate.fingerprint, text })
    })
    await this.refresh(workspace)
    return { suiteKey, fingerprint: candidate.fingerprint, text }
  }

  /** Create or replace one user-authored style. */
  async saveUserStyle(name: string, description: string, body: string): Promise<void> {
    await writeUserStyle(this.agentsRoot, name, description, body)
  }

  /** Remove one user-authored style, restoring the default when it was selected. */
  async removeUserStyle(workspace: string, name: string): Promise<void> {
    await deleteUserStyle(this.agentsRoot, name)
    await this.enqueue(async () => {
      const state = await loadOutputStyle(this.dataRoot, workspace)
      if (state.styleId === `user:${name}`) await saveOutputStyleSelection(this.dataRoot, workspace, OUTPUT_STYLE_NONE_ID)
    })
    await this.refresh(workspace)
  }

  /**
   * Every selectable style, in trust order, from all three sources.
   *
   * A suite row's capture state is read against the given workspace, because
   * that is what decides whether the row can be selected: the text `capture`
   * is what the style is.
   * @param workspace - the workspace whose captured record the suite rows compare to.
   */
  async rows(workspace: string): Promise<OutputStyleRow[]> {
    const users = await readUserStyles(this.agentsRoot)
    const captured = this.cache.get(workspace)?.state.captured
    const suites = await this.suiteRows(captured)
    // Styles come from plugins and from the person: the plugin ships none of its own.
    return [...users, ...suites]
  }

  /** One suite's own row list, with its capture state. */
  private async suiteRows(captured: OutputStyleCaptured | undefined): Promise<OutputStyleRow[]> {
    const candidates = await this.candidates()
    return candidates.map(candidate => ({
      id: `suite:${candidate.suiteKey}`,
      label: candidate.label,
      description: candidate.description,
      // The body of a suite style is its captured text; a row without a current
      // capture renders empty and offers the capture action.
      body: captured?.suiteKey === candidate.suiteKey && captured.fingerprint === candidate.fingerprint ? captured.text : '',
      source: 'suite' as const,
      suiteKey: candidate.suiteKey,
      fingerprint: candidate.fingerprint,
      capture: captureState(captured, candidate)
    }))
  }

  private async candidates(): Promise<SuiteStyleCandidate[]> {
    if (this.suites === undefined) return []
    try {
      return await this.suites.candidates()
    } catch {
      // A catalog that cannot answer costs the suite rows, never the page: the
      // builtin and user sources still list.
      return []
    }
  }

  private requireSuites(): OutputStyleSuitePort {
    if (this.suites === undefined) throw new Error('no catalog is available, so suite output styles cannot be captured')
    return this.suites
  }

  /** One candidate by address, or a stable refusal. */
  private async candidate(suiteKey: string): Promise<SuiteStyleCandidate> {
    const found = (await this.candidates()).find(candidate => candidate.suiteKey === suiteKey)
    if (found === undefined) throw new Error(`no enabled suite "${suiteKey}" declares a SessionStart hook to capture`)
    return found
  }

  /**
   * Resolve one selection against the styles that exist right now.
   *
   * An id nobody can render falls back to the default selection, which is how a
   * deleted user style or an uninstalled suite stops injecting anything. The
   * suite case additionally requires the capture's fingerprint to match the
   * declaration in force, so a changed suite contributes nothing until someone
   * captures it again.
   */
  private async resolve(workspace: string, state: OutputStyleState): Promise<WorkspaceState> {
    const candidates = await this.candidates()
    const users = await readUserStyles(this.agentsRoot)
    const selected = state.styleId
    const user = users.find(row => row.id === selected)
    if (user !== undefined) {
      return { state, injected: renderOutputStyleSection(user.label, user.body), capture: 'current' }
    }
    const suiteKey = selected.startsWith('suite:') ? selected.slice('suite:'.length) : undefined
    const candidate = suiteKey === undefined ? undefined : candidates.find(entry => entry.suiteKey === suiteKey)
    if (candidate !== undefined) {
      const captured = state.captured
      if (captured === undefined || captured.suiteKey !== candidate.suiteKey) {
        return { state, injected: '', capture: 'missing' }
      }
      if (captured.fingerprint !== candidate.fingerprint) {
        return { state, injected: '', capture: 'stale' }
      }
      return { state, injected: renderOutputStyleSection(candidate.label, captured.text), capture: 'current' }
    }
    // Nothing renders this id: fall back to the style that injects nothing, and
    // report that selection so the page shows what the prompt actually carries.
    // Nothing renders this id: the prompt carries no output-style section, and the
    // selection records that rather than pointing at a style that is not there. A capture
    // already on record stays with the workspace, because selecting the suite that owns it
    // is what makes it current.
    return {
      state: state.captured === undefined ? { styleId: OUTPUT_STYLE_NONE_ID } : { styleId: OUTPUT_STYLE_NONE_ID, captured: state.captured },
      injected: '',
      capture: 'current'
    }
  }
}

/**
 * How one suite's stored capture relates to the declaration in force.
 *
 * A capture for another suite is not this row's capture at all, so it reads as
 * missing rather than stale: there is nothing here to re-approve.
 * @param captured - the workspace's stored capture.
 * @param candidate - the suite as it stands now.
 * @returns the state the row reports.
 */
function captureState(captured: OutputStyleCaptured | undefined, candidate: SuiteStyleCandidate): 'current' | 'stale' | 'missing' {
  if (captured === undefined || captured.suiteKey !== candidate.suiteKey) return 'missing'
  return captured.fingerprint === candidate.fingerprint ? 'current' : 'stale'
}

/**
 * Put the captured text in the form the stored record keeps.
 *
 * The stored text is what the page previewed and what the prompt receives, so
 * the only normalization is the document's own trailing newline: a capture that
 * ends with one would otherwise render an extra blank line before the next
 * prompt section.
 */
function normalizeCaptured(text: string): string {
  return text.replace(/\s+$/, '')
}

/** Re-export so the composition root can build a fingerprint without importing the application module twice. */
export { suiteStyleFingerprint }
export type { SuiteStyleCandidate }
