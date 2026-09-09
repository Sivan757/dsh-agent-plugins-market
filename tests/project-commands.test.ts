import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Catalog } from '../src/application/catalog.js'
import { mountProjectCommands } from '../src/runtime/project-runtime.js'
import { bindHostLocale } from '../src/runtime/host-locale.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface Definition {
  name: string
  handler(invocation: { agent: unknown; rawInput: string }): { kind: string }
}

function agent(cwd: string) {
  const definitions = new Map<string, Definition>()
  const messages: unknown[] = []
  return {
    session: { header: { cwd } },
    definitions,
    messages,
    followup: (message: unknown) => messages.push(message),
    ctx: {
      inject: (_services: string[], callback: (scope: unknown) => void) => {
        const cleanups: Array<() => void> = []
        callback({
          commands: {
            register: (definition: Definition) => {
              if (definitions.has(definition.name)) throw new Error('duplicate command')
              definitions.set(definition.name, definition)
              return () => {
                definitions.delete(definition.name)
              }
            }
          },
          effect: (setup: () => () => void) => {
            cleanups.push(setup())
          }
        })
        return {
          dispose: async () => {
            cleanups.splice(0).forEach(cleanup => cleanup())
          }
        }
      }
    }
  }
}

async function project(body: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'market-project-commands-'))
  roots.push(root)
  await mkdir(join(root, '.git'))
  await mkdir(join(root, '.qoder', 'commands'), { recursive: true })
  await writeFile(join(root, '.qoder', 'commands', 'review.md'), `---\ndescription: Review changes\n---\n${body} $ARGUMENTS`)
  return root
}

describe('project command lifecycle', () => {
  it('isolates same-named commands, reconciles the switch, and unwinds disposed agents', async () => {
    const first = agent(await project('First project'))
    const second = agent(await project('Second project'))
    const userRoot = await project('User directory')
    const listeners = new Map<string, (payload: { agent: unknown }) => unknown>()
    const context = {
      agents: { list: () => [first, second] },
      on: (event: string, callback: (payload: { agent: unknown }) => unknown) => {
        listeners.set(event, callback)
        return () => {
          listeners.delete(event)
        }
      },
      logger: { warn: () => {} }
    }
    const catalog = new Catalog({
      userRoot,
      dataRoot: join(userRoot, 'data'),
      onChanged: async () => {
        await mounted.refresh()
      }
    })
    await catalog.load()
    const mounted = mountProjectCommands(context as unknown as Context, catalog, bindHostLocale(undefined))
    await mounted.refresh()
    for (const current of [first, second]) {
      expect([...current.definitions.keys()]).toEqual(['review'])
      expect(current.definitions.get('review')!.handler({ agent: current, rawInput: ' my diff' }).kind).toBe('success')
    }
    expect(JSON.stringify(first.messages)).toContain('First project my diff')
    expect(JSON.stringify(first.messages)).not.toContain('Second project')
    expect(JSON.stringify(second.messages)).toContain('Second project my diff')

    await catalog.setScanProjectLayouts(false)
    expect(first.definitions.size).toBe(0)
    expect(second.definitions.size).toBe(0)
    await catalog.setScanProjectLayouts(true)
    expect(first.definitions.has('review')).toBe(true)

    listeners.get('agent/disposed')!({ agent: first })
    expect(first.definitions.size).toBe(0)
    expect(second.definitions.has('review')).toBe(true)
    await mounted.dispose()
    expect(second.definitions.size).toBe(0)
    expect(listeners.size).toBe(0)
  })

  it('does not resurrect a disposed agent while its catalog read is in flight', async () => {
    const current = agent(await project('Pending project'))
    let release!: () => void
    const pending = new Promise<void>(resolve => {
      release = resolve
    })
    const userRoot = await project('User directory')
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await catalog.load()
    const snapshot = await catalog.readProjectCatalog(current.session.header.cwd)
    const delayedCatalog = {
      readProjectCatalog: async () => {
        await pending
        return snapshot
      }
    }
    const context = { agents: { list: () => [current] }, on: () => () => {}, logger: { warn: () => {} } }
    const mounted = mountProjectCommands(context as unknown as Context, delayedCatalog as unknown as Catalog, bindHostLocale(undefined))
    const refresh = mounted.refresh()
    await mounted.dispose()
    release()
    await refresh
    expect(current.definitions.size).toBe(0)
  })
})
