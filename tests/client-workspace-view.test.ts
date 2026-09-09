// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { useWorkspaceView } from '../src/client/ui/workspace-view.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Tab({ name }: { name: string }) {
  const [view, setView] = useWorkspaceView()
  return h('button', { onClick: () => setView(view === 'grid' ? 'list' : 'grid') }, `${name}:${view}`)
}

describe('workspace display preference', () => {
  it('synchronizes mounted tabs, newly mounted tabs, storage events and persistent storage', async () => {
    const storageWindow = new JSDOM('', { url: 'http://localhost' }).window
    vi.stubGlobal('localStorage', storageWindow.localStorage)
    window.localStorage.setItem('dsh-agent-plugins-market:view', 'list')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(h('div', null, h(Tab, { name: 'skills' }), h(Tab, { name: 'mcp' }))))
      expect(host.textContent).toBe('skills:listmcp:list')
      await act(async () => host.querySelector('button')!.click())
      expect(host.textContent).toBe('skills:gridmcp:grid')
      expect(window.localStorage.getItem('dsh-agent-plugins-market:view')).toBe('grid')
      await act(async () => root.render(h(Tab, { name: 'lsp' })))
      expect(host.textContent).toBe('lsp:grid')
      await act(async () => {
        window.localStorage.setItem('dsh-agent-plugins-market:view', 'list')
        window.dispatchEvent(new StorageEvent('storage', { key: 'dsh-agent-plugins-market:view', newValue: 'list' }))
      })
      expect(host.textContent).toBe('lsp:list')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      window.localStorage.clear()
      vi.unstubAllGlobals()
      storageWindow.close()
    }
  })
})
