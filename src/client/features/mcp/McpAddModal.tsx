import { createElement as h, type ReactNode } from 'react'
import { ServerConfigModal } from '../../ui/ServerConfigModal.js'
import type { CredentialApi } from '../../credentials.js'
import type { Translate } from '../../index.js'

export function McpAddModal({ t, credentials, onClose, onSaved }: { t: Translate; credentials?: CredentialApi; onClose: () => void; onSaved: () => void }): ReactNode {
  return h(ServerConfigModal, { kind: 'mcp', t, ...(credentials === undefined ? {} : { credentials }), onClose, onSaved })
}
