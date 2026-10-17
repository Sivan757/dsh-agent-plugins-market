import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SkillRegistry, { isModelInvocable, isUserInvocable, type SkillCandidate, type SkillDefinition } from '@deepseek-ai/dsh-skill'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})

function provider(name: string, enabled: boolean, rank: number) {
  const candidate: SkillCandidate = {
    name: 'foo',
    description: name,
    source: 'user-dsh',
    provider: name,
    invocation: { modelInvocable: enabled, userInvocable: enabled },
    rank,
    locator: { owner: name }
  }
  const definition: SkillDefinition = { ...candidate, content: name + ' body' }
  const get = vi.fn(async (_candidate: SkillCandidate): Promise<SkillDefinition | undefined> => definition)
  return { candidate, definition, get, registration: { name, list: async () => [candidate], get } }
}

describe('native skill same-name shadowing on the installed SkillRegistry', () => {
  it.each([true, false])('keeps a scoped winner when global invocation is %s and scoped invocation is opposite', async globalEnabled => {
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(SkillRegistry)
    const first = {}
    const second = {}
    const scoped = createScope(ctx, first)
    const sibling = createScope(ctx, second)
    cleanups.push(
      () => scoped.dispose(),
      () => sibling.dispose()
    )
    const global = provider('global-provider', globalEnabled, 1)
    const local = provider('scoped-provider', !globalEnabled, 999)
    ctx.skills.registerProvider(() => global.registration)
    await scoped.ctx.inject(['skills'], inner => {
      inner.skills.registerProvider(() => local.registration)
    })

    const snapshot = await ctx.skills.snapshot({ scope: first })
    expect(snapshot.complete).toBe(true)
    expect(snapshot.skills).toHaveLength(1)
    expect(snapshot.skills[0]).toMatchObject({ name: 'foo', provider: 'scoped-provider', invocation: local.candidate.invocation })
    expect(snapshot.skills.filter(isModelInvocable)).toHaveLength(globalEnabled ? 0 : 1)
    expect(snapshot.skills.filter(isUserInvocable)).toHaveLength(globalEnabled ? 0 : 1)
    expect(await ctx.skills.get('foo', { scope: first })).toEqual(local.definition)
    expect(local.get).toHaveBeenCalledWith(local.candidate, expect.objectContaining({ scope: first }))
    expect(global.get).not.toHaveBeenCalled()

    // A missing scoped body must not revive the shadowed global candidate.
    local.get.mockResolvedValueOnce(undefined)
    expect(await ctx.skills.get('foo', { scope: first })).toBeUndefined()
    expect(global.get).not.toHaveBeenCalled()

    const other = await ctx.skills.snapshot({ scope: second })
    expect(other.skills).toHaveLength(1)
    expect(other.skills[0]).toMatchObject({ provider: 'global-provider', invocation: global.candidate.invocation })
    expect(other.skills.filter(isModelInvocable)).toHaveLength(globalEnabled ? 1 : 0)
    expect(other.skills.filter(isUserInvocable)).toHaveLength(globalEnabled ? 1 : 0)
    expect(await ctx.skills.get('foo', { scope: second })).toEqual(global.definition)
    expect(global.get).toHaveBeenCalledTimes(1)
    expect((await ctx.skills.snapshot()).skills).toEqual(other.skills)
  })
})
