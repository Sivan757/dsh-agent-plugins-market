import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { scanSource } from '../packages/market-catalog/src/scanning/suite-scanner.js'
import { CommandMountRegistry } from '../packages/market-runtime/src/runtime/surfaces/commands-mounts.js'
import type { Suite } from '../packages/market-contracts/src/model/types.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'
import { required } from './helpers/fixture.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** One suite root carrying the given `commands/<file>.md` documents. */
async function suiteRoot(commands: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'market-command-names-'))
  roots.push(root)
  await mkdir(join(root, '.claude-plugin'), { recursive: true })
  await writeFile(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo' }))
  for (const [name, text] of Object.entries(commands)) {
    const file = join(root, 'commands', name)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, text)
  }
  return root
}

/** The scanned suites of one root, enabled, ready to reconcile. */
async function suitesOf(root: string): Promise<Suite[]> {
  const scanned = await scanSource(root, 's', 'user')
  return scanned.suites.map(suite => withDefaultSurfaces({ ...suite, enabled: true }))
}

interface Registration {
  name: string
  description: string
  handler(invocation: { agent: unknown; rawInput: string }): unknown
}

/**
 * A host command registry carrying the host's own duplicate rule: one name per
 * layer throws, and `occupied` seeds the names already held there — a host
 * built-in such as /compact, or a sibling registry's registration. That layer
 * check is the only collision signal this plugin can observe.
 */
function commandHost(registered: Map<string, Registration>, occupied: string[] = []): Context {
  const held = new Set(occupied)
  return {
    // No optional service resolves here, so a template's placeholders stay literal.
    get: () => undefined,
    commands: {
      register: (definition: Registration) => {
        if (held.has(definition.name)) {
          throw new Error('command "' + definition.name + '" is already registered (for a per-agent variant, mount a command-injected plugin under that agent\'s `agent.ctx`)')
        }
        held.add(definition.name)
        registered.set(definition.name, definition)
        return () => {
          held.delete(definition.name)
          registered.delete(definition.name)
        }
      }
    }
  } as unknown as Context
}

describe('suite command name allocation', () => {
  it('registers both files that flatten to one call name, giving the second a suffix', async () => {
    const root = await suiteRoot({
      'review-apply.md': '---\ndescription: Flat spelling\n---\nFlat: $ARGUMENTS',
      'review/apply.md': '---\ndescription: Nested spelling\n---\nNested: $ARGUMENTS'
    })
    const registered = new Map<string, Registration>()
    const registry = new CommandMountRegistry(commandHost(registered))
    const diagnostics = await registry.reconcile(await suitesOf(root))

    // Both spell the call name `review-apply`; the second takes the first free
    // suffix instead of being dropped by the host's duplicate ban.
    expect([...registered.keys()].sort()).toEqual(['review-apply', 'review-apply-1'])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ command: 'review-apply-1' })
    registry.disposeAll()
  })

  it('takes the -1 suffix on the first conflict with a name we cannot see', async () => {
    const root = await suiteRoot({ 'compact.md': '---\ndescription: Ours\n---\nOurs: $ARGUMENTS' })
    const registered = new Map<string, Registration>()
    // A host built-in already owns /compact; its layer is not enumerable here.
    const registry = new CommandMountRegistry(commandHost(registered, ['compact']))
    const diagnostics = await registry.reconcile(await suitesOf(root))

    expect([...registered.keys()]).toEqual(['compact-1'])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ suiteId: 's/demo', command: 'compact-1' })
    expect(diagnostics[0]?.reason).toContain('compact-1')
    registry.disposeAll()
  })

  it('skips a suffix that is itself taken', async () => {
    const root = await suiteRoot({ 'compact.md': '---\ndescription: Ours\n---\nOurs: $ARGUMENTS' })
    const registered = new Map<string, Registration>()
    const registry = new CommandMountRegistry(commandHost(registered, ['compact', 'compact-1']))
    await registry.reconcile(await suitesOf(root))
    expect([...registered.keys()]).toEqual(['compact-2'])
    registry.disposeAll()
  })

  it('does not retry a failure that is not a name collision', async () => {
    const root = await suiteRoot({ 'review.md': '---\ndescription: Review\n---\nReview: $ARGUMENTS' })
    const attempted: string[] = []
    const ctx = {
      commands: {
        register: (definition: Registration) => {
          attempted.push(definition.name)
          throw new Error('command "' + definition.name + '" description must not be empty')
        }
      }
    } as unknown as Context
    const registry = new CommandMountRegistry(ctx)
    const diagnostics = await registry.reconcile(await suitesOf(root))

    // One attempt only: renaming around a malformed definition would report the
    // rename instead of the bug that caused it.
    expect(attempted).toEqual(['review'])
    expect(diagnostics).toEqual([{ suiteId: 's/demo', command: 'review', reason: 'command "review" description must not be empty' }])
  })

  it('is idempotent across repeated reconciles of one snapshot', async () => {
    const root = await suiteRoot({
      'compact.md': '---\ndescription: Ours\n---\nOurs: $ARGUMENTS',
      'other.md': '---\ndescription: Other\n---\nOther: $ARGUMENTS'
    })
    const registered = new Map<string, Registration>()
    const attempts: string[] = []
    const inner = commandHost(registered, ['compact']) as unknown as { commands: { register(definition: Registration): () => void } }
    const counting = {
      commands: {
        register: (definition: Registration) => {
          attempts.push(definition.name)
          return inner.commands.register(definition)
        }
      }
    } as unknown as Context
    const registry = new CommandMountRegistry(counting)
    const suites = await suitesOf(root)
    await registry.reconcile(suites)
    expect([...registered.keys()].sort()).toEqual(['compact-1', 'other'])

    // The refused `compact` attempt is how the occupied name was discovered.
    expect(attempts).toEqual(['compact', 'compact-1', 'other'])

    // A second identical pass re-registers nothing and spends no further suffix.
    expect(await registry.reconcile(suites)).toEqual([])
    expect(attempts).toEqual(['compact', 'compact-1', 'other'])
    expect([...registered.keys()].sort()).toEqual(['compact-1', 'other'])
    registry.disposeAll()
  })

  it('reuses a released name once the command stops being wanted', async () => {
    const root = await suiteRoot({ 'compact.md': '---\ndescription: Ours\n---\nOurs: $ARGUMENTS' })
    const registered = new Map<string, Registration>()
    const registry = new CommandMountRegistry(commandHost(registered, ['compact']))
    const suites = await suitesOf(root)
    await registry.reconcile(suites)
    expect([...registered.keys()]).toEqual(['compact-1'])

    await registry.reconcile([])
    expect(registered.size).toBe(0)

    await registry.reconcile(suites)
    expect([...registered.keys()]).toEqual(['compact-1'])
    registry.disposeAll()
  })

  it('forwards the template and acknowledges under the name actually registered', async () => {
    const root = await suiteRoot({ 'compact.md': '---\ndescription: Ours\n---\nOurs: $ARGUMENTS' })
    const registered = new Map<string, Registration>()
    const registry = new CommandMountRegistry(commandHost(registered, ['compact']))
    await registry.reconcile(await suitesOf(root))

    const definition = required(registered.get('compact-1'), 'the renamed suite command to register as compact-1')
    let forwarded = ''
    const result = (await definition.handler({
      agent: { session: { header: {} }, followup: (message: { content: Array<{ text: string }> }) => (forwarded = message.content[0]?.text ?? '') },
      rawInput: ' now'
    })) as { kind: string; text: string }
    expect(result).toEqual({ kind: 'success', text: '/compact-1 已转交模型执行' })
    expect(forwarded).toBe('Ours: now')
    registry.disposeAll()
  })

  it('releases every held name at teardown, so a later seat reuses them', async () => {
    const root = await suiteRoot({ 'compact.md': '---\ndescription: Ours\n---\nOurs: $ARGUMENTS' })
    const registered = new Map<string, Registration>()
    const registry = new CommandMountRegistry(commandHost(registered, ['compact']))
    await registry.reconcile(await suitesOf(root))
    expect([...registered.keys()]).toEqual(['compact-1'])

    registry.disposeAll()
    expect(registered.size).toBe(0)

    // Nothing is live, so every name this seat took is free again.
    const second = new CommandMountRegistry(commandHost(registered, ['compact']))
    await second.reconcile(await suitesOf(root))
    expect([...registered.keys()]).toEqual(['compact-1'])
    second.disposeAll()
  })
  it('leaves two layers' + "'" + ' own same-named commands alone', async () => {
    const first = await suiteRoot({ 'review.md': '---\ndescription: First\n---\nFirst: $ARGUMENTS' })
    const second = await suiteRoot({ 'review.md': '---\ndescription: Second\n---\nSecond: $ARGUMENTS' })
    // Separate registries stand for separate host layers, whose occupancy the
    // host checks independently: both may hold `review`.
    const firstRegistered = new Map<string, Registration>()
    const secondRegistered = new Map<string, Registration>()
    const firstRegistry = new CommandMountRegistry(commandHost(firstRegistered))
    const secondRegistry = new CommandMountRegistry(commandHost(secondRegistered))
    expect(await firstRegistry.reconcile(await suitesOf(first))).toEqual([])
    expect(await secondRegistry.reconcile(await suitesOf(second))).toEqual([])
    expect([...firstRegistered.keys()]).toEqual(['review'])
    expect([...secondRegistered.keys()]).toEqual(['review'])
    firstRegistry.disposeAll()
    secondRegistry.disposeAll()
  })
})
