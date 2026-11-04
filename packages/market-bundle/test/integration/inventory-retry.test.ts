import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INVENTORY_RETRY,
  INVENTORY_RETRY_BASE_MS,
  INVENTORY_RETRY_MAX_MS,
  inventoryRetryDelay,
  resolveInventoryRetry
} from '../../../../packages/market-runtime/src/runtime/host/inventory-retry.js'

describe('inventory retry schedule', () => {
  it('keeps the documented defaults when nothing is configured', () => {
    const policy = resolveInventoryRetry(undefined)
    expect(policy).toEqual({ baseMs: 200, maxMs: 60_000 })
    expect(INVENTORY_RETRY_BASE_MS).toBe(200)
    expect(INVENTORY_RETRY_MAX_MS).toBe(60_000)
    expect(DEFAULT_INVENTORY_RETRY).toEqual(policy)
  })

  it('doubles the delay and settles at the ceiling instead of stopping', () => {
    const policy = resolveInventoryRetry({ baseMs: 100, maxMs: 800 })
    expect([0, 1, 2, 3, 4, 5, 6, 60].map(attempt => inventoryRetryDelay(policy, attempt))).toEqual([100, 200, 400, 800, 800, 800, 800, 800])
    // The schedule is unbounded in attempts: the ceiling is a steady state, not
    // a limit, so a session that recovers much later is still retried.
    expect(inventoryRetryDelay(policy, 10_000)).toBe(800)
  })

  it('never returns a delay below the base or above the ceiling', () => {
    const policy = resolveInventoryRetry({ baseMs: 50, maxMs: 400 })
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const delay = inventoryRetryDelay(policy, attempt)
      expect(delay).toBeGreaterThanOrEqual(policy.baseMs)
      expect(delay).toBeLessThanOrEqual(policy.maxMs)
    }
  })

  it('refuses a value that would hot-loop or never run', () => {
    for (const value of [{ baseMs: 0 }, { baseMs: -1 }, { maxMs: 0 }, { maxMs: Number.NaN }, { baseMs: Number.POSITIVE_INFINITY }]) {
      expect(() => resolveInventoryRetry(value)).toThrow('must be a positive finite number of milliseconds')
    }
    expect(() => resolveInventoryRetry({ baseMs: 500, maxMs: 100 })).toThrow('inventoryRetry.baseMs must not exceed inventoryRetry.maxMs')
  })

  it('is frozen so a caller cannot retune a running schedule', () => {
    const policy = resolveInventoryRetry({ baseMs: 10, maxMs: 20 })
    expect(Object.isFrozen(policy)).toBe(true)
  })
})
