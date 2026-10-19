// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MARKET_SETTINGS_DEFAULTS, resolveTranslationTarget } from '../../../../packages/market-contracts/src/contracts/settings.js'
import { bindTranslationEnabled, translationEnabled, useTranslationEnabled, useTranslationRefresh } from '../../../../packages/market-ui/src/ui/translation-enabled.js'

import { useDisplayText } from '../../../../packages/market-ui/src/ui/translated-text.js'
import type { Translate } from '../../../../packages/market-ui/src/index.js'

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
  it.each([
    ['en', 'en'],
    ['en-US', 'en'],
    ['zh', 'zh'],
    ['ja', 'zh'],
    [undefined, 'zh']
  ])('resolves the target independently for %s', (preference, target) => {
    expect(resolveTranslationTarget(preference)).toBe(target)
  })

  it('hides cached descriptions immediately on off and restores them on on', async () => {
    const source = form({ translationEnabled: true })
    releases.push(bindTranslationEnabled(source))
    const t: Translate = key => (key === 'localeProbeLang' ? '中文' : key)
    const Probe = () => h('output', null, useDisplayText('读取文件', 'Read files', t))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(h(Probe)))
    expect(container.textContent).toBe('读取文件')
    await act(async () => source.update({ translationEnabled: false }))
    expect(container.textContent).toBe('Read files')
    await act(async () => source.update({ translationEnabled: true }))
    expect(container.textContent).toBe('读取文件')
  })

  it('revalidates a mounted panel on preference and language changes, not unrelated renders', async () => {
    const source = form({ translationEnabled: false })
    releases.push(bindTranslationEnabled(source))
    const refresh = vi.fn()
    const Probe = ({ language }: { language: string }) => {
      useTranslationRefresh(key => (key === 'localeProbeLang' ? language : key), refresh)
      return null
    }
    container = document.createElement('div')
    root = createRoot(container)
    await act(async () => root!.render(h(Probe, { language: 'English' })))
    expect(refresh).not.toHaveBeenCalled()
    await act(async () => source.update({ translationEnabled: true }))
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => root!.render(h(Probe, { language: '中文' })))
    expect(refresh).toHaveBeenCalledTimes(2)
    await act(async () => root!.render(h(Probe, { language: '中文' })))
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('holds the pre-answer default until the host answers and resolves the section after', () => {
    // No binding at all is the pre-answer state: the declared default withholds
    // the control rather than flashing it.
    expect(translationEnabled.getSnapshot()).toBe(MARKET_SETTINGS_DEFAULTS.translationEnabled)
    const source = form()
    releases.push(bindTranslationEnabled(source))
    // The binding is in place, but the form has not answered: an absent value is
    // not yet a section the document deliberately left open, so the switch holds
    // the declared default.
    expect(translationEnabled.getSnapshot()).toBe(true)
    // The host answers with a section that says nothing about the field, so the
    // plugin default decides it.
    source.update({})
    expect(translationEnabled.getSnapshot()).toBe(true)
    source.update({ translationEnabled: false })
    expect(translationEnabled.getSnapshot()).toBe(false)
    source.update({ translationEnabled: true })
    expect(translationEnabled.getSnapshot()).toBe(true)
  })

  it('notifies only when the effective boolean changes', () => {
    const source = form({ translationEnabled: true })
    releases.push(bindTranslationEnabled(source))
    const changed = vi.fn()
    releases.push(translationEnabled.subscribe(changed))
    source.update({ translationEnabled: true })
    source.update({ translationEnabled: true })
    expect(changed).not.toHaveBeenCalled()
    source.update({ translationEnabled: false })
    expect(changed).toHaveBeenCalledOnce()
    // The section now says nothing, so the plugin default answers: on, a change
    // back from the stored off.
    source.update({})
    expect(changed).toHaveBeenCalledTimes(2)
    expect(translationEnabled.getSnapshot()).toBe(true)
  })

  it('keeps subscribers connected across replacement and disposal', () => {
    const first = form({ translationEnabled: false })
    const stopFirst = bindTranslationEnabled(first)
    releases.push(stopFirst)
    const changed = vi.fn()
    releases.push(translationEnabled.subscribe(changed))
    const second = form({ translationEnabled: false })
    const stopSecond = bindTranslationEnabled(second)
    releases.push(stopSecond)
    expect(first.listeners.size).toBe(0)
    expect(second.listeners.size).toBe(1)
    expect(changed).not.toHaveBeenCalled()
    stopFirst()
    first.update({ translationEnabled: true })
    expect(translationEnabled.getSnapshot()).toBe(false)
    stopSecond()
    expect(second.listeners.size).toBe(0)
    // Disposal hands the shared read back to the plugin default instead of
    // leaving the last stored value standing.
    expect(translationEnabled.getSnapshot()).toBe(true)
    expect(changed).toHaveBeenCalledOnce()
    second.update({ translationEnabled: false })
    expect(translationEnabled.getSnapshot()).toBe(true)
  })

  it('turns translation on for a section the document leaves open', () => {
    // The default no longer follows the interface language: an empty section
    // resolves to the plugin default in every interface.
    releases.push(bindTranslationEnabled(form({})))
    expect(translationEnabled.getSnapshot()).toBe(true)
  })

  it('keeps a stored false off', () => {
    releases.push(bindTranslationEnabled(form({ translationEnabled: false })))
    expect(translationEnabled.getSnapshot()).toBe(false)
  })

  it('updates a mounted hook when the host binds late and is re-served', async () => {
    const Probe = () => h('output', null, String(useTranslationEnabled()))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(h(Probe)))
    expect(container.textContent).toBe('true')
    const source = form({ translationEnabled: false })
    let unbind!: () => void
    await act(async () => {
      unbind = bindTranslationEnabled(source)
    })
    releases.push(unbind)
    expect(container.textContent).toBe('false')
    await act(async () => source.update({ translationEnabled: true }))
    expect(container.textContent).toBe('true')
    await act(async () => source.update({ translationEnabled: false }))
    expect(container.textContent).toBe('false')
    await act(async () => unbind())
    expect(container.textContent).toBe('true')
    await act(async () => {
      releases.push(bindTranslationEnabled(source))
    })
    expect(container.textContent).toBe('false')
  })
})
