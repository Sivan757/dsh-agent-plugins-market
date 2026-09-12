// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginBusyOperation, busySnapshot, withBusyOperation } from '../src/client/ui/busy-operation.js'
import { BusyOverlay, BUSY_SHOW_DELAY_MS, BUSY_MIN_VISIBLE_MS, BUSY_SETTLE_MS } from '../src/client/ui/BusyOverlay.js'
import { stubTranslate as t } from './helpers/translate.js'
import { fetchLspStatus, postAction } from '../src/client/api.js'

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
      const failure = expect(mutation).rejects.toThrow('rejected')
      complete(new Response(JSON.stringify({ ok: false, error: 'rejected' }), { status: 400 }))
      await failure
      expect(busySnapshot()).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
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
    expect(dialog.hasAttribute('inert')).toBe(true)
    expect(host.textContent).not.toContain('busyHintProcessing')
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
    await act(async () => {
      vi.advanceTimersByTime(BUSY_SETTLE_MS)
    })
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    expect(dialog.hasAttribute('inert')).toBe(false)
    expect(dialog.hasAttribute('aria-busy')).toBe(false)
    expect(document.activeElement).toBe(button)
    button.click()
    expect(clicked).toHaveBeenCalledOnce()
    expect(cleared).toHaveBeenCalled()
    document.removeEventListener('keydown', listener)
  })

  it('never paints quick requests and holds a visible mask across a short request gap', async () => {
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
    expect(dialog.hasAttribute('inert')).toBe(true)
    await act(async () => {
      vi.advanceTimersByTime(80)
      end()
    })
    expect(host.querySelector('[data-visible="true"]')).toBeNull()
    expect(dialog.hasAttribute('inert')).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()

    await act(async () => {
      end = beginBusyOperation(dialog)
      releases.push(end)
    })
    await act(async () => {
      vi.advanceTimersByTime(BUSY_SHOW_DELAY_MS)
    })
    const mask = host.querySelector('[data-visible="true"]')
    expect(mask).not.toBeNull()
    await act(async () => end())
    await act(async () => {
      vi.advanceTimersByTime(50)
    })
    await act(async () => {
      end = beginBusyOperation(dialog)
      releases.push(end)
    })
    expect(host.querySelector('[data-visible="true"]')).toBe(mask)
    await act(async () => {
      vi.advanceTimersByTime(BUSY_MIN_VISIBLE_MS)
      end()
    })
    expect(dialog.hasAttribute('inert')).toBe(true)
    await act(async () => {
      vi.advanceTimersByTime(BUSY_SETTLE_MS)
    })
    expect(host.querySelector('[data-operation-overlay]')).toBeNull()
    expect(dialog.hasAttribute('inert')).toBe(false)
  })
})
