/**
 * One instruction file, opened for reading.
 *
 * The list is scanned to answer "what does the model receive"; this dialog answers
 * "and what is in this one, and where does it live". Editing is a deliberate second
 * step from here: clicking a row used to drop the reader straight into an editor,
 * which made browsing feel like an unsaved change waiting to happen.
 *
 * @module features/instructions/InstructionDetail
 */
import { createElement as h, type ReactNode } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InstructionRow } from '../../api.js'
import type { Translate } from '../../i18n.js'
import { DetailModal } from '../../ui/DetailModal.js'
import { kvCell } from '../../ui/DetailRows.js'
import { statusLocaleKey } from './instructions-view-model.js'
import css from './instructions.module.css'
import panelCss from '../../ui/panel.module.css'

/** The dialog's inputs. */
export interface InstructionDetailProps {
  t: Translate
  row: InstructionRow
  /** The rendered baseline's byte cap, for the share line. */
  budget: number
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}

/**
 * The scope as a reader names it.
 *
 * @param t - the dictionary.
 * @param row - the row being shown.
 * @returns the scope's own label, naming the root when the row is user-global.
 */
function scopeLabel(t: Translate, row: InstructionRow): string {
  if (row.scope === 'project') return t('instructionsGroupProject')
  return row.scope === 'agents-global' ? t('instructionsScopeAgentsGlobal') : t('instructionsScopeUserGlobal')
}

/** One instruction file's detail: where it lives, what it contributes, what it says. */
export function InstructionDetail({ t, row, budget, onClose, onEdit, onDelete }: InstructionDetailProps): ReactNode {
  const preview = row.content ?? undefined
  return h(DetailModal, {
    open: true,
    onClose,
    title: row.candidate,
    description: row.displayPath,
    closeLabel: t('cancel'),
    footer: h(
      'div',
      { className: css.detailFooter },
      h(Button, { variant: 'ghost', size: 'sm', onClick: onDelete }, t('panelDelete')),
      h(Button, { variant: 'primary', size: 'sm', onClick: onEdit }, t('instructionsEdit')),
      h(Button, { variant: 'ghost', onClick: onClose }, t('detailDone'))
    ),
    children: h(
      'div',
      null,
      h('h3', { className: panelCss.blockTitle }, t('instructionsDetailChain')),
      h(
        'dl',
        { className: panelCss.kvGrid },
        kvCell(t('sourceLabel'), scopeLabel(t, row)),
        kvCell(t('instructionsDetailPath'), row.path, true),
        kvCell(t('instructionsDetailStatus'), t(statusLocaleKey(row.status))),
        row.size === undefined ? null : kvCell(t('instructionsDetailSize'), t('instructionsRowSize', { bytes: row.size })),
        kvCell(t('instructionsDetailShare'), t('instructionsDetailShareValue', { used: String(row.size ?? 0), budget: String(budget) })),
        row.duplicateOf === undefined ? null : kvCell(t('instructionsDetailDuplicateOf'), row.duplicateOf, true)
      ),
      h('h3', { className: panelCss.blockTitle }, t('instructionsPreviewLabel')),
      preview === undefined
        ? h('p', { className: panelCss.detailProse }, t('instructionsDetailNoPreview'))
        : h('pre', { className: css.preview, 'data-instruction-preview': '' }, preview)
    )
  })
}

/** The status chip one row wears in the list: kept next to the dialog for callers. */
export function statusTag(t: Translate, row: InstructionRow): ReactNode {
  const tone =
    row.status === 'loaded'
      ? ('success' as const)
      : row.status === 'missing' || row.status === 'not-included' || row.status === 'duplicate'
        ? ('quiet' as const)
        : ('danger' as const)
  return h(Tag, { tone }, t(statusLocaleKey(row.status)))
}
