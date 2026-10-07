import { createElement as h, type ReactNode } from 'react'
import { ServerConfigModal } from '../../ui/ServerConfigModal.js'
import type { CredentialApi } from '../../credentials.js'
import type { Translate } from '../../i18n.js'
import type { McpStatusEntry } from '../../api.js'

export function McpConfigModal({
  entry,
  t,
  credentials,
  onClose,
  onSaved
}: {
  entry: McpStatusEntry
  t: Translate
  credentials?: CredentialApi
  onClose: () => void
  onSaved: () => void
}): ReactNode {
  return h(ServerConfigModal, { kind: 'mcp', id: entry.id, t, ...(credentials === undefined ? {} : { credentials }), onClose, onSaved })
}
