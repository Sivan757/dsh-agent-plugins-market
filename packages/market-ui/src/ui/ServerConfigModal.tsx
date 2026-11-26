import { createElement as h, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CredentialApi } from '../credentials.js'
import type { Translate } from '../i18n.js'
import { FormDialog } from './DetailModal.js'
import { ServerConfigDetail } from './ServerConfigDetail.js'
import type { ServerKind } from './server-form.js'

/** Shared create/edit shell for MCP and LSP service configuration. */
export function ServerConfigModal({
  kind,
  id,
  t,
  credentials,
  onClose,
  onSaved
}: {
  kind: ServerKind
  id?: string
  t: Translate
  credentials?: CredentialApi
  onClose: () => void
  onSaved: () => void
}): ReactNode {
  const create = id === undefined
  return h(FormDialog, {
    title: t(kind === 'mcp' ? (create ? 'mcpAddTitle' : 'mcpEditTitle') : create ? 'lspAddTitle' : 'lspEditTitle'),
    size: 'md',
    height: 'regular',
    onClose,
    closeLabel: t('cancel'),
    // What saving does belongs under the title; the footer is the button row.
    ...(create ? { description: t('editorCreateHint') } : {}),
    actions: [h(Button, { key: 'cancel', variant: 'outline', onClick: onClose }, t('cancel'))],
    children: h(ServerConfigDetail, {
      key: `${kind}:${id ?? 'create'}`,
      kind,
      create,
      ...(id === undefined ? {} : { id }),
      t,
      ...(credentials === undefined ? {} : { credentials }),
      onSaved
    })
  })
}
