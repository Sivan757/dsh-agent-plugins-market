/**
 * View model for the workspace instructions surface.
 *
 * The rows arrive already decided by the server, which reads them off the host
 * renderer's own answer. This module only groups them for display, maps a
 * status to its chip and tone, and does byte arithmetic for the budget bar, so
 * the panel stays a renderer and the mapping stays testable.
 * @module features/instructions/instructions-view-model
 */
import type { InstructionRow, InstructionRowStatus } from '../../../../market-contracts/src/contracts/instructions.js'
import type { LocaleKey } from '../../locales.js'

/** The two groups the chain renders under. */
export type InstructionGroupKey = 'global' | 'project'

/** One displayed group, in load order. */
export interface InstructionGroup {
  key: InstructionGroupKey
  rows: InstructionRow[]
}

/**
 * Split the chain into its user-global and project groups, keeping order.
 *
 * Both user-global roots form one group because the host deduplicates them as
 * one candidate group, so the second row can only ever repeat the first.
 * @param rows - the chain in host load order.
 * @returns the groups that hold at least one row.
 */
export function groupInstructionRows(rows: readonly InstructionRow[]): InstructionGroup[] {
  const global = rows.filter(row => row.scope !== 'project')
  const project = rows.filter(row => row.scope === 'project')
  return [...(global.length === 0 ? [] : [{ key: 'global' as const, rows: global }]), ...(project.length === 0 ? [] : [{ key: 'project' as const, rows: project }])]
}

/** Where one group's rows sit in load order, for the group heading. */
export function groupLocaleKey(group: InstructionGroupKey): LocaleKey {
  return group === 'global' ? 'instructionsGroupGlobal' : 'instructionsGroupProject'
}

/** The chip label key of one row status. */
export function statusLocaleKey(status: InstructionRowStatus): LocaleKey {
  switch (status) {
    case 'loaded':
      return 'instructionsStatusLoaded'
    case 'truncated':
      return 'instructionsStatusTruncated'
    case 'over-budget':
      return 'instructionsStatusOverBudget'
    case 'source-over-budget':
      return 'instructionsStatusSourceOverBudget'
    case 'duplicate':
      return 'instructionsStatusDuplicate'
    case 'not-included':
      return 'instructionsStatusNotIncluded'
    case 'missing':
      return 'instructionsStatusMissing'
  }
}

/** The tag tone of one row status: only a failure reads as danger. */
export function statusTone(status: InstructionRowStatus): 'success' | 'warning' | 'info' | 'quiet' | 'neutral' {
  switch (status) {
    case 'loaded':
      return 'success'
    case 'truncated':
      return 'warning'
    case 'over-budget':
    case 'source-over-budget':
      return 'warning'
    case 'duplicate':
      return 'info'
    case 'not-included':
      return 'neutral'
    case 'missing':
      return 'quiet'
  }
}

/** Whether a row may be edited or deleted, or only created. */
export function isWritable(row: InstructionRow): boolean {
  return row.exists
}

/**
 * The share of the budget the rendered text uses.
 *
 * A budget of zero or less disables loading rather than describing an empty
 * budget, so it reports zero instead of dividing by it.
 * @param total - rendered UTF-8 bytes.
 * @param budget - the configured cap.
 * @returns a percentage between 0 and 100.
 */
export function budgetPercent(total: number, budget: number): number {
  if (!(budget > 0)) return 0
  return Math.max(0, Math.min(100, Math.round((total / budget) * 100)))
}

/** Whether the rendered text exceeds its budget. */
export function isOverBudget(total: number, budget: number): boolean {
  return budget > 0 && total > budget
}

/** Show a byte count the way the panel labels sizes. */
export function formatBytes(bytes: number): string {
  return String(bytes)
}
