/**
 * Browser-safe wire records for the output-styles page.
 *
 * An output style is a named block of authored instruction text that changes
 * how the model answers. Exactly one style is selected per workspace, and its
 * text is injected as one system-prompt section. The rendering lives here, in
 * a module both the server and the page import, so the preview a person reads
 * is byte for byte the text the session receives.
 *
 * A style is a Markdown file in every case it can come from: one a person wrote
 * in their own Agent layout, one a suite ships under `output-styles/`, or one the
 * workspace keeps in `.claude/output-styles/`. A suite that injects persona text
 * from a SessionStart hook is not a style here: that is a hook, and the hooks
 * surface owns it.
 * @module contracts/output-styles
 */
import { MARKET_API_PREFIX } from './market.js'

/** Fixed output-style HTTP routes. */
export const OUTPUT_STYLE_ROUTES = {
  /** Every style of every source, the selection, and the captured text. GET. */
  read: `${MARKET_API_PREFIX}output-styles`,
  /** Select one style for this workspace. POST. */
  select: `${MARKET_API_PREFIX}output-styles/select`,
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

/** Where a style comes from, in trust order: the person, a suite, the workspace. */
export type OutputStyleSource = 'user' | 'suite' | 'project'

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

/** One selectable style. */
export interface OutputStyleRow {
  /** Stable id: `user:<name>`, `suite:<sourceId>/<suiteId>:<style>`, or `project:<name>`. */
  id: string
  /** The name the page shows and the heading carries. */
  label: string
  /** One line saying what the style changes, in the language the author wrote it in. */
  description: string
  /** The authored text. */
  body: string
  source: OutputStyleSource
  /** Suite rows: the suite's source-qualified id, `sourceId/suiteId`. */
  suiteKey?: string
  /** Suite rows: the suite's display name, so a row can say which suite it came from. */
  suiteName?: string
  /** Suite and project rows: the file the text was read from. */
  file?: string
}

/** The page's whole read. */
export interface OutputStylesPayload {
  styles: OutputStyleRow[]
  /** The selected style's id. */
  selected: string
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
