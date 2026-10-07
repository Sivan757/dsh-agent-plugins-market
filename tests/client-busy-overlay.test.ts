// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginBusyOperation, busySnapshot, withBusyOperation } from '../packages/market-ui/src/ui/busy-operation.js'
import { BusyOverlay, BUSY_SHOW_DELAY_MS, BUSY_LONG_RUNNING_MS } from '../packages/market-ui/src/ui/BusyOverlay.js'
import { stubTranslate as t } from './helpers/translate.js'
import {
  fetchLspStatus,
  fetchMcpStatus,
  fetchOverview,
  fetchServerConfig,
  fetchSuiteDetail,
  fetchSuiteDocument,
  fetchUserPanel,
  postAction
} from '../packages/market-ui/src/api.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
const releases: Array<() => void> = []
afterEach(async () => {
  await act(async () => {
    releases.splice(0).forEach(end => end())
    root?.unmount()
  })
  root = undefined
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('shared operation overlay', () => {
  it('keeps automatic status polling silent and clears a rejected mutation lease', async () => {
    let complete!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>(resolve => {
            complete = resolve
          })
      )
    )
    try {
      const polling = fetchLspStatus(true)
      expect(busySnapshot()).toHaveLength(0)
      complete(new Response('{}', { status: 200 }))
      await polling
      const mutation = postAction('test', {})
      expect(busySnapshot()).toHaveLength(1)
      expect(busySnapshot()[0]?.blocking).toBe(true)
      const failure = expect(mutation).rejects.toThrow('rejected')
      complete(new Response(JSON.stringify({ ok: false, error: 'rejected' }), { status: 400 }))
      await failure
      expect(busySnapshot()).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it.each([
    ['overview', () => fetchOverview()],
    ['suite detail', () => fetchSuiteDetail('source', 'suite')],
    ['suite document', () => fetchSuiteDocument('source', 'suite', 'skills', 'skill')],
    ['server config', () => fetchServerConfig('mcp', 'server')],
    ['MCP status', () => fetchMcpStatus()],
    ['LSP status', () => fetchLspStatus()],
    ['user panel', () => fetchUserPanel('agents')]
  ] as const)('keeps the %s read lease nonblocking', async (_name, load) => {
    let complete!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>(resolve => {
          complete = resolve
        })
    )
    const request = load()
    try {
      expect(busySnapshot()).toHaveLength(1)
      expect(busySnapshot()[0]?.blocking).toBe(false)
    } finally {
      complete(new Response('{}', { status: 200 }))
      await request
    }
    expect(busySnapshot()).toHaveLength(0)
  })

  it('counts concurrent leases and releases rejected requests without masking their error', async () => {
    let release!: () => void
    const work = withBusyOperation(
      () =>
        new Promise<void>(resolve => {
          release = resolve
        })
    )
    const end = beginBusyOperation()
    releases.push(end)
    expect(busySnapshot()).toHaveLength(2)
    await expect(
      withBusyOperation(async () => {
        throw new Error('failed save')
      })
    ).rejects.toThrow('failed save')
    expect(busySnapshot()).toHaveLength(2)
    release()
    await work
    expect(busySnapshot()).toHaveLength(1)
    end()
    end()
    expect(busySnapshot()).toHaveLength(0)
  })

  it('blocks dialog/backdrop clicks and escape, rotates hints, and restores focus and inert state', async () => {
    vi.useFakeTimers()
    const cleared = vi.spyOn(globalThis, 'clearInterval')
    const scope = document.createElement('div')
    scope.setAttribute('role', 'presentation')
    const backdrop = document.createElement('button')
    scope.append(backdrop)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    scope.append(dialog)
    const button = document.createElement('button')
    dialog.append(button)
    const clicked = vi.fn()
    const escaped = vi.fn()
    button.onclick = clicked
    backdrop.onclick = clicked
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') escaped()
    }
    document.addEventListener('keydown', listener)
    document.body.append(scope)
    button.focus()
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(h(BusyOverlay, { t })))
    let end!: () => void
    await act(async () => {
      end = beginBusyOperation(dialog)
      releases.push(end)
    })
    expect(dialog.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(button)
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    button.click()
    backdrop.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(clicked).not.toHaveBeenCalled()
    expect(escaped).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(BUSY_SHOW_DELAY_MS)
    })
    expect(host.textContent).toContain('busyHintProcessing')
    button.click()
    backdrop.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(clicked).not.toHaveBeenCalled()
    expect(escaped).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(3200)
    })
    expect(host.textContent).toContain('busyHintRefresh')
    await act(async () => end())
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    expect(dialog.hasAttribute('inert')).toBe(false)
    expect(dialog.hasAttribute('aria-busy')).toBe(false)
    expect(document.activeElement).toBe(button)
    button.click()
    expect(clicked).toHaveBeenCalledOnce()
    expect(cleared).toHaveBeenCalled()
    document.removeEventListener('keydown', listener)
  })

  it('says so when a lease outlives the long-running threshold', async () => {
    vi.useFakeTimers()
    const dialog = document.createElement('div')
    document.body.append(dialog)
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(h(BusyOverlay, { t })))
    let end!: () => void
    await act(async () => {
      end = beginBusyOperation(dialog)
      releases.push(end)
    })
    await act(async () => {
      vi.advanceTimersByTime(BUSY_SHOW_DELAY_MS)
    })
    expect(host.querySelector('[data-visible="true"]')).not.toBeNull()
    expect(host.textContent).not.toContain('busyLongRunning')
    await act(async () => {
      vi.advanceTimersByTime(BUSY_LONG_RUNNING_MS)
    })
    expect(host.textContent).toContain('busyLongRunning')
    await act(async () => end())
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
  })

  it.each([80, 199])('keeps a %ims read interactive without painting or moving focus', async duration => {
    vi.useFakeTimers()
    const dialog = document.createElement('div')
    const button = document.createElement('button')
    dialog.append(button)
    document.body.append(dialog)
    button.focus()
    const clicked = vi.fn()
    button.onclick = clicked
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(h(BusyOverlay, { t })))
    let end!: () => void
    await act(async () => {
      end = beginBusyOperation(dialog, { blocking: false })
      releases.push(end)
    })
    expect(dialog.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(button)
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    button.click()
    expect(clicked).toHaveBeenCalledOnce()
    await act(async () => {
      vi.advanceTimersByTime(duration)
      end()
    })
    expect(document.activeElement).toBe(button)
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    await act(async () => vi.advanceTimersByTime(BUSY_LONG_RUNNING_MS))
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([201, 450, 800])('releases a visible %ims operation without a minimum stay or settling delay', async duration => {
    vi.useFakeTimers()
    const dialog = document.createElement('div')
    document.body.append(dialog)
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(h(BusyOverlay, { t })))
    let end!: () => void
    await act(async () => {
      end = beginBusyOperation(dialog)
      releases.push(end)
    })
    await act(async () => vi.advanceTimersByTime(BUSY_SHOW_DELAY_MS))
    expect(host.querySelector('[data-visible="true"]')).not.toBeNull()
    await act(async () => vi.advanceTimersByTime(duration - BUSY_SHOW_DELAY_MS))
    await act(async () => end())
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    expect(dialog.hasAttribute('inert')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps overlapping leases visible until the last release and restarts after an idle gap', async () => {
    vi.useFakeTimers()
    const dialog = document.createElement('div')
    document.body.append(dialog)
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(h(BusyOverlay, { t })))
    let first!: () => void
    let second!: () => void
    await act(async () => {
      first = beginBusyOperation(dialog)
      releases.push(first)
    })
    await act(async () => vi.advanceTimersByTime(BUSY_SHOW_DELAY_MS))
    const mask = host.querySelector('[data-visible="true"]')
    await act(async () => {
      second = beginBusyOperation(dialog)
      releases.push(second)
      first()
    })
    expect(host.querySelector('[data-visible="true"]')).toBe(mask)
    await act(async () => second())
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    await act(async () => vi.advanceTimersByTime(50))
    await act(async () => {
      first = beginBusyOperation(dialog)
      releases.push(first)
    })
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    await act(async () => vi.advanceTimersByTime(BUSY_SHOW_DELAY_MS))
    expect(host.querySelector('[data-visible="true"]')).not.toBeNull()
  })

  it('never paints an overlay for a read, however long it runs', async () => {
    vi.useFakeTimers()
    const target = document.createElement('div')
    document.body.append(target)
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(h(BusyOverlay, { t })))
    let end!: () => void
    await act(async () => {
      end = beginBusyOperation(target, { blocking: false })
      releases.push(end)
    })
    // The panel shows its own loading line, so the overlay stays out of the way
    // no matter how long the read takes.
    await act(async () => vi.advanceTimersByTime(BUSY_SHOW_DELAY_MS + 50))
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    await act(async () => vi.advanceTimersByTime(BUSY_LONG_RUNNING_MS))
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    await act(async () => end())
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retain or refocus a disconnected target after completion', async () => {
    vi.useFakeTimers()
    const target = document.createElement('div')
    const button = document.createElement('button')
    target.append(button)
    document.body.append(target)
    button.focus()
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(h(BusyOverlay, { t })))
    let end!: () => void
    await act(async () => {
      end = beginBusyOperation(target)
      releases.push(end)
    })
    await act(async () => vi.advanceTimersByTime(BUSY_SHOW_DELAY_MS))
    target.remove()
    const replacement = document.createElement('button')
    document.body.append(replacement)
    replacement.focus()
    await act(async () => end())
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    expect(document.activeElement).toBe(replacement)
    expect(target.hasAttribute('inert')).toBe(false)
  })

  it('restores pre-existing attributes on unmount', async () => {
    vi.useFakeTimers()
    const dialog = document.createElement('div')
    dialog.setAttribute('inert', '')
    dialog.setAttribute('aria-busy', 'false')
    document.body.append(dialog)
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(h(BusyOverlay, { t })))
    await act(async () => {
      releases.push(beginBusyOperation(dialog))
    })
    await act(async () => vi.advanceTimersByTime(BUSY_SHOW_DELAY_MS))
    expect(host.querySelector('[data-operation-overlay]')).not.toBeNull()
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    await act(async () => root!.unmount())
    // React schedules an immediate callback while detaching the root.
    vi.advanceTimersByTime(0)
    root = undefined
    // `inert` was already there, so the overlay must leave it in place.
    expect(dialog.hasAttribute('inert')).toBe(true)
    expect(dialog.getAttribute('aria-busy')).toBe('false')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not steal focus or input from a dialog opened during a slow read', async () => {
    vi.useFakeTimers()
    const target = document.createElement('div')
    document.body.append(target)
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(h(BusyOverlay, { t })))
    let end!: () => void
    await act(async () => {
      end = beginBusyOperation(target, { blocking: false })
      releases.push(end)
    })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const button = document.createElement('button')
    dialog.append(button)
    document.body.append(dialog)
    button.focus()
    const clicked = vi.fn()
    const keyed = vi.fn()
    button.onclick = clicked
    button.onkeydown = keyed
    await act(async () => vi.advanceTimersByTime(BUSY_SHOW_DELAY_MS))
    // A read never paints, and never takes focus or input from the dialog.
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    expect(target.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(button)
    button.click()
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(clicked).toHaveBeenCalledOnce()
    expect(keyed).toHaveBeenCalledOnce()
    await act(async () => end())
    expect(document.activeElement).toBe(button)
  })

  it('keeps a mutation guarded when a concurrent read targets another panel', async () => {
    vi.useFakeTimers()
    const saving = document.createElement('div')
    const reading = document.createElement('div')
    const button = document.createElement('button')
    saving.append(button)
    document.body.append(saving, reading)
    const clicked = vi.fn()
    button.onclick = clicked
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(h(BusyOverlay, { t })))
    let end!: () => void
    await act(async () => {
      end = beginBusyOperation(saving)
      releases.push(end, beginBusyOperation(reading, { blocking: false }))
    })
    button.click()
    expect(clicked).not.toHaveBeenCalled()
    await act(async () => end())
    button.click()
    expect(clicked).toHaveBeenCalledOnce()
  })
})
