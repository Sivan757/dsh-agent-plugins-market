/**
 * Producer-owned framing for every block this plugin puts into a model request.
 *
 * The session surface passes injected content through verbatim, so the producer
 * owns all framing (the harness unwrap decision, archived 2026-07-20). Two forms
 * exist and only two: the `<system-reminder>` frame the harness's own
 * workspace-instruction and skill-catalog producers emit, and plain prose.
 *
 * Use the frame only for durable, session-stable instruction content. A steering
 * reason, a corrective feedback line, or a one-shot callback stays plain: the
 * same decision records a transcript where a model treated labeled steering as
 * third-party metadata and refused it.
 *
 * No other tag is ever invented here. A tag no model was trained on adds tokens
 * without a reliable effect.
 *
 * Hook text carries its provenance inside the frame, in the line Claude Code
 * measured: `<hook-event>[:<matcher>] hook <status>: <output>`. The model reads
 * that line to tell a hook apart from user text, so the event, the matcher and
 * the status are part of the frame rather than decoration around it.
 *
 * Separate reminders are separate content blocks, never one string with a
 * divider. The measured user message is an array of text blocks, one per
 * reminder, with the person's own text last; the block array is the separator,
 * and no line of hyphens exists on the wire.
 *
 * @module runtime/surfaces/prompt-frame
 */
import { escapeText } from '@deepseek-ai/dsh-skill'

/** The opening frame the harness's workspace-instruction producer emits. */
export const SYSTEM_REMINDER_OPEN = '<system-reminder>'
/** The closing frame marker. A body must never be able to emit it. */
export const SYSTEM_REMINDER_CLOSE = '</system-reminder>'

/** The status word a hook line carries, from the three Claude Code sends. */
export type HookStatus = 'success' | 'error' | 'additional context'

/** One attributed contributor inside a framed block. */
export interface FrameSection {
  /** The contributor, named the way a reader identifies it: a suite name or a path. */
  heading: string
  /** The contributor's own text, unmodified. */
  body: string
  /** What the contributor is, as its label states it: a source type. */
  kind?: string
}

/**
 * Neutralize a closing frame marker inside a body.
 *
 * A body that carries `</system-reminder>` would end the frame early and let
 * suite text land outside it. The escaped form renders the same to a reader and
 * cannot close the frame. An already-escaped marker is left alone: it does not
 * close the frame either, so escaping it again would only gain a backslash.
 * @param body - the contributor's text.
 * @returns the text with every closing marker escaped.
 */
export function escapeFrameBody(body: string): string {
  return body.replaceAll(SYSTEM_REMINDER_CLOSE, '<\\/system-reminder>')
}

/**
 * Wrap a complete body in the frame.
 *
 * Escaping happens here, after the caller assembly and before any byte
 * accounting the caller does on the result.
 * @param body - the fully assembled body.
 * @returns the framed text.
 */
export function frame(body: string): string {
  return [SYSTEM_REMINDER_OPEN, escapeFrameBody(body), SYSTEM_REMINDER_CLOSE].join('\n')
}

/**
 * Render one labelled block per contributor.
 *
 * Both measured producers name the source, then a blank line, then the body:
 * the host workspace-instruction loader writes `Instructions from: <path>`
 * (`packages/context/agent-instructions/src/render.ts:91-93`) and Claude Code
 * writes `Contents of <path> (<type>):`. A suite is a named source rather than a
 * file, so its label is `Instructions from: <suite> (<kind>):`, which states both
 * what the text is and where it came from.
 *
 * A label never spans lines: a contributor name is a single line, so any line
 * break or control character inside it becomes a space. A contributor whose body
 * is blank contributes nothing at all, rather than an empty block.
 * @param sections - the contributors in render order.
 * @returns the labelled blocks joined by blank lines, or an empty string.
 */
export function attribute(sections: readonly FrameSection[]): string {
  return sections
    .filter(section => section.body.trim().length > 0)
    .map(section => {
      const kind = section.kind === undefined || section.kind === '' ? '' : ' (' + singleLine(section.kind) + ')'
      return 'Instructions from: ' + singleLine(section.heading) + kind + ':\n\n' + section.body.trim()
    })
    .join('\n\n')
}

/**
 * Render the measured hook provenance line.
 *
 * Claude Code prefixes hook output with its source: the event, an optional
 * matcher, the literal word `hook`, and the status. A hook that succeeded with
 * plain stdout reports `success`, one that contributed JSON context reports
 * `additional context`, and one that refused reports `error`.
 * @param event - the hook event name, such as `SessionStart`.
 * @param matcher - the value the hook matched on, such as `startup` or a tool name.
 * @param status - what the hook did.
 * @param text - the hook's own output.
 * @returns the provenance line.
 */
export function hookLine(event: string, matcher: string | undefined, status: HookStatus, text: string): string {
  const target = matcher === undefined || matcher === '' ? event : event + ':' + singleLine(matcher)
  return target + ' hook ' + status + ': ' + text
}

/**
 * Escape contributor text placed inside an emphasis block.
 *
 * This is the host's own entry escaper, the one its skill catalog applies to
 * every name and description. Reusing it keeps one definition for both
 * producers.
 * @param text - the contributor text.
 * @returns the text with markup characters escaped.
 */
export function escapeEntry(text: string): string {
  return escapeText(text)
}

/** Collapse a heading to one readable line. */
function singleLine(value: string): string {
  let single = ''
  for (const character of value) single += character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character
  return single.replace(/\s+/gu, ' ').trim()
}
