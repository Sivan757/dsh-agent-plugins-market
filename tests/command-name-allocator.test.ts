import { describe, expect, it } from 'vitest'
import {
  CommandNameRegistry,
  MAX_COMMAND_NAME_ATTEMPTS,
  createCommandNameAllocator,
  isDuplicateCommandName,
  registerWithAllocatedName
} from '../src/runtime/host/command-name-allocator.js'

describe('command name allocation', () => {
  it('answers the preferred name while it is free', () => {
    const allocator = createCommandNameAllocator(() => new Set())
    expect(allocator.claim('compact')).toBe('compact')
    expect(allocator.claim('review')).toBe('review')
  })

  it('appends -1 to the first conflict and counts up from there', () => {
    const allocator = createCommandNameAllocator(() => new Set())
    // The first conflict is compact-1, never compact-0.
    expect([allocator.claim('compact'), allocator.claim('compact'), allocator.claim('compact'), allocator.claim('compact')]).toEqual([
      'compact',
      'compact-1',
      'compact-2',
      'compact-3'
    ])
  })

  it('keeps each preferred name in its own suffix sequence', () => {
    const allocator = createCommandNameAllocator(() => new Set())
    allocator.claim('compact')
    expect(allocator.claim('review')).toBe('review')
    expect(allocator.claim('compact')).toBe('compact-1')
    expect(allocator.claim('review')).toBe('review-1')
  })

  it('honours names occupied outside the allocator', () => {
    const taken = new Set(['compact'])
    const allocator = createCommandNameAllocator(() => taken)
    expect(allocator.claim('compact')).toBe('compact-1')
    taken.add('compact-1')
    expect(allocator.claim('compact')).toBe('compact-2')
  })

  it('skips an externally occupied name that already carries a suffix', () => {
    const allocator = createCommandNameAllocator(() => new Set(['compact', 'compact-2']))
    expect(allocator.claim('compact')).toBe('compact-1')
    expect(allocator.claim('compact')).toBe('compact-3')
  })

  it('reuses a released name', () => {
    const allocator = createCommandNameAllocator(() => new Set())
    expect(allocator.claim('compact')).toBe('compact')
    expect(allocator.claim('compact')).toBe('compact-1')
    allocator.release('compact-1')
    expect(allocator.claim('compact')).toBe('compact-1')
    allocator.release('compact')
    expect(allocator.claim('compact')).toBe('compact')
  })

  it('ignores the release of a name it never issued', () => {
    const allocator = createCommandNameAllocator(() => new Set())
    allocator.release('compact')
    expect(allocator.claim('compact')).toBe('compact')
  })

  it('refuses to allocate past the attempt ceiling', () => {
    const allocator = createCommandNameAllocator(() => new Set())
    // The preferred name plus one claim per suffix.
    for (let attempt = 0; attempt <= MAX_COMMAND_NAME_ATTEMPTS; attempt += 1) allocator.claim('compact')
    expect(() => allocator.claim('compact')).toThrow(`command name "compact" has no free suffix within ${MAX_COMMAND_NAME_ATTEMPTS} attempts`)
  })
})

describe('duplicate registration detection', () => {
  it('recognises both host layers', () => {
    // CommandRuntime.register renders one sentence per layer; both open with
    // the same clause, so a rename retry answers either.
    expect(
      isDuplicateCommandName(new Error('command "compact" is already registered (for a per-agent variant, mount a command-injected plugin under that agent\'s `agent.ctx`)'))
    ).toBe(true)
    expect(isDuplicateCommandName(new Error('command "compact" is already registered in this scope'))).toBe(true)
  })

  it('leaves every other failure alone', () => {
    // A name that is not the reason must not be retried as if it were: the
    // retry would hide the real failure behind a renamed registration.
    expect(isDuplicateCommandName(new Error('command name "Compact" must match /^[a-z][a-z0-9_-]*$/u'))).toBe(false)
    expect(isDuplicateCommandName(new Error('command "review" description must not be empty'))).toBe(false)
    expect(isDuplicateCommandName(new Error('ctx.commands is not available in this profile'))).toBe(false)
    expect(isDuplicateCommandName(new Error('command "review" handler must be a function'))).toBe(false)
    expect(isDuplicateCommandName(undefined)).toBe(false)
    expect(isDuplicateCommandName('already registered')).toBe(false)
  })
})

describe('command name registry', () => {
  it('tracks claimed names until they are forgotten', () => {
    const registry = new CommandNameRegistry()
    expect(registry.taken().size).toBe(0)
    expect(registry.claim('compact')).toBe('compact')
    expect([...registry.taken()]).toEqual(['compact'])
    registry.forget('compact')
    expect(registry.taken().size).toBe(0)
  })

  it('keeps a refused name occupied without a registration', () => {
    const registry = new CommandNameRegistry()
    registry.refuse('compact')
    expect([...registry.taken()]).toEqual(['compact'])
    // Forgetting the registration frees the refusal with it.
    registry.forget('compact')
    expect(registry.taken().size).toBe(0)
  })

  it('hands out the next suffix of a refused name and never re-issues it', () => {
    const registry = new CommandNameRegistry()
    expect(registry.claim('compact')).toBe('compact')
    registry.refuse('compact')
    expect(registry.claim('compact')).toBe('compact-1')
    registry.refuse('compact-1')
    expect(registry.claim('compact')).toBe('compact-2')
    expect([...registry.taken()]).toEqual(['compact', 'compact-1', 'compact-2'])
  })

  it('reports each held name once', () => {
    const registry = new CommandNameRegistry()
    registry.claim('compact')
    registry.refuse('compact')
    expect([...registry.taken()]).toEqual(['compact'])
  })
})

/** The host registry's own refusal, thrown for a name its layer already holds. */
function refuseRegistered(name: string, scope = false): Error {
  return new Error(
    scope
      ? `command "${name}" is already registered in this scope`
      : `command "${name}" is already registered (for a per-agent variant, mount a command-injected plugin under that agent's \`agent.ctx\`)`
  )
}

describe('registration under an allocated name', () => {
  it('registers the preferred name when nothing holds it', () => {
    const names = new CommandNameRegistry()
    const result = registerWithAllocatedName(names, 'review', name => `disposer:${name}`)
    expect(result).toEqual({ kind: 'registered', name: 'review', disposer: 'disposer:review' })
    expect([...names.taken()]).toEqual(['review'])
  })

  it('renames past a name the host refuses, first conflict to -1', () => {
    const names = new CommandNameRegistry()
    // A host built-in such as /compact is invisible to us until it refuses.
    const host = new Set(['compact'])
    const result = registerWithAllocatedName(names, 'compact', name => {
      if (host.has(name)) throw refuseRegistered(name)
      host.add(name)
      return 'disposer'
    })
    expect(result).toEqual({ kind: 'registered', name: 'compact-1', disposer: 'disposer' })
    expect([...names.taken()]).toEqual(['compact', 'compact-1'])
  })

  it('counts up while the host keeps refusing', () => {
    const names = new CommandNameRegistry()
    const host = new Set(['compact', 'compact-1', 'compact-2'])
    const result = registerWithAllocatedName(names, 'compact', name => {
      if (host.has(name)) throw refuseRegistered(name)
      host.add(name)
      return 'disposer'
    })
    expect(result).toMatchObject({ kind: 'registered', name: 'compact-3' })
  })

  it('does not retry a failure that is not a name collision', () => {
    const names = new CommandNameRegistry()
    const attempted: string[] = []
    const result = registerWithAllocatedName(names, 'review', name => {
      attempted.push(name)
      throw new Error(`command "${name}" description must not be empty`)
    })
    // One attempt only: renaming around a malformed definition would report a
    // rename instead of the bug that caused it.
    expect(attempted).toEqual(['review'])
    expect(result.kind).toBe('failed')
    // The name never landed, so it stays free.
    expect([...names.taken()]).toEqual([])
  })

  it('gives up instead of looping when every suffix is refused', () => {
    const names = new CommandNameRegistry()
    let attempts = 0
    const result = registerWithAllocatedName(names, 'compact', name => {
      attempts += 1
      throw refuseRegistered(name)
    })
    expect(result.kind).toBe('failed')
    expect(attempts).toBe(MAX_COMMAND_NAME_ATTEMPTS + 1)
    expect(attempts).toBeLessThan(200)
  })

  it('reuses a released preferred name while a held suffix stays occupied', () => {
    const names = new CommandNameRegistry()
    expect(registerWithAllocatedName(names, 'compact', () => 'first')).toMatchObject({ name: 'compact' })
    expect(registerWithAllocatedName(names, 'compact', () => 'second')).toMatchObject({ name: 'compact-1' })
    names.forget('compact')
    // The released preferred name is free again; compact-1 still belongs to the
    // second registration, so nothing re-issues it.
    expect(registerWithAllocatedName(names, 'compact', () => 'third')).toMatchObject({ name: 'compact' })
    expect([...names.taken()]).toEqual(['compact-1', 'compact'])
    expect(registerWithAllocatedName(names, 'compact-1', () => 'fourth')).toMatchObject({ name: 'compact-1-1' })
  })

  it('recognises a scoped refusal the same way as a global one', () => {
    const names = new CommandNameRegistry()
    const host = new Set(['review'])
    const result = registerWithAllocatedName(names, 'review', name => {
      if (host.has(name)) throw refuseRegistered(name, true)
      return 'disposer'
    })
    expect(result).toMatchObject({ kind: 'registered', name: 'review-1' })
  })
})
