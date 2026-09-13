import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { bindHostLocale } from '../src/runtime/host-locale.js'
import { createUserPanelStores } from '../src/runtime/user-panels.js'
import { UserCommandMountRegistry } from '../src/runtime/user-commands.js'

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
async function mountOneCommand(): Promise<{ store: Awaited<ReturnType<typeof createUserPanelStores>>['commands']; registered: Map<string, Definition> }> {
  const root = await mkdtemp(join(tmpdir(), 'market-user-commands-'))
  roots.push(root)
  const panels = createUserPanelStores(join(root, 'agents'))
  await panels.commands.create('do-thing', '---\ndescription: Do the thing\n---\nDo the thing: $ARGUMENTS')
  const registered = new Map<string, Definition>()
  const context = {
    commands: {
      register: (definition: Definition) => {
        registered.set(definition.name, definition)
        return () => {
          registered.delete(definition.name)
        }
      }
    }
  }
  const registry = new UserCommandMountRegistry(context as unknown as Context, panels.commands, bindHostLocale(undefined))
  expect(await registry.reconcile()).toEqual([])
  return { store: panels.commands, registered }
}

describe('user command mounts', () => {
  it('forwards the authored body verbatim, with no plugin or source decorator', async () => {
    const { registered } = await mountOneCommand()
    const definition = registered.get('do-thing')
    if (definition === undefined) throw new Error('expected the enabled user command to register')

    const messages: unknown[] = []
    const result = definition.handler({ agent: { followup: (message: unknown) => messages.push(message) }, rawInput: ' now' })

    expect(result).toEqual({ kind: 'success', text: '/do-thing 已转交模型执行' })
    expect(messages).toEqual([{ content: [{ type: 'text', text: 'Do the thing: now' }], source: { kind: 'plugin', plugin: 'dsh-agent-plugins-market' } }])
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
})
