/**
 * The frame module is the only place this plugin decides how injected content
 * looks. These cases pin each rule to the behaviour that satisfies it.
 */
import { describe, expect, it } from 'vitest'
import {
  SYSTEM_REMINDER_CLOSE,
  SYSTEM_REMINDER_OPEN,
  attribute,
  escapeEntry,
  escapeFrameBody,
  frame
} from '../../../../packages/market-runtime/src/runtime/surfaces/prompt-frame.js'

describe('prompt frame', () => {
  it('escapes a closing frame marker so a body cannot end the frame', () => {
    const body = 'before ' + SYSTEM_REMINDER_CLOSE + ' after'
    const escaped = escapeFrameBody(body)
    expect(escaped).not.toContain(SYSTEM_REMINDER_CLOSE)
    expect(escaped).toBe('before <\\/system-reminder> after')
  })

  it('leaves an already escaped marker alone instead of gaining backslashes', () => {
    const once = escapeFrameBody('close ' + SYSTEM_REMINDER_CLOSE)
    expect(escapeFrameBody(once)).toBe(once)
  })

  it('does not re-escape an already escaped marker when the frame is applied', () => {
    // A body may already carry the escaped form, for example when a suite copied
    // a framed block out of an earlier transcript. Framing it again must not turn
    // one backslash into two: the text would drift on every re-injection.
    const escaped = escapeFrameBody('text ' + SYSTEM_REMINDER_CLOSE)
    const framed = frame(escaped)
    expect(framed).toContain(escaped)
    expect(framed).not.toContain('<\\\\/system-reminder>')
    // Exactly one closing marker, the frame's own.
    expect(framed.split(SYSTEM_REMINDER_CLOSE).length - 1).toBe(1)
  })

  it('frames an assembled body with the familiar markers on their own lines', () => {
    expect(frame('body')).toBe([SYSTEM_REMINDER_OPEN, 'body', SYSTEM_REMINDER_CLOSE].join('\n'))
  })

  it('escapes inside the frame, not around it', () => {
    const framed = frame('a ' + SYSTEM_REMINDER_CLOSE)
    // The only closing marker left is the frame's own final line.
    expect(framed.split(SYSTEM_REMINDER_CLOSE).length - 1).toBe(1)
    expect(framed.endsWith(SYSTEM_REMINDER_CLOSE)).toBe(true)
  })

  it('attributes one heading per contributor so two suites stay separable', () => {
    expect(
      attribute([
        { heading: 'alpha', body: 'one' },
        { heading: 'beta', body: 'two' }
      ])
    ).toBe('### alpha\n\none\n\n### beta\n\ntwo')
  })

  it('contributes nothing for an empty section', () => {
    expect(attribute([{ heading: 'empty', body: '   ' }])).toBe('')
    expect(
      attribute([
        { heading: 'empty', body: '' },
        { heading: 'kept', body: 'text' }
      ])
    ).toBe('### kept\n\ntext')
    expect(attribute([])).toBe('')
  })

  it('keeps a contributor heading on one line', () => {
    expect(attribute([{ heading: 'a\nb\tc', body: 'text' }])).toBe('### a b c\n\ntext')
  })

  it('escapes emphasis-block entry text the way the host does', () => {
    expect(escapeEntry('<b> & </b>')).toBe('&lt;b&gt; &amp; &lt;/b&gt;')
  })
})
