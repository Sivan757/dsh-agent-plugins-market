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
 * The order is fixed rather than derived from the header: the person's own styles come
 * first, then the suites they installed, then the ones the workspace keeps for itself.
 * @param rows - every style the server returned.
 * @returns the groups that hold at least one row.
 */
export function groupOutputStyles(rows: readonly OutputStyleRow[]): OutputStyleGroup[] {
  const order: OutputStyleSource[] = ['user', 'suite', 'project']
  return order.map(source => ({ source, rows: rows.filter(row => row.source === source) })).filter(group => group.rows.length > 0)
}

/** The heading key of one group. */
export function groupLocaleKey(source: OutputStyleSource): LocaleKey {
  switch (source) {
    case 'user':
      return 'outputStylesGroupUser'
    case 'suite':
      return 'outputStylesGroupSuite'
    case 'project':
      return 'outputStylesGroupProject'
  }
}

/**
 * Where a row's text came from, as the meta line spells it.
 *
 * A suite style names its suite; a file-backed style names the file it was read from.
 * @param row - one style.
 * @returns the meta text, or an empty string when the row is the person's own.
 */
export function sourceMetaOf(row: OutputStyleRow): string {
  if (row.source === 'suite') return row.suiteName ?? row.suiteKey ?? ''
  if (row.source === 'project') return row.file ?? ''
  return ''
}

/** A user style name from its row id, or undefined for another source. */
export function userNameOf(row: OutputStyleRow): string | undefined {
  return row.id.startsWith('user:') ? row.id.slice('user:'.length) : undefined
}
