// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const KEY = 'dsh-agent-plugins-market:view'

describe('workspace display preference', () => {
  it('synchronizes mounted tabs, newly mounted tabs, and the persisted value', async () => {
    vi.resetModules()
    const storageWindow = new JSDOM('', { url: 'http://localhost' }).window
    vi.stubGlobal('localStorage', storageWindow.localStorage)
    window.localStorage.setItem(KEY, JSON.stringify('list'))
    const { useWorkspaceView } = await import('../src/client/ui/workspace-view.js')
    function Tab({ name }: { name: string }) {
      const [view, setView] = useWorkspaceView()
      return h(
        'button',
        {
          onClick: () => {
            setView(view === 'grid' ? 'list' : 'grid')
          }
        },
        `${name}:${view}`
      )
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(h('div', null, h(Tab, { name: 'skills' }), h(Tab, { name: 'mcp' }))))
      expect(host.textContent).toBe('skills:listmcp:list')
      await act(async () => host.querySelector('button')!.click())
      expect(host.textContent).toBe('skills:gridmcp:grid')
      expect(window.localStorage.getItem(KEY)).toBe(JSON.stringify('grid'))
      await act(async () => root.render(h(Tab, { name: 'lsp' })))
      expect(host.textContent).toBe('lsp:grid')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      window.localStorage.clear()
      vi.unstubAllGlobals()
      storageWindow.close()
    }
  })

  it('reads a stored value the preference does not accept as the default', async () => {
    vi.resetModules()
    const storageWindow = new JSDOM('', { url: 'http://localhost' }).window
    vi.stubGlobal('localStorage', storageWindow.localStorage)
    window.localStorage.setItem(KEY, JSON.stringify('sideways'))
    const { useWorkspaceView } = await import('../src/client/ui/workspace-view.js')
    function Tab() {
      const [view, setView] = useWorkspaceView()
      return h(
        'span',
        {
          onClick: () => {
            setView('list')
          }
        },
        view
      )
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(h(Tab)))
      expect(host.textContent).toBe('grid')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      window.localStorage.clear()
      vi.unstubAllGlobals()
      storageWindow.close()
    }
  })
})
