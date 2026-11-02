/**
 * Browser-safe wire records for the output-styles page.
 *
 * An output style is a named block of authored instruction text that changes
 * how the model answers. Exactly one style is selected per workspace, and its
 * text is injected as one system-prompt section. The rendering lives here, in
 * a module both the server and the page import, so the preview a person reads
 * is byte for byte the text the session receives.
 * @module contracts/output-styles
 */
import { MARKET_API_PREFIX } from './market.js'

/** Fixed output-style HTTP routes. */
export const OUTPUT_STYLE_ROUTES = {
  /** Every style of every source, the selection, and the captured text. GET. */
  read: `${MARKET_API_PREFIX}output-styles`,
  /** Select one style for this workspace. POST. */
  select: `${MARKET_API_PREFIX}output-styles/select`,
  /** Capture one suite style's text through its own SessionStart hook. POST. */
  capture: `${MARKET_API_PREFIX}output-styles/capture`,
  /**
   * Create or replace one user-authored style. POST.
   *
   * The body carries the style's own fields and never a path: the server joins
   * them onto the Agent layout root after validating the name as a file stem.
   */
  saveUser: `${MARKET_API_PREFIX}output-styles/user/save`,
  /** Remove one user-authored style. POST. */
  deleteUser: `${MARKET_API_PREFIX}output-styles/user/delete`
} as const

/** Where a style comes from, in order of trust. */
export type OutputStyleSource = 'user' | 'suite'

/**
 * The selection that injects nothing.
 *
 * The plugin ships no styles of its own, so this is where a workspace starts: no
 * style is chosen until someone picks one, and the prompt carries no
 * output-style section until then.
 */
export const OUTPUT_STYLE_NONE_ID = ''

/** The system-prompt section name the selection registers. */
export const OUTPUT_STYLE_SECTION_NAME = 'market:output-style'

/**
 * The heading line the section opens with.
 *
 * The host joins prompt sections with a blank line and adds no heading of its
 * own, so the producer supplies one. The wording matches Claude Code's
 * `Output Style: <label>`, measured in
 * `docs/scratch/prompt-research/captures/text/style.messages.txt`. The level stays
 * `##`, the level the host's own multi-paragraph sections use: this plugin
 * contributes to a host-assembled prompt rather than authoring it, so a `#`
 * would outrank every host section beside it. See
 * `docs/scratch/prompt-research/corrections.md` section 7. Exactly one style is
 * selected per workspace, so no deeper level is needed.
 */
export const OUTPUT_STYLE_HEADING_PREFIX = '## Output Style: '

/**
 * Where the section sorts among the host's own prompt sections.
 *
 * The host allocates 0 to the deployment persona prefix, 500 to plan policy and
 * 600 to team policy. A style says how every answer is phrased, so it belongs
 * with those behavioural instructions and ahead of the tool descriptions that
 * start at 1000. 490 is ten below the nearest named slot, so the section never
 * ties with one: an equal order falls back to code-unit name order, which would
 * make the style's position depend on its name.
 */
export const OUTPUT_STYLE_SECTION_ORDER = 490

/** How one suite style's capture relates to the suite on disk now. */
export type OutputStyleCaptureState = 'missing' | 'current' | 'stale'

/** One selectable style. */
export interface OutputStyleRow {
  /** Stable id: `builtin:<name>`, `user:<name>`, or `suite:<sourceId>/<suiteId>`. */
  id: string
  /** The name the page shows and the heading carries. */
  label: string
  /** One line saying what the style changes, in the language the author wrote it in. */
  description: string
  /** The authored text; for a suite style, the captured text. */
  body: string
  source: OutputStyleSource
  /** Suite rows: the suite's source-qualified id. */
  suiteKey?: string
  /** Suite rows: the note to show instead of a description, translated by the client. */
  hint?: OutputStyleHintCode
  /** Suite rows: the fingerprint the current declaration produces. */
  fingerprint?: string
  /** Suite rows: whether a capture exists, and whether it still matches the suite. */
  capture?: OutputStyleCaptureState
}

/**
 * A note the client translates, instead of copy the server writes.
 *
 * A suite row cannot carry a sentence: the server that builds it does not know the
 * reader's language. A `hint` code is a typed union, so a hardcoded English sentence
 * cannot compile as one, and the panel maps it to a bilingual dictionary entry.
 */
export type OutputStyleHintCode = 'suiteSessionStartCapture'

/** One captured suite text, bound to the suite state it was captured from. */
export interface OutputStyleCaptured {
  suiteKey: string
  /** The suite declaration fingerprint at capture time. */
  fingerprint: string
  text: string
}

/** The page's whole read. */
export interface OutputStylesPayload {
  styles: OutputStyleRow[]
  /** The selected style's id. */
  selected: string
  /** The captured suite text the selection relies on, when it is a suite style. */
  captured?: OutputStyleCaptured
  /** The workspace this selection belongs to. */
  workspace: string
  /** The exact section text the session prompt receives, or an empty string. */
  injected: string
}

/** A request to select one style. */
export interface OutputStyleSelectRequest {
  styleId: string
}

/** A request to capture one suite style. */
export interface OutputStyleCaptureRequest {
  suiteKey: string
}

/** A request to create or replace one user-authored style. */
export interface OutputStyleSaveRequest {
  /** The file stem the style is stored under. */
  name: string
  /** The one-line summary the list shows. */
  description: string
  /** The style text itself. */
  body: string
}

/** What a capture answers: the text, and the fingerprint it is bound to. */
export interface OutputStyleCaptureResult {
  suiteKey: string
  fingerprint: string
  text: string
}
