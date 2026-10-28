/**
 * Render one output style as the exact system-prompt section text.
 *
 * Rule R7 of `docs/reference/prompt-injection-conventions.md` says a system
 * prompt section is already system weight, so it takes a Markdown heading and
 * never a `<system-reminder>` frame. `renderPrompt` joins sections with a blank
 * line and adds no heading of its own, so the heading is part of this text:
 * without it a reader of the assembled prompt cannot tell where the style
 * starts.
 *
 * The wording matches Claude Code's own `Output Style: <label>`, measured in
 * `docs/scratch/prompt-research/captures/text/style.messages.txt`. The level stays
 * `##`, which is what the host's own multi-paragraph sections use; this plugin
 * contributes sections to a host-assembled prompt rather than authoring it.
 * `attribute()` exists to keep several contributors separable (rule R5), and
 * exactly one style is selected per workspace, so no deeper level would
 * separate anything.
 *
 * The body goes through `escapeFrameBody` even though this section carries no
 * frame. A style is authored text that may be reused inside one later, the
 * escape is idempotent, and it renders identically to a reader.
 *
 * This module lives in the runtime, not the application layer: the escape rule
 * is owned by `prompt-frame.ts`, and the application layer may not reach host
 * effects. The page never calls it either; it renders the server's answer.
 * @module runtime/host/output-style-render
 */
import { OUTPUT_STYLE_HEADING_PREFIX } from '../../../../market-contracts/src/contracts/output-styles.js'
import { escapeFrameBody } from '../surfaces/prompt-frame.js'

/**
 * Render one style as the section text the prompt receives.
 * @param label - the style's display name.
 * @param body - the style's authored or captured text.
 * @returns the section text, or an empty string when the body carries nothing.
 */
export function renderOutputStyleSection(label: string, body: string): string {
  const trimmed = body.trim()
  if (trimmed === '') return ''
  return OUTPUT_STYLE_HEADING_PREFIX + label.trim() + '\n' + escapeFrameBody(trimmed)
}
