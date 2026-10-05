// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MARKET_SETTINGS_DEFAULTS } from '../src/contracts/settings.js'
import { bindInterfaceLanguage, bindTranslationEnabled, translationEnabled, useTranslationEnabled } from '../src/client/ui/translation-enabled.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function form(initial?: { translationEnabled?: boolean }) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ value }),
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(next?: { translationEnabled?: boolean }) {
      value = next
      for (const listener of listeners) listener()
    },
    listeners
  }
}

/** A locale row double: the stored preference the interface language is read from. */
function localeRow(preference?: string) {
  let value: { preference?: string } | undefined = preference === undefined ? undefined : { preference }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ value }),
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(next?: string) {
      value = next === undefined ? undefined : { preference: next }
      for (const listener of listeners) listener()
    },
    listeners
  }
}

const releases: Array<() => void> = []
let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  container = undefined
  for (const release of releases.splice(0).reverse()) release()
})

describe('shared translation setting', () => {
  it('holds the declared default before the host answers and resolves the section after', () => {
    // No binding at all is the pre-answer state: the declared default withholds
    // the control rather than flashing it.
    expect(translationEnabled.getSnapshot()).toBe(MARKET_SETTINGS_DEFAULTS.translationEnabled)
    const source = form()
    releases.push(bindTranslationEnabled(source))
    // A binding resolves what it is handed. A section that says nothing about
    // the field takes the interface language, and a binding wired without one
    // takes the host's own absence rule, which reads as zh.
    expect(translationEnabled.getSnapshot()).toBe(true)
    source.update({})
    expect(translationEnabled.getSnapshot()).toBe(true)
    source.update({ translationEnabled: true })
    expect(translationEnabled.getSnapshot()).toBe(true)
    source.update({ translationEnabled: false })
    expect(translationEnabled.getSnapshot()).toBe(false)
  })

  it('notifies only when the effective boolean changes', () => {
    const row = localeRow('en')
    const source = form({ translationEnabled: true })
    releases.push(bindTranslationEnabled(source, bindInterfaceLanguage(row)))
    const changed = vi.fn()
    releases.push(translationEnabled.subscribe(changed))
    source.update({ translationEnabled: true })
    source.update({ translationEnabled: true })
    expect(changed).not.toHaveBeenCalled()
    source.update({ translationEnabled: false })
    expect(changed).toHaveBeenCalledOnce()
    // The section now says nothing, so the English interface answers: off, the
    // value already in force, and no notification.
    source.update({})
    expect(changed).toHaveBeenCalledOnce()
    row.update('zh')
    expect(changed).toHaveBeenCalledTimes(2)
    expect(translationEnabled.getSnapshot()).toBe(true)
  })

  it('keeps subscribers connected across replacement and disposal', () => {
    const first = form({ translationEnabled: true })
    const stopFirst = bindTranslationEnabled(first)
    releases.push(stopFirst)
    const changed = vi.fn()
    releases.push(translationEnabled.subscribe(changed))
    const second = form({ translationEnabled: true })
    const stopSecond = bindTranslationEnabled(second)
    releases.push(stopSecond)
    expect(first.listeners.size).toBe(0)
    expect(second.listeners.size).toBe(1)
    expect(changed).not.toHaveBeenCalled()
    stopFirst()
    first.update({ translationEnabled: false })
    expect(translationEnabled.getSnapshot()).toBe(true)
    stopSecond()
    expect(second.listeners.size).toBe(0)
    expect(translationEnabled.getSnapshot()).toBe(false)
    expect(changed).toHaveBeenCalledOnce()
    second.update({ translationEnabled: true })
    expect(translationEnabled.getSnapshot()).toBe(false)
  })

  it('turns translation on for a Chinese interface the document leaves open', () => {
    const source = form()
    releases.push(bindTranslationEnabled(source, bindInterfaceLanguage(localeRow('zh'))))
    expect(translationEnabled.getSnapshot()).toBe(true)
    source.update({})
    expect(translationEnabled.getSnapshot()).toBe(true)
  })

  it.each(['en', 'en-US'])('leaves translation off for the %s interface', preference => {
    releases.push(bindTranslationEnabled(form(), bindInterfaceLanguage(localeRow(preference))))
    expect(translationEnabled.getSnapshot()).toBe(false)
  })

  it('turns translation on for a language the host renders with its Chinese dictionary', () => {
    // `bindHostLocale` answers every non-English preference with Chinese, so the
    // switch and the text it describes agree on `ja` as well as on `zh`.
    releases.push(bindTranslationEnabled(form(), bindInterfaceLanguage(localeRow('ja'))))
    expect(translationEnabled.getSnapshot()).toBe(true)
  })

  it('reads a language row holding nothing as zh, the rule every host-facing read gives it', () => {
    releases.push(bindTranslationEnabled(form(), bindInterfaceLanguage(localeRow())))
    expect(translationEnabled.getSnapshot()).toBe(true)
  })

  it('reads a binding wired without a language source the way the host reads an absent preference', () => {
    // `bindHostLocale` answers an absent preference with the Chinese dictionary,
    // so a composition that wires no language source follows that reading rather
    // than silently disabling what the host would call a Chinese interface.
    releases.push(bindTranslationEnabled(form()))
    expect(translationEnabled.getSnapshot()).toBe(true)
  })

  it('keeps a stored value across a language switch, in both directions', () => {
    const row = localeRow('zh')
    const source = form({ translationEnabled: false })
    releases.push(bindTranslationEnabled(source, bindInterfaceLanguage(row)))
    expect(translationEnabled.getSnapshot()).toBe(false)
    row.update('en')
    expect(translationEnabled.getSnapshot()).toBe(false)
    source.update({ translationEnabled: true })
    row.update('zh')
    expect(translationEnabled.getSnapshot()).toBe(true)
  })

  it('moves a field the document says nothing about with the language', () => {
    const row = localeRow('en')
    const source = form()
    releases.push(bindTranslationEnabled(source, bindInterfaceLanguage(row)))
    expect(translationEnabled.getSnapshot()).toBe(false)
    row.update('zh')
    expect(translationEnabled.getSnapshot()).toBe(true)
    // A stored off stands against the language; clearing it hands the field back.
    source.update({ translationEnabled: false })
    expect(translationEnabled.getSnapshot()).toBe(false)
    row.update('en')
    expect(translationEnabled.getSnapshot()).toBe(false)
    source.update({})
    expect(translationEnabled.getSnapshot()).toBe(false)
    row.update('zh')
    expect(translationEnabled.getSnapshot()).toBe(true)
  })

  it('updates a mounted hook when the host binds late and is re-served', async () => {
    const Probe = () => h('output', null, String(useTranslationEnabled()))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(h(Probe)))
    expect(container.textContent).toBe('false')
    const source = form({ translationEnabled: true })
    let unbind!: () => void
    await act(async () => {
      unbind = bindTranslationEnabled(source)
    })
    releases.push(unbind)
    expect(container.textContent).toBe('true')
    await act(async () => source.update({ translationEnabled: false }))
    expect(container.textContent).toBe('false')
    await act(async () => source.update({ translationEnabled: true }))
    expect(container.textContent).toBe('true')
    await act(async () => unbind())
    expect(container.textContent).toBe('false')
    await act(async () => {
      releases.push(bindTranslationEnabled(source))
    })
    expect(container.textContent).toBe('true')
  })
})
