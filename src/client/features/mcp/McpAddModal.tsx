import { createElement as h, type ReactNode } from 'react'
import { DetailModal } from '../../ui/DetailModal.js'
import { ServerConfigDetail } from '../../ui/ServerConfigDetail.js'
import type { CredentialApi } from '../../credentials.js'
import type { Translate } from '../../index.js'
import css from './mcp-status.module.css'

/**
 * The new-service dialog: the editor the edit dialog opens, in its create mode,
 * so a service is one form whether it exists yet or not.
 *
 * The dialog owns the chrome — title, width, height, the footer's line about
 * what creating does — and the form owns its fields, its validation and the
 * create action it contributes to the same footer.
 */
export function McpAddModal({ t, credentials, onClose, onSaved }: { t: Translate; credentials?: CredentialApi; onClose: () => void; onSaved: () => void }): ReactNode {
  return h(DetailModal, {
    open: true,
    title: t('mcpAddTitle'),
    size: 'md',
    height: 'tall',
    onClose,
    closeLabel: t('cancel'),
    contentClassName: css.detailBody,
    footer: h(
      'div',
      { className: css.modalFooter },
      h('span', { className: css.modalFooterHint }, t('editorFooterCreate')),
      h('div', { className: css.modalFooterGrow })
    ),
    children: h(ServerConfigDetail, { kind: 'mcp', create: true, t, ...(credentials === undefined ? {} : { credentials }), onSaved })
  })
}
