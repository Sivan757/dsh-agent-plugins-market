// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { bindAgentPresetsEnabled, agentPresetsEnabled, useAgentPresetsEnabled } from '../packages/market-ui/src/ui/agent-presets-enabled.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function form(initial?: { agentPresetsEnabled?: boolean }) {
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
    update(next?: { agentPresetsEnabled?: boolean }) {
      value = next
      for (const listener of listeners) listener()
    },
    listeners
  }
}

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function Probe(): { enabled: boolean } {
  const enabled = useAgentPresetsEnabled()
  return { enabled }
}

describe('the agent presets experimental gate', () => {
  it('reads off before the form answers and follows a flip without remount', async () => {
    const f = form()
    const seen: boolean[] = []
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    function Capture(): null {
      const probe = Probe()
      seen.push(probe.enabled)
      return null
    }
    const unbind = bindAgentPresetsEnabled(f)
    await act(async () => root!.render(h(Capture)))
    expect(agentPresetsEnabled.getSnapshot()).toBe(false)
    await act(async () => f.update({ agentPresetsEnabled: true }))
    expect(agentPresetsEnabled.getSnapshot()).toBe(true)
    expect(seen[seen.length - 1]).toBe(true)
    await act(async () => f.update({ agentPresetsEnabled: false }))
    expect(agentPresetsEnabled.getSnapshot()).toBe(false)
    unbind()
  })

  it('answers the stored value when the form has one, off when the document is empty', async () => {
    const f = form({ agentPresetsEnabled: true })
    const unbind = bindAgentPresetsEnabled(f)
    expect(agentPresetsEnabled.getSnapshot()).toBe(true)
    unbind()
    const empty = form()
    const unbind2 = bindAgentPresetsEnabled(empty)
    expect(agentPresetsEnabled.getSnapshot()).toBe(false)
    unbind2()
  })
})
