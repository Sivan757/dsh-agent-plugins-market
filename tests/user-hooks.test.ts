import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { loadUserHooksSuite, USER_HOOKS_SOURCE, USER_HOOKS_SUITE } from '../src/runtime/user-hooks.js'
import { HooksMountRegistry } from '../src/runtime/hooks-mounts.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'market-user-hooks-test-'))
  roots.push(value)
  return value
}
const hook = (command: string) => ({ matcher: '*', hooks: [{ type: 'command', command }] })

describe('user Agent layout hook normalization', () => {
  it('merges the nested and root files, accepting a bare event table and a hooks key', async () => {
    const agentsRoot = await root()
    await mkdir(join(agentsRoot, 'hooks'), { recursive: true })
    await writeFile(join(agentsRoot, 'hooks/hooks.json'), JSON.stringify({ PreToolUse: [hook('echo nested')] }))
    await writeFile(join(agentsRoot, 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [hook('echo root')] } }))

    const suite = await loadUserHooksSuite(agentsRoot)
    expect(suite.errors).toEqual([])
    expect(suite.sourceId).toBe(USER_HOOKS_SOURCE)
    expect(suite.id).toBe(USER_HOOKS_SUITE)
    expect(suite.root).toBe(agentsRoot)
    expect(suite.surfaces.hooks).toBe(2)
    expect(suite.activeSurfaces).toEqual({ skills: false, mcp: false, hooks: true, commands: false, agents: false, lsp: false })
    expect(suite.hooks?.events.PreToolUse?.[0]?.hooks[0]?.command).toBe('echo nested')
    expect(suite.hooks?.events.SessionStart?.[0]?.hooks[0]?.command).toBe('echo root')
  })

  it('carries no project root, so the bridge keeps the session workspace as the project directory', async () => {
    const agentsRoot = await root()
    await writeFile(join(agentsRoot, 'hooks.json'), JSON.stringify({ PreToolUse: [hook('echo one')] }))

    const suite = await loadUserHooksSuite(agentsRoot)
    expect(suite.hooks).toBeDefined()
    expect(suite.hooks?.projectRoot).toBeUndefined()
    expect(Object.hasOwn(suite.hooks ?? {}, 'projectRoot')).toBe(false)
  })

  it('deduplicates the same event, matcher and command declared by both files', async () => {
    const agentsRoot = await root()
    await mkdir(join(agentsRoot, 'hooks'), { recursive: true })
    await writeFile(join(agentsRoot, 'hooks/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [hook('echo one'), hook('echo two')] } }))
    await writeFile(join(agentsRoot, 'hooks.json'), JSON.stringify({ PreToolUse: [hook('echo one')] }))

    const suite = await loadUserHooksSuite(agentsRoot)
    expect(suite.surfaces.hooks).toBe(2)
    expect(suite.hooks?.events.PreToolUse?.flatMap(group => group.hooks.map(entry => entry.command))).toEqual(['echo one', 'echo two'])
  })

  it('drops every hook set when one of the two files is malformed', async () => {
    const agentsRoot = await root()
    await writeFile(join(agentsRoot, 'hooks.json'), '{broken')
    await mkdir(join(agentsRoot, 'hooks'), { recursive: true })
    await writeFile(join(agentsRoot, 'hooks/hooks.json'), JSON.stringify({ PreToolUse: [hook('echo nested')] }))

    const suite = await loadUserHooksSuite(agentsRoot)
    expect(suite.hooks).toBeUndefined()
    expect(suite.surfaces.hooks).toBe(0)
    expect(suite.errors).toEqual(['hooks.json: hook file is invalid JSON'])
  })

  it('reports an invalid hook command without mounting the rest', async () => {
    const agentsRoot = await root()
    await writeFile(join(agentsRoot, 'hooks.json'), JSON.stringify({ PreToolUse: [{ hooks: [{ type: 'command' }] }] }))

    const suite = await loadUserHooksSuite(agentsRoot)
    expect(suite.hooks).toBeUndefined()
    expect(suite.errors.join('\n')).toContain('invalid PreToolUse command hook')
  })

  it('contributes nothing when no hook file exists', async () => {
    const agentsRoot = await root()
    const suite = await loadUserHooksSuite(agentsRoot)
    expect(suite.errors).toEqual([])
    expect(suite.surfaces.hooks).toBe(0)
    expect(suite.hooks).toBeUndefined()
  })

  it('honors the shared disableAllHooks control', async () => {
    const agentsRoot = await root()
    await writeFile(join(agentsRoot, 'hooks.json'), JSON.stringify({ disableAllHooks: true, PreToolUse: [hook('echo one')] }))

    const suite = await loadUserHooksSuite(agentsRoot)
    expect(suite.hooks).toBeUndefined()
    expect(suite.surfaces.hooks).toBe(0)
  })
})

describe('user hook bridge lifecycle', () => {
  it('mounts the Agent layout root hooks with the root as plugin root and no project dir', async () => {
    const agentsRoot = await root()
    await mkdir(join(agentsRoot, 'hooks'), { recursive: true })
    await writeFile(join(agentsRoot, 'hooks/hooks.json'), JSON.stringify({ PreToolUse: [hook('echo nested')] }))
    await writeFile(join(agentsRoot, 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [hook('echo root')] } }))
    const mounts: Array<{ configPath: string; pluginRoot: string; projectDir?: string; disposed: boolean }> = []
    const host = {
      plugin: (_plugin: unknown, config: { configPath: string; pluginRoot: string; projectDir?: string }) => {
        const mount = { ...config, disposed: false }
        mounts.push(mount)
        return {
          await: async () => {},
          dispose: async () => {
            mount.disposed = true
          }
        }
      }
    }
    const registry = new HooksMountRegistry(host as unknown as Context)
    try {
      const suite = withDefaultSurfaces(await loadUserHooksSuite(agentsRoot))
      expect(await registry.reconcile([suite])).toEqual([])
      expect(mounts).toHaveLength(1)
      const [mounted] = mounts
      if (mounted === undefined) throw new Error('expected the user hook config to mount once')
      expect(mounted.pluginRoot).toBe(agentsRoot)
      expect(mounted.projectDir).toBeUndefined()
      expect(mounted.configPath.startsWith(agentsRoot)).toBe(false)
      const snapshot = JSON.parse(await readFile(mounted.configPath, 'utf8')) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }
      expect(snapshot.hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe('echo nested')
      expect(snapshot.hooks.SessionStart?.[0]?.hooks[0]?.command).toBe('echo root')
      await registry.reconcile([])
      expect(mounted.disposed).toBe(true)
      await expect(stat(dirname(mounted.configPath))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await registry.disposeAll()
    }
  })
})
