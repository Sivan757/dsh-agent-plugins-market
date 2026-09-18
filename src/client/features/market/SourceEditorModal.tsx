/** Source editor modal for adding or editing a catalog source. */
import { createElement as h, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SourceOverview } from '../../api.js'
import type { SourceProgressState } from './market-resource.js'
import type { Translate } from '../../index.js'
import css from '../../market.module.css'
import formCss from '../../ui/form.module.css'

export type EditorState = { mode: 'edit'; source: SourceOverview } | { mode: 'add' } | undefined

/** Which acquisition path the editor configures. */
export type SourceEditorKind = 'git' | 'archive' | 'local'

export interface SourceEditorModalProps {
  t: Translate
  editor: Exclude<EditorState, undefined>
  busy: boolean
  progress: SourceProgressState
  onClose: () => void
  onSave: (input: { url: string; branch: string; kind: SourceEditorKind; sha256: string }) => Promise<boolean>
  onRemove: (id: string) => void
}

export function SourceEditorModal(props: SourceEditorModalProps): ReactNode {
  const { t, editor } = props
  const [kind, setKind] = useState<SourceEditorKind>(editor.mode === 'edit' ? (editor.source.kind === 'archive' ? 'archive' : editor.source.local === true ? 'local' : 'git') : 'git')
  const [url, setUrl] = useState(editor.mode === 'edit' ? editor.source.url : '')
  const [branch, setBranch] = useState(editor.mode === 'edit' ? (editor.source.branch ?? '') : '')
  const [sha256, setSha256] = useState('')
  const id = editor.mode === 'edit' ? editor.source.id : ''
  const title = editor.mode === 'edit' ? t('editSourceTitle') : t('addSourceTitle')
  // The label names the field; the placeholder shows the shape of an answer.
  const urlLabel = kind === 'local' ? t('sourceUrlLocalPh') : kind === 'archive' ? t('sourceUrlArchivePh') : t('sourceUrlPh')
  const urlEg = kind === 'local' ? t('sourceUrlEgLocal') : kind === 'archive' ? t('sourceUrlEgArchive') : t('sourceUrlEgGit')
  const segment = (value: SourceEditorKind, label: string): ReactNode =>
    h(
      'button',
      {
        type: 'button',
        'aria-pressed': kind === value,
        onClick: () => setKind(value)
      },
      label
    )
  const field = (label: string, control: ReactNode): ReactNode =>
    h('label', { className: formCss.field }, h('span', null, label), control)
  return h(Modal, {
    open: true,
    onClose: props.onClose,
    title,
    closeLabel: t('cancel'),
    className: css.editorDialog,
    footer: h(
      'div',
      { className: formCss.footer },
      h('div', { className: css.modalFooterLeft }, editor.mode === 'edit' ? h(Button, { variant: 'outline', onClick: () => props.onRemove(id) }, t('removeSourceAction')) : null),
      h('div', { className: formCss.grow }),
      h(Button, { variant: 'outline', onClick: props.onClose }, t('cancel')),
      h(
        Button,
        {
          variant: 'primary',
          disabled: props.busy,
          onClick: () => {
            void props.onSave({ url: url.trim(), branch: branch.trim(), kind, sha256: sha256.trim() })
          }
        },
        editor.mode === 'edit' ? t('save') : t('panelAdd')
      )
    ),
    children: h(
      'div',
      { className: formCss.form },
      h('div', { className: formCss.seg }, segment('git', t('editorKindGit')), segment('archive', t('editorKindArchive')), segment('local', t('editorKindLocal'))),
      editor.mode === 'edit'
        ? h(
            'div',
            { className: formCss.field },
            h('span', null, t('sourceIdPh')),
            h('div', { className: formCss.readonly, title: t('idFixed') }, id)
          )
        : null,
      field(urlLabel, h('input', { placeholder: urlEg, value: url, 'aria-label': urlLabel, onChange: (event: { target: HTMLInputElement }) => setUrl(event.target.value) })),
      kind === 'git'
        ? field(
            t('branchPh'),
            h('input', { placeholder: t('branchEg'), value: branch, 'aria-label': t('branchPh'), onChange: (event: { target: HTMLInputElement }) => setBranch(event.target.value) })
          )
        : null,
      kind === 'archive'
        ? field(
            'SHA256',
            h('input', { placeholder: t('sha256Ph'), value: sha256, 'aria-label': 'SHA256', onChange: (event: { target: HTMLInputElement }) => setSha256(event.target.value) })
          )
        : null,
      // Scope is fixed once a source exists: the acquisition path it was
      // registered with decides whether its suites are user- or locally-scoped.
      editor.mode === 'edit'
        ? h(
            'div',
            { className: formCss.field },
            h('span', null, t('editorScope')),
            h('div', { className: formCss.readonly }, `${editor.source.local === true ? t('editorScopeLocal') : t('editorScopeUser')} · ${editor.source.suiteIds.length} ${t('sourceSuiteUnit')}`)
          )
        : null,
      props.progress.error === undefined && props.progress.step === undefined
        ? null
        : h(
            'div',
            {
              className: props.progress.error === undefined ? css.progress : css.progressError
            },
            props.progress.error === undefined ? h('span', { className: css.progressSpin }) : h('span', { className: css.progressFail }, '✕'),
            h('span', { className: css.progressText }, props.progress.error === undefined ? props.progress.step : `${t('actionFail')}: ${props.progress.error}`)
          )
    )
  })
}
