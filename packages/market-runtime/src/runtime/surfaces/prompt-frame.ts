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
 * @module runtime/surfaces/prompt-frame
 */
import { escapeText } from '@deepseek-ai/dsh-skill'

/** The opening frame the harness's workspace-instruction producer emits. */
export const SYSTEM_REMINDER_OPEN = '<system-reminder>'
/** The closing frame marker. A body must never be able to emit it. */
export const SYSTEM_REMINDER_CLOSE = '</system-reminder>'

/** One attributed contributor inside a framed block. */
export interface FrameSection {
  /** The contributor, named the way a reader identifies it: a suite name or a path. */
  heading: string
  /** The contributor's own text, unmodified. */
  body: string
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
 * Render one Markdown heading and body per contributor.
 *
 * A heading never spans lines: a contributor name is a single line, so any line
 * break or control character inside it becomes a space. A contributor whose
 * body is blank contributes nothing at all, rather than an empty section.
 * @param sections - the contributors in render order.
 * @returns the attributed blocks joined by blank lines, or an empty string.
 */
export function attribute(sections: readonly FrameSection[]): string {
  return sections
    .filter(section => section.body.trim().length > 0)
    .map(section => '### ' + singleLine(section.heading) + '\n\n' + section.body.trim())
    .join('\n\n')
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
