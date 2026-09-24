import { useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from '../../ui/DetailModal.js'
import { ServerConfigEditor } from '../../ui/ServerConfigEditor.js'
import { fieldErrorsOf, MCP_TEMPLATES, parsePastedServer, parseServerConfig, type McpTemplate, type ServerConfig } from '../../ui/server-form.js'
import type { Translate } from '../../index.js'
import { addMcpServer, importMcpServers } from '../../api.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import { parsePastedServersOrUndefined } from './detail-helpers.js'
import css from './mcp-status.module.css'

export function McpAddModal({ t, onClose, onSaved, onChanged }: { t: Translate; onClose: () => void; onSaved: () => void; onChanged?: () => void }): ReactNode {
  const [name, setName] = useState('')
  const [config, setConfig] = useState('{"type":"stdio","command":""}')
  const [valid, setValid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>()
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState<string>()
  const [overwrite, setOverwrite] = useState(false)
  const [pasteOutcome, setPasteOutcome] = useState<{ imported: string[]; skipped: Array<{ name: string; reason: string }> }>()
  // Parsed on every render: the preview and the import button read the same
  // result, and a half-typed paste simply offers no action yet.
  const pasted = pasteOpen && pasteText.trim() !== '' ? parsePastedServersOrUndefined(pasteText) : undefined
  const applyTemplate = (template: McpTemplate): void => {
    setConfig(JSON.stringify(template.config, null, 2))
    setTemplatesOpen(false)
    setPasteError(undefined)
  }
  const applyPaste = (): void => {
    try {
      const pasted = parsePastedServer(pasteText)
      if (pasted.name !== undefined && name.trim() === '') setName(pasted.name)
      setConfig(JSON.stringify(pasted.config, null, 2))
      setPasteOpen(false)
      setPasteError(undefined)
    } catch (reason) {
      setPasteError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const runImport = (): void => {
    if (pasted === undefined) return
    const named = pasted.filter((entry): entry is { name: string; config: ServerConfig } => entry.name !== undefined && entry.name !== '')
    const unnamed = pasted.length - named.length
    if (named.length === 0) {
      setPasteOutcome({ imported: [], skipped: [{ name: '—', reason: t('mcpPasteUnnamed') }] })
      return
    }
    setBusy(true)
    setPasteError(undefined)
    setPasteOutcome(undefined)
    void importMcpServers(
      named.map(entry => ({ name: entry.name, config: entry.config })),
      overwrite
    )
      .then(result => {
        const skipped = [...result.skipped, ...(unnamed === 0 ? [] : [{ name: '—', reason: t('mcpPasteUnnamed') }])]
        setPasteOutcome({ imported: result.imported, skipped })
        if (result.imported.length > 0) onChanged?.()
      })
      .catch(reason => setPasteError(clientErrorMessage(t, reason)))
      .finally(() => setBusy(false))
  }
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
    // A short form: the dialog takes the form width, not the detail width.
    size: 'md',
    onClose: busy ? () => {} : onClose,
    closeLabel: t('cancel'),
    contentClassName: css.detailBody,
    footer: h(
      'div',
      { className: css.modalFooter },
      h('span', { className: css.modalFooterHint }, t('editorFooterCreate')),
      h('div', { className: css.modalFooterGrow }),
      h(Button, { variant: 'outline', disabled: busy, onClick: onClose }, t('cancel')),
      h(Button, { variant: 'primary', disabled: busy || name.trim() === '' || !valid, onClick: save }, t('editorCreate'))
    ),
    children: h(
      'div',
      { className: css.detail },
      // Two ways in that skip the form: a known service, or a definition copied
      // from another client's configuration file.
      h(
        'div',
        { className: css.starter },
        h(
          Button,
          { variant: 'outline', size: 'sm', type: 'button', disabled: busy, 'aria-expanded': templatesOpen, onClick: () => setTemplatesOpen(value => !value) },
          t('mcpStarterTemplates')
        ),
        h(
          Button,
          { variant: 'outline', size: 'sm', type: 'button', disabled: busy, 'aria-expanded': pasteOpen, onClick: () => setPasteOpen(value => !value) },
          t('mcpStarterPaste')
        )
      ),
      templatesOpen
        ? h(
            'div',
            { className: css.starterList },
            ...MCP_TEMPLATES.map(template =>
              h(Button, { key: template.id, variant: 'ghost', size: 'sm', type: 'button', disabled: busy, onClick: () => applyTemplate(template) }, t(template.labelKey))
            )
          )
        : null,
      pasteOpen
        ? h(
            'div',
            { className: css.starterPaste },
            h('textarea', {
              className: css.pasteArea,
              value: pasteText,
              spellCheck: false,
              'aria-label': t('mcpStarterPaste'),
              placeholder: t('mcpPastePlaceholder'),
              disabled: busy,
              onChange: (event: { target: { value: string } }) => {
                setPasteText(event.target.value)
                setPasteOutcome(undefined)
                setPasteError(undefined)
              }
            }),
            pasted === undefined ? null : h('p', { className: css.pasteNote }, t('mcpPasteFound', { count: pasted.length })),
            h(
              'div',
              { className: css.starter },
              // One definition can also be reviewed in the form; a whole map is
              // imported as it stands.
              pasted !== undefined && pasted.length === 1
                ? h(Button, { variant: 'outline', size: 'sm', type: 'button', disabled: busy, onClick: applyPaste }, t('mcpPasteApply'))
                : null,
              pasted === undefined
                ? null
                : h(Button, { variant: 'primary', size: 'sm', type: 'button', disabled: busy, onClick: runImport }, t('mcpPasteImport'))
            ),
            pasted !== undefined && pasted.length > 1
              ? h(
                  'label',
                  { className: css.pasteCheck },
                  h('input', { type: 'checkbox', checked: overwrite, disabled: busy, onChange: (event: { target: { checked: boolean } }) => setOverwrite(event.target.checked) }),
                  ' ',
                  t('mcpPasteOverwrite')
                )
              : null,
            pasteOutcome === undefined
              ? null
              : h(
                  'div',
                  { className: css.pasteOutcome },
                  pasteOutcome.imported.length === 0 ? null : h('p', null, t('mcpPasteImported', { names: pasteOutcome.imported.join(', ') })),
                  pasteOutcome.skipped.length === 0
                    ? null
                    : h('p', null, t('mcpPasteSkipped', { detail: pasteOutcome.skipped.map(entry => `${entry.name} (${entry.reason})`).join(', ') }))
                ),
            pasteError === undefined ? null : h('div', { role: 'alert', className: css.error }, pasteError)
          )
        : null,
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

