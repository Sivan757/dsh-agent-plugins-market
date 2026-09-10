// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/PluginWorkspace.js', () => ({
  PluginWorkspace: () => null
}))

import { LEGACY_PAGE_MODE_SURFACE_EVENT, mountLegacyPageMode } from '../src/client/page-mode.js'

describe('legacy market page mode', () => {
  const disposers: Array<() => void> = []
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-dsh-agent-plugins-market-page')
  })

  it('mounts a localized page entry when the settings surface is absent', async () => {
    document.body.innerHTML = [
      '<div data-pane="sidebar"><div><button class="newSession">New session</button></div></div>',
      '<div data-pane="conversation"><div data-conversation-body="true">Conversation</div></div>'
    ].join('')
    let settingsAvailable = false
    let nav = 'Agent Plugins 市场'
    let onLocale: (() => void) | undefined
    const dispose = mountLegacyPageMode({
      t: () => nav,
      isSettingsSurfaceAvailable: () => settingsAvailable,
      subscribeLocale: listener => {
        onLocale = listener
        return () => {
          onLocale = undefined
        }
      }
    })
    disposers.push(dispose)
    await new Promise(resolve => setTimeout(resolve, 0))

    const entry = document.querySelector<HTMLButtonElement>('[data-dsh-agent-plugins-market-entry]')
    expect(entry?.textContent).toBe('Agent Plugins 市场')
    expect(document.querySelector('[data-dsh-agent-plugins-market-page-view]')).toBeNull()

    nav = 'Agent Plugins Market'
    onLocale?.()
    expect(entry?.textContent).toBe('Agent Plugins Market')

    entry?.click()
    expect(document.documentElement.hasAttribute('data-dsh-agent-plugins-market-page')).toBe(true)
    expect(document.querySelector('[data-dsh-agent-plugins-market-page-view]')).not.toBeNull()

    document.dispatchEvent(new CustomEvent('dsh-panel-activate', { detail: 'another-panel' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(document.querySelector('[data-dsh-agent-plugins-market-page-view]')).toBeNull()
    entry?.click()

    settingsAvailable = true
    document.dispatchEvent(new Event(LEGACY_PAGE_MODE_SURFACE_EVENT))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(document.documentElement.hasAttribute('data-dsh-agent-plugins-market-page')).toBe(false)
    expect(document.querySelector('[data-dsh-agent-plugins-market-entry]')).toBeNull()

    dispose()
  })

  it('does not compete with other plugins for the position after the new session button', async () => {
    document.body.innerHTML = [
      '<div data-pane="sidebar"><div><button class="newSession">New session</button></div></div>',
      '<div data-pane="conversation">Conversation</div>'
    ].join('')
    const dispose = mountLegacyPageMode({ t: key => key, isSettingsSurfaceAvailable: () => false })
    let otherObserver: MutationObserver | undefined
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      const anchor = document.querySelector('.newSession')!
      const entry = document.querySelector('[data-dsh-agent-plugins-market-entry]')!
      const otherEntry = document.createElement('button')
      let repositionCount = 0
      otherObserver = new MutationObserver(() => {
        if (anchor.nextSibling === otherEntry) return
        repositionCount += 1
        // Bound a competing adapter so a regression fails instead of hanging.
        if (repositionCount === 5) otherObserver?.disconnect()
        anchor.insertAdjacentElement('afterend', otherEntry)
      })
      otherObserver.observe(anchor.parentElement!, { childList: true })
      anchor.insertAdjacentElement('afterend', otherEntry)
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(anchor.nextSibling).toBe(otherEntry)
      expect(otherEntry.nextSibling).toBe(entry)
      expect(repositionCount).toBe(0)
      expect(document.querySelector('[data-dsh-agent-plugins-market-page-view]')).toBeNull()

      entry.remove()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(entry.isConnected).toBe(true)
    } finally {
      otherObserver?.disconnect()
      dispose()
    }
  })
})
