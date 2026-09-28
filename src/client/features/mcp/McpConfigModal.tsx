import type { ReactNode } from 'react'
import { createElement as h } from 'react'
import { DetailModal } from '../../ui/DetailModal.js'
import { ServerConfigDetail } from '../../ui/ServerConfigDetail.js'
import type { Translate } from '../../index.js'
import type { McpStatusEntry } from '../../api.js'
import css from './mcp-status.module.css'

export function McpConfigModal({ entry, t, onClose, onSaved }: { entry: McpStatusEntry; t: Translate; onClose: () => void; onSaved: () => void }): ReactNode {
  return h(DetailModal, {
    open: true,
    title: t('mcpEditTitle'),
    description: entry.name,
    closeLabel: t('cancel'),
    onClose,
    // The same width the add dialog uses: one form, one shape.
    size: 'md',
    contentClassName: css.detailBody,
    children: h(ServerConfigDetail, { kind: 'mcp', id: entry.id, t, onSaved })
  })
}

