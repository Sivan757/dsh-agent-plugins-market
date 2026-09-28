import { describe, expect, it } from 'vitest'
import { createLatestRequestGuard } from '../src/client/features/market/suite-detail-resource.js'

describe('suite detail request guard', () => {
  it('marks only the latest request as current', () => {
    const guard = createLatestRequestGuard()
    const first = guard.next()
    const second = guard.next()

    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
    guard.invalidate()
    expect(guard.isCurrent(second)).toBe(false)
  })
})
