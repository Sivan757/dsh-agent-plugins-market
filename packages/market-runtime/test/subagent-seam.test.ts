import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { drainContinuableChildIds, startContinuableChild } from '../../../packages/market-runtime/src/runtime/agents/subagent-seam.js'

const signal = new AbortController().signal
const parent = { id: 'lead' } as never
/** The host brands session ids; the seam only forwards them, so the test passes plain names. */
const childIds = (...names: string[]): SessionId[] => names as unknown as SessionId[]
const input = { provider: 'spawn', label: 'reviewer', request: {}, signal }

describe('subagent seam across host release lines', () => {
  it('starts through startContinuable when the older member is present', async () => {
    const startContinuable = vi.fn(async () => ({ childId: 'child-1', messageId: 'message-1' }))
    const startActivation = vi.fn(async () => ({ childId: 'child-2' }))

    await expect(startContinuableChild({ startContinuable, startActivation }, input)).resolves.toEqual({ childId: 'child-1', messageId: 'message-1' })
    expect(startActivation).not.toHaveBeenCalled()
  })

  it('starts through startActivation on the newer line and asks for parent delivery', async () => {
    const startActivation = vi.fn(async () => ({ childId: 'child-2' }))

    await expect(startContinuableChild({ startActivation }, input)).resolves.toEqual({ childId: 'child-2' })
    expect(startActivation).toHaveBeenCalledWith({ ...input, delivery: 'parent' })
  })

  it('refuses a host that exposes neither start member', async () => {
    await expect(startContinuableChild({}, input)).rejects.toThrow('neither startContinuable nor startActivation')
  })

  it('drains through the member the live release exposes', async () => {
    const drainContinuableChildren = vi.fn(async () => {})
    const drainChildren = vi.fn(async () => {})

    await drainContinuableChildIds({ drainContinuableChildren, drainChildren }, parent, childIds('child-1'))
    expect(drainContinuableChildren).toHaveBeenCalledWith(parent, childIds('child-1'))
    expect(drainChildren).not.toHaveBeenCalled()

    await drainContinuableChildIds({ drainChildren }, parent, childIds('child-2'))
    expect(drainChildren).toHaveBeenCalledWith(parent, childIds('child-2'))
  })

  it('refuses a host that exposes neither drain member', async () => {
    await expect(drainContinuableChildIds({}, parent, childIds())).rejects.toThrow('neither drainContinuableChildren nor drainChildren')
  })
})
