import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { bindHostLocale } from '../src/runtime/host/host-locale.js'
import { createUserPanelStores } from '../src/runtime/panels/user-panels.js'
import { UserCommandMountRegistry } from '../src/runtime/panels/user-commands.js'
import { required } from './helpers/fixture.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface Definition {
  name: string
  description: string
  handler(invocation: { agent: unknown; rawInput: string }): { kind: string; text: string }
}

/** A host context whose `commands` registry records the live registrations. */
function commandHost(registered: Map<string, Definition>): Context {
  return {
    commands: {
      register: (definition: Definition) => {
        registered.set(definition.name, definition)
        return () => {
          registered.delete(definition.name)
        }
      }
    }
  } as unknown as Context
}

/** Seed a user commands panel with the given documents and reconcile it once. */
async function mountCommands(documents: Record<string, string>): Promise<{
  store: Awaited<ReturnType<typeof createUserPanelStores>>['commands']
  registered: Map<string, Definition>
  diagnostics: string[]
}> {
  const root = await mkdtemp(join(tmpdir(), 'market-user-commands-'))
  roots.push(root)
  const panels = createUserPanelStores(join(root, 'agents'))
  for (const [name, text] of Object.entries(documents)) await panels.commands.create(name, text)
  const registered = new Map<string, Definition>()
  const registry = new UserCommandMountRegistry(commandHost(registered), panels.commands, bindHostLocale(undefined))
  const diagnostics = await registry.reconcile()
  return { store: panels.commands, registered, diagnostics }
}

/** One flat command, its panel store, and its live registration. */
async function mountOneCommand(): Promise<{ store: Awaited<ReturnType<typeof createUserPanelStores>>['commands']; registered: Map<string, Definition> }> {
  const { store, registered, diagnostics } = await mountCommands({ 'do-thing': '---\ndescription: Do the thing\n---\nDo the thing: $ARGUMENTS' })
  expect(diagnostics).toEqual([])
  return { store, registered }
}

describe('user command mounts', () => {
  it('forwards the authored body verbatim, with no plugin or source decorator', async () => {
    const { registered } = await mountOneCommand()
    const definition = registered.get('do-thing')
    if (definition === undefined) throw new Error('expected the enabled user command to register')

    const messages: unknown[] = []
    const result = definition.handler({ agent: { followup: (message: unknown) => messages.push(message) }, rawInput: ' now' })

    expect(result).toEqual({ kind: 'success', text: '/do-thing 已转交模型执行' })
    expect(messages).toHaveLength(1)
    const forwarded = required(messages[0] as UserMessage | undefined, 'the user command to forward one follow-up')
    expect(forwarded.id).toMatch(/^\S+$/)
    expect(forwarded.role).toBe('user')
    expect(forwarded.content).toEqual([{ type: 'text', text: 'Do the thing: now' }])
    expect(forwarded.source).toEqual({ kind: 'plugin-market', form: 'instructions' })
  })

  it('keeps the source label in the slash-menu description and drops disabled entries', async () => {
    const { store, registered } = await mountOneCommand()
    expect(registered.get('do-thing')?.description).toBe('[用户命令] Do the thing')

    await store.update('do-thing', '---\ndescription: Do the thing\ndisabled: true\n---\nDo the thing: $ARGUMENTS')
    const context = {
      commands: {
        register: () => {
          throw new Error('a disabled entry must not register')
        }
      }
    }
    const registry = new UserCommandMountRegistry(context as unknown as Context, store, bindHostLocale(undefined))
    expect(await registry.reconcile()).toEqual([])
  })

  it('registers a nested command under its flattened call name', async () => {
    const { registered, diagnostics } = await mountCommands({ 'git/commit': '---\ndescription: Commit staged work\n---\nCommit: $ARGUMENTS' })
    expect(diagnostics).toEqual([])
    // The panel addresses `git/commit`; the slash menu only accepts `git-commit`.
    expect([...registered.keys()]).toEqual(['git-commit'])
    const definition = registered.get('git-commit')
    if (definition === undefined) throw new Error('expected the nested user command to register as git-commit')
    expect(definition.description).toBe('[用户命令] Commit staged work')

    const messages: unknown[] = []
    const result = definition.handler({ agent: { followup: (message: unknown) => messages.push(message) }, rawInput: ' now' })
    expect(result).toEqual({ kind: 'success', text: '/git-commit 已转交模型执行' })
    const forwarded = required(messages[0] as UserMessage | undefined, 'the nested user command to forward one follow-up')
    expect(forwarded.content).toEqual([{ type: 'text', text: 'Commit: now' }])
  })

  it('registers one of two commands that flatten to the same call name and diagnoses the other', async () => {
    const { registered, diagnostics } = await mountCommands({
      'git-commit': '---\ndescription: Flat spelling\n---\nFlat: $ARGUMENTS',
      'git/commit': '---\ndescription: Nested spelling\n---\nNested: $ARGUMENTS'
    })
    expect([...registered.keys()]).toEqual(['git-commit'])
    expect(diagnostics).toHaveLength(1)
    // The diagnostic names both documents, so the shadowed one stays findable.
    expect(diagnostics[0]).toContain('git-commit')
    expect(diagnostics[0]).toContain('git/commit')
    expect(diagnostics[0]).toContain('shadowed')
  })
})
