import { useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from '../../ui/DetailModal.js'
import { ServerConfigEditor } from '../../ui/ServerConfigEditor.js'
import { fieldErrorsOf, parseServerConfig } from '../../ui/server-form.js'
import type { Translate } from '../../index.js'
import { addMcpServer } from '../../api.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import css from './mcp-status.module.css'

/**
 * The new-service dialog is one short form: name, transport, and the field
 * that transport requires. A definition too complex for the form is entered in
 * the editor's JSON view instead — the same document, written by hand.
 */
export function McpAddModal({ t, onClose, onSaved }: { t: Translate; onClose: () => void; onSaved: () => void }): ReactNode {
  const [name, setName] = useState('')
  const [config, setConfig] = useState('{"type":"stdio","command":""}')
  const [valid, setValid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>()
  const save = (): void => {
    setBusy(true)
    setError(undefined)
    setFieldErrors(undefined)
    void Promise.resolve()
      .then(() => addMcpServer(name.trim(), parseServerConfig(config)))
      .then(onSaved)
      .catch(caught => {
        setError(clientErrorMessage(t, caught))
        setFieldErrors(fieldErrorsOf(caught))
      })
      .finally(() => setBusy(false))
  }
  return h(DetailModal, {
    open: true,
    title: t('mcpAddTitle'),
    // A short form: the dialog takes the form width, not the detail width,
    // and the editor's height so switching views cannot resize the window.
    size: 'md',
    height: 'tall',
    onClose: busy ? () => {} : onClose,
    closeLabel: t('cancel'),
    contentClassName: css.detailBody,
    footer: h(
      'div',
      { className: css.modalFooter },
      h('span', { className: css.modalFooterHint }, t('editorFooterCreate')),
      h('div', { className: css.modalFooterGrow }),
      h(Button, { variant: 'primary', disabled: busy || name.trim() === '' || !valid, onClick: save }, t('editorCreate'))
    ),
    children: h(
      'div',
      { className: css.detail },
      h(ServerConfigEditor, {
        kind: 'mcp',
        text: config,
        onChange: setConfig,
        t,
        disabled: busy,
        createMode: true,
        ...(fieldErrors === undefined ? {} : { fieldErrors }),
        onValidityChange: setValid,
        nameField: {
          label: t('mcpServerName'),
          // A native control from the editors' own form sheet: the platform
          // `Input` draws its own edge, which nested a second box inside the field.
          control: h('input', {
            value: name,
            placeholder: t('mcpServerNamePh'),
            'aria-label': t('mcpServerName'),
            disabled: busy,
            onChange: (event: { target: { value: string } }) => setName(event.target.value)
          })
        }
      }),
      error === undefined ? null : h('div', { role: 'alert', className: css.error }, error)
    )
  })
}
