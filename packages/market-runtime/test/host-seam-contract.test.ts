/**
 * Contract between this plugin's subagent seam and the installed host.
 *
 * The seam module is the only place that names a host subagent member, and its
 * table lists every spelling a host release may use. This test reads the
 * published host prototype, not a hand-written fixture, so a release that
 * removes a member the plugin drives fails here instead of in a user session.
 */
import { describe, expect, it } from 'vitest'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import {
  SEAM_MEMBER_ALTERNATIVES,
  drainContinuableChildIds,
  registerSubagentProvider,
  startContinuableChild,
  startOneShotChild,
  type SeamOperation
} from '../../../packages/market-runtime/src/runtime/agents/subagent-seam.js'

const members = new Set(Object.getOwnPropertyNames(SubagentRuntime.prototype))
const operations = Object.keys(SEAM_MEMBER_ALTERNATIVES) as SeamOperation[]
/**
 * One adapter per table operation, named the way production names it.
 *
 * The `satisfies` is this test's own assertion: `tsconfig.test.json` runs under
 * `pnpm run typecheck`, so a `SeamOperation` added to the table without an
 * adapter here fails the gate rather than shipping a seam that cannot dispatch.
 */
const adapters = {
  oneShotChild: startOneShotChild,
  continuableChild: startContinuableChild,
  drainChildren: drainContinuableChildIds,
  registerProvider: registerSubagentProvider
} satisfies Record<SeamOperation, unknown>
const signal = new AbortController().signal
const input = { provider: 'spawn', label: 'reviewer', request: {}, signal }

describe('host subagent member contract', () => {
  it('resolves every seam operation through at least one spelling on the installed host', () => {
    const unresolved = operations.filter(operation => !SEAM_MEMBER_ALTERNATIVES[operation].some(name => members.has(name)))
    expect(unresolved).toEqual([])
  })

  it('drives no member the installed host does not publish', () => {
    // Every spelling in the table is a name a real host line published: the
    // installed line or the older line this plugin still supports. A name the
    // host never had would make a guard skip the operation it was written for.
    const older = new Set(['start', 'startContinuable', 'drainContinuableChildren'])
    const published = operations.flatMap(operation => SEAM_MEMBER_ALTERNATIVES[operation]).filter(name => !members.has(name) && !older.has(name))
    expect(published).toEqual([])
  })

  it('covers every table operation with one adapter', () => {
    // A runtime twin of the `satisfies` above, so the pairing still holds if the
    // map is ever typed more loosely.
    expect(Object.keys(adapters).sort()).toEqual([...operations].sort())
  })

  it('refuses a host that lacks every spelling of a driven operation', async () => {
    // A bare object is the shape a host missing one surface has. Every adapter
    // must refuse by name rather than dereference undefined.
    await expect(startContinuableChild({}, input)).rejects.toThrow('the host subagent service exposes no startContinuable or startActivation member')
    await expect(startOneShotChild({}, input)).rejects.toThrow('the host subagent service exposes no start or startActivation member')
    await expect(drainContinuableChildIds({}, {} as never, [])).rejects.toThrow('the host subagent service exposes no drainContinuableChildren or drainChildren member')
    expect(() => registerSubagentProvider({}, { name: 'x', capabilities: {}, inheritsParentContext: false } as never)).toThrow(
      'the host subagent service exposes no registerProvider'
    )
  })
})
