import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { drainContinuableChildIds, startContinuableChild, startOneShotChild } from '../../../packages/market-runtime/src/runtime/agents/subagent-seam.js'

const signal = new AbortController().signal
const parent = { id: 'lead' } as never
/** The host brands session ids; the seam only forwards them, so the test passes plain names. */
const childIds = (...names: string[]): SessionId[] => names as unknown as SessionId[]
const input = { provider: 'spawn', label: 'reviewer', request: {}, signal }

describe('subagent seam across host release lines', () => {
  it('starts through startContinuable when the older member is present', async () => {
    const startContinuable = vi.fn(async () => ({ childId: 'child-1', messageId: 'message-1' }))
    const startActivation = vi.fn(async () => ({ childId: 'child-2', result: Promise.resolve({ output: [], stopReason: 'completed' }), dispose: async () => {} }))

    await expect(startContinuableChild({ startContinuable, startActivation }, input)).resolves.toEqual({ childId: 'child-1', messageId: 'message-1' })
    expect(startActivation).not.toHaveBeenCalled()
  })

  it('starts through startActivation on the newer line and asks for parent delivery', async () => {
    const startActivation = vi.fn(async () => ({ childId: 'child-2', result: Promise.resolve({ output: [], stopReason: 'completed' }), dispose: async () => {} }))

    await expect(startContinuableChild({ startActivation }, input)).resolves.toMatchObject({ childId: 'child-2' })
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

describe('one-shot foreground seam across host release lines', () => {
  const run = { output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }

  it('starts one foreground child through startActivation and asks for caller delivery', async () => {
    const dispose = vi.fn(async () => {})
    const startActivation = vi.fn(async () => ({ childId: 'child-2', result: Promise.resolve(run), dispose }))

    const started = await startOneShotChild({ startActivation }, { ...input, request: { prompt: [] } })
    expect(startActivation).toHaveBeenCalledWith({ provider: 'spawn', label: 'reviewer', request: { prompt: [] }, signal, delivery: 'caller' })
    // The activation names the child; the foreground result keeps the run-id meaning.
    expect(started.runId).toBe('child-2')
    await expect(started.result).resolves.toEqual(run)
    await started.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('starts one foreground child through the older start member and never calls startActivation', async () => {
    const dispose = vi.fn(async () => {})
    const startActivation = vi.fn()
    const start = vi.fn(async () => ({ id: 'run-1', result: Promise.resolve(run), dispose }))

    const started = await startOneShotChild({ start, startActivation }, { ...input, request: { prompt: [] } })
    // The older member takes the cancellation signal inside its request object.
    expect(start).toHaveBeenCalledWith('spawn', { prompt: [], signal })
    expect(startActivation).not.toHaveBeenCalled()
    expect(started.runId).toBe('run-1')
    await expect(started.result).resolves.toEqual(run)
    await started.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('prefers the older start member when the host exposes both', async () => {
    const start = vi.fn(async () => ({ id: 'run-1', result: Promise.resolve(run), dispose: async () => {} }))
    const startActivation = vi.fn(async () => ({ childId: 'child-2', result: Promise.resolve(run), dispose: async () => {} }))

    await expect(startOneShotChild({ start, startActivation }, input)).resolves.toMatchObject({ runId: 'run-1' })
    expect(startActivation).not.toHaveBeenCalled()
  })

  it('refuses a host that exposes neither one-shot start member', async () => {
    await expect(startOneShotChild({}, input)).rejects.toThrow('neither start nor startActivation')
  })
})
