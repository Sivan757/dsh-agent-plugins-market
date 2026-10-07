// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { DetailModal, SettingsSizedDetails } from '../packages/market-ui/src/ui/DetailModal.js'
import css from '../packages/market-ui/src/ui/detail.module.css'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
})
it('keeps preset details settings-sized across loading and loaded content without resizing other callers', async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const modal = (text: string) => h(DetailModal, { open: true, title: 'Resource', closeLabel: 'Close', onClose: () => {} }, text)
  await act(async () => root!.render(modal('ordinary')))
  expect(document.querySelector('[role="dialog"]')?.classList.contains(css.settingsFrame!)).toBe(false)
  for (const content of ['Loading', 'Full document and service configuration']) {
    await act(async () => root!.render(h(SettingsSizedDetails, { footer: h('button', null, 'Toggle preset resource'), children: modal(content) })))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.classList.contains(css.settingsFrame!)).toBe(true)
    expect(dialog.classList.contains(css.tallDialog!)).toBe(true)
    expect(dialog.textContent).toContain(content)
    expect(dialog.querySelector(`.${css.footer!}`)?.textContent).toContain('Toggle preset resource')
  }
})
