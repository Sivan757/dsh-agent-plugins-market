import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverProjectHooks } from '../src/catalog/project-hooks.js'
import { discoverNativeProjectSuites } from '../src/catalog/native-project.js'
import { HooksMountRegistry } from '../src/runtime/hooks-mounts.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'market-project-hooks-test-'))
  roots.push(value)
  await mkdir(join(value, '.claude'))
  return value
}
const hook = (command: string) => ({ matcher: '*', hooks: [{ type: 'command', command }] })

describe('native project hook normalization', () => {
  it('requires ZCode hooks.enabled and translates its timeout unit for the bridge', async () => {
    const project = await root()
    const path = join(project, 'zcode.json')
    const hooks = { events: { PreToolUse: [hook('echo zcode')] }, timeoutMs: 1500 }
    await writeFile(path, JSON.stringify({ hooks }))
    expect(await discoverProjectHooks(project, ['zcode.json'], [], 'zcode')).toBeUndefined()
    await writeFile(path, JSON.stringify({ hooks: { ...hooks, enabled: true } }))
    const result = await discoverProjectHooks(project, ['zcode.json'], [], 'zcode')
    expect(result?.events.PreToolUse?.[0]?.hooks[0]?.timeout).toBe(1.5)
  })
  it('merges and deduplicates hooks, keeping unsupported events/types visible as diagnostics', async () => {
    const project = await root()
    await writeFile(join(project, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [hook('echo one')], FutureEvent: [hook('echo unknown')] } }))
    await writeFile(
      join(project, '.claude/settings.local.json'),
      JSON.stringify({ hooks: { PreToolUse: [hook('echo one'), hook('echo two')], Stop: [{ hooks: [{ type: 'prompt', prompt: 'judge' }] }] } })
    )
    const errors: string[] = []
    const result = await discoverProjectHooks(project, ['.claude/settings.json', '.claude/settings.local.json'], errors)
    expect(result?.events.PreToolUse?.flatMap(group => group.hooks.map(entry => entry.command))).toEqual(['echo one', 'echo two'])
    expect(errors.join('\n')).toContain('unsupported project hook event FutureEvent')
    expect(errors.join('\n')).toContain('unsupported Stop hook type prompt')
  })

  it('rejects malformed matchers without keeping earlier commands executable', async () => {
    const project = await root()
    await writeFile(join(project, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [hook('echo one'), { ...hook('echo two'), matcher: '[' }] } }))
    const errors: string[] = []
    expect(await discoverProjectHooks(project, ['.claude/settings.json'], errors)).toBeUndefined()
    expect(errors.join()).toContain('invalid PreToolUse hook matcher')
  })

  it('honors a local disableAllHooks setting', async () => {
    const project = await root()
    await writeFile(join(project, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [hook('echo one')] } }))
    await writeFile(join(project, '.claude/settings.local.json'), '{"disableAllHooks":true}')
    expect(await discoverProjectHooks(project, ['.claude/settings.json', '.claude/settings.local.json'], [])).toBeUndefined()
  })

  it('reads a bare event table from the Agent layout hook files', async () => {
    const project = await root()
    await mkdir(join(project, '.agents/hooks'), { recursive: true })
    await writeFile(join(project, '.agents/hooks/hooks.json'), JSON.stringify({ PreToolUse: [hook('echo nested')] }))
    await writeFile(join(project, '.agents/hooks.json'), JSON.stringify({ hooks: { SessionStart: [hook('echo root')] } }))
    const errors: string[] = []
    const result = await discoverProjectHooks(project, ['.agents/hooks/hooks.json', '.agents/hooks.json'], errors)
    expect(errors).toEqual([])
    expect(result?.events.PreToolUse?.flatMap(group => group.hooks.map(entry => entry.command))).toEqual(['echo nested'])
    expect(result?.events.SessionStart?.flatMap(group => group.hooks.map(entry => entry.command))).toEqual(['echo root'])
  })

  it('drops every declared hook set when one Agent layout hook file is malformed', async () => {
    const project = await root()
    await mkdir(join(project, '.agents'), { recursive: true })
    await writeFile(join(project, '.agents/hooks.json'), JSON.stringify({ PreToolUse: [{ hooks: [{ type: 'command' }] }] }))
    const errors: string[] = []
    expect(await discoverProjectHooks(project, ['.agents/hooks.json'], errors)).toBeUndefined()
    expect(errors.join()).toContain('invalid PreToolUse command hook')
  })

  it('leaves a settings table without hooks to ordinary validation', async () => {
    const project = await root()
    await writeFile(join(project, '.claude/settings.json'), JSON.stringify({ model: 'sonnet' }))
    const errors: string[] = []
    expect(await discoverProjectHooks(project, ['.claude/settings.json'], errors)).toBeUndefined()
    expect(errors).toEqual([])
  })
})

describe('native hook bridge lifecycle', () => {
  it('mounts the Agent layout hook file as one project suite surface', async () => {
    const project = await root()
    await mkdir(join(project, '.agents/hooks'), { recursive: true })
    await writeFile(join(project, '.agents/hooks/hooks.json'), JSON.stringify({ PreToolUse: [hook('echo nested')] }))
    await writeFile(join(project, '.agents/hooks.json'), JSON.stringify({ hooks: { SessionStart: [hook('echo root')] } }))
    const snapshots: string[] = []
    const host = {
      plugin: (_plugin: unknown, config: { configPath: string }) => {
        snapshots.push(config.configPath)
        return { await: async () => {}, dispose: async () => {} }
      }
    }
    const registry = new HooksMountRegistry(host as unknown as Context)
    try {
      const suites = await discoverNativeProjectSuites(project, 'project')
      const suite = suites.find(entry => entry.id === 'agents-native')
      if (suite === undefined) throw new Error('expected the .agents project layout to be discovered')
      expect(suite.surfaces.hooks).toBe(2)
      expect(suite.activeSurfaces?.hooks).toBe(true)
      expect(suite.hooks?.projectRoot).toBe(project)
      expect(suite.hooks?.events.PreToolUse?.[0]?.hooks[0]?.command).toBe('echo nested')
      expect(await registry.reconcile(suites.map(entry => withDefaultSurfaces(entry)))).toEqual([])
      expect(snapshots).toHaveLength(1)
      const [snapshot] = snapshots
      if (snapshot === undefined) throw new Error('expected the hook config to mount once')
      const mounted = JSON.parse(await readFile(snapshot, 'utf8')) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }
      expect(mounted.hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe('echo nested')
      expect(mounted.hooks.SessionStart?.[0]?.hooks[0]?.command).toBe('echo root')
    } finally {
      await registry.disposeAll()
    }
  })

  it('uses a private runtime snapshot, remounts changed config and removes temporary files', async () => {
    const project = await root()
    const settingsPath = join(project, '.claude/settings.json')
    const original = JSON.stringify({ hooks: { PreToolUse: [hook('echo one')] }, unrelated: 'not copied' })
    await writeFile(settingsPath, original)
    const mounts: Array<{ configPath: string; projectDir: string; disposed: boolean }> = []
    const host = {
      plugin: (_plugin: unknown, config: { configPath: string; projectDir: string }) => {
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
      expect(await registry.reconcile((await discoverNativeProjectSuites(project, 'project')).map(suite => withDefaultSurfaces(suite)))).toEqual([])
      expect(mounts).toHaveLength(1)
      const [first] = mounts
      if (first === undefined) throw new Error('expected the hook config to mount once')
      expect(first.projectDir).toBe(project)
      expect(first.configPath.startsWith(project)).toBe(false)
      // Windows has no POSIX permission bits — `chmod` there only toggles the
      // read-only attribute — so the private-file mode is a POSIX guarantee.
      if (process.platform !== 'win32') expect((await stat(first.configPath)).mode & 0o777).toBe(0o600)
      expect(await readFile(first.configPath, 'utf8')).not.toContain('not copied')
      expect(await readFile(settingsPath, 'utf8')).toBe(original)
      await writeFile(settingsPath, JSON.stringify({ hooks: { PreToolUse: [hook('echo changed')] } }))
      await registry.reconcile((await discoverNativeProjectSuites(project, 'project')).map(suite => withDefaultSurfaces(suite)))
      expect(mounts).toHaveLength(2)
      expect(first.disposed).toBe(true)
      await expect(stat(dirname(first.configPath))).rejects.toMatchObject({ code: 'ENOENT' })
      await registry.reconcile([])
      const second = mounts[1]
      if (second === undefined) throw new Error('expected the changed hook config to remount')
      expect(second.disposed).toBe(true)
      await expect(stat(second.configPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await registry.disposeAll()
    }
  })
})
