/**
 * View model for the output-styles surface.
 *
 * The server decides every row; this module only groups rows by source for
 * display and maps a source to its heading. Keeping the grouping here makes the
 * order testable without rendering, and keeps the panel a renderer.
 * @module features/output-styles/output-styles-view-model
 */
import type { OutputStyleRow, OutputStyleSource } from '../../../../market-contracts/src/contracts/output-styles.js'
import type { LocaleKey } from '../../locales.js'

/** One displayed group, in trust order. */
export interface OutputStyleGroup {
  source: OutputStyleSource
  rows: OutputStyleRow[]
}

/**
 * Group the styles by source, keeping the trust order.
 *
 * The order is fixed rather than derived from the header: user styles are the
 * person's own, and a suite style carries text a person captured, so the list
 * reads from most to least certain.
 * @param rows - every style the server returned.
 * @returns the groups that hold at least one row.
 */
export function groupOutputStyles(rows: readonly OutputStyleRow[]): OutputStyleGroup[] {
  const order: OutputStyleSource[] = ['user', 'suite']
  return order.map(source => ({ source, rows: rows.filter(row => row.source === source) })).filter(group => group.rows.length > 0)
}

/** The heading key of one group. */
export function groupLocaleKey(source: OutputStyleSource): LocaleKey {
  switch (source) {
    case 'user':
      return 'outputStylesGroupUser'
    case 'suite':
      return 'outputStylesGroupSuite'
  }
}

/**
 * Whether a style can be selected right now.
 *
 * A suite style is usable only while its capture matches the declaration in
 * force: its text is the style, so a stale capture is not a style at all.
 * @param row - one style.
 * @returns true when selecting it would inject that style's text.
 */
export function isSelectable(row: OutputStyleRow): boolean {
  return row.source !== 'suite' || row.capture === 'current'
}

/** Whether a row offers a capture action, and whether it is the first one. */
export function captureAction(row: OutputStyleRow): 'none' | 'first' | 'again' {
  if (row.source !== 'suite') return 'none'
  if (row.capture === 'missing') return 'first'
  if (row.capture === 'stale') return 'again'
  return 'none'
}

/** A user style name from its row id, or undefined for another source. */
export function userNameOf(row: OutputStyleRow): string | undefined {
  return row.source === 'user' ? row.id.slice('user:'.length) : undefined
}

/** A suite address from its row id, or undefined for another source. */
export function suiteKeyOf(row: OutputStyleRow): string | undefined {
  if (row.source !== 'suite') return undefined
  return row.suiteKey ?? row.id.slice('suite:'.length)
}
