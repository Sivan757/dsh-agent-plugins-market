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
})

describe('native hook bridge lifecycle', () => {
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
      const first = mounts[0]
      expect(first.projectDir).toBe(project)
      expect(first.configPath.startsWith(project)).toBe(false)
      expect((await stat(first.configPath)).mode & 0o777).toBe(0o600)
      expect(await readFile(first.configPath, 'utf8')).not.toContain('not copied')
      expect(await readFile(settingsPath, 'utf8')).toBe(original)
      await writeFile(settingsPath, JSON.stringify({ hooks: { PreToolUse: [hook('echo changed')] } }))
      await registry.reconcile((await discoverNativeProjectSuites(project, 'project')).map(suite => withDefaultSurfaces(suite)))
      expect(mounts).toHaveLength(2)
      expect(first.disposed).toBe(true)
      await expect(stat(dirname(first.configPath))).rejects.toMatchObject({ code: 'ENOENT' })
      await registry.reconcile([])
      expect(mounts[1].disposed).toBe(true)
      await expect(stat(mounts[1].configPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await registry.disposeAll()
    }
  })
})
