/**
 * Localized display copy for the host JSON tree.
 *
 * The primitives package is cordis-free, so every label arrives from the render
 * site; one factory keeps all three JSON surfaces (suite, MCP, LSP) on the same
 * wording.
 * @module client/ui/json-tree-labels
 */
import type { JsonTreeLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../index.js'

/** The labels one JSON tree needs, resolved against the active dictionary. */
export function jsonTreeLabels(t: Translate): JsonTreeLabels {
  const copy = t('jsonCopyAction')
  return {
    copyValue: t('jsonCopyValue'),
    copyJson: t('jsonCopyJson'),
    copyPath: t('jsonCopyPath'),
    copyPrettyJson: t('jsonCopyPretty'),
    copyCompactJson: t('jsonCopyCompact'),
    copied: t('jsonCopied'),
    copyFailed: t('jsonCopyFailed'),
    collapseNode: t('jsonCollapseNode'),
    expandNode: t('jsonExpandNode'),
    copyButtonTitle: action => `${copy} ${action}`
  }
}
