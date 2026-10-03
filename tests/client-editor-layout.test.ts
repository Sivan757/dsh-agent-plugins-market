// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { EntryEditorModal } from '../src/client/ui/panel.js'
import formCss from '../src/client/ui/form.module.css'
import { stubTranslate as t } from './helpers/translate.js'

vi.mock('../src/client/ui/CodeEditor.js', () => ({ CodeEditor: () => h('div', { 'data-editor': true }) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let host: HTMLDivElement
afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
})

it.each(['create', 'edit'] as const)('spaces model fields and the document group in %s mode', async mode => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      h(EntryEditorModal, {
        t,
        open: true,
        state: { mode, name: 'expert', text: 'Body' },
        title: 'Expert',
        nameLabel: 'Name',
        textLabel: 'Document',
        modeControl: h('button', null, 'Preview'),
        renderFields: () => h('fieldset', { 'data-model': true }),
        onClose: () => {},
        onSave: async () => true
      })
    )
  )
  const model = document.querySelector('[data-model]')!
  const group = model.nextElementSibling!
  expect(group.className).toBe(formCss.documentGroup)
  expect(model.parentElement!.className).toBe(formCss.editorStack)
  expect(group.querySelector('button')?.textContent).toBe('Preview')
  expect(group.querySelector('[data-editor]')).not.toBeNull()
})
