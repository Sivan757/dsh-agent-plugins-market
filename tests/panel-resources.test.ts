import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { createPanelResources } from '../src/application/panel-resources.js'
import { createUserPanelStores } from '../src/runtime/panels/user-panels.js'

describe('installed and user panel resources', () => {
  it('projects installed resources, keeps their content read-only, and applies the enable switch to the registered file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-panels-'))
    try {
      for (const id of ['active', 'unused']) {
        await mkdir(join(root, '.sources', id), { recursive: true })
        await cp('tests/fixtures/v1-suite', join(root, '.sources', id), { recursive: true })
        // Extension-surface agents live under the client namespace directory
        // (Agent Plugins §8.2); the portable dialect does not read a root `agents/`.
        await mkdir(join(root, '.sources', id, 'com.deepseek.harness', 'agents'), { recursive: true })
        await writeFile(
          join(root, '.sources', id, 'com.deepseek.harness', 'agents', 'reviewer.md'),
          '---\ndescription: Review code\nmodel: vendor/model\ntools: [read, search]\nmetadata:\n  team: core\n---\nReview carefully.'
        )
      }
      await writeFile(
        join(root, 'state.json'),
        JSON.stringify({
          version: 1,
          sources: ['active', 'unused'].map(id => ({ id, url: join(root, '.sources', id), local: true })),
          installed: { 'active/v1-suite': { enabled: true, installedAt: new Date(0).toISOString() } }
        })
      )
      const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), agentsRoot: join(root, 'agents'), onChanged: () => {} })
      await catalog.load()
      const users = createUserPanelStores(root)
      await users.agents.create('reviewer', '---\ndescription: My reviewer\n---\nMy instructions')
      const panels = createPanelResources(catalog, users)
      const rows = await panels.agents.list()
      expect(rows).toHaveLength(2)
      expect(rows.map(row => row.origin).sort()).toEqual(['plugin', 'user'])
      const plugin = rows.find(row => row.origin === 'plugin')!
      expect(plugin.metadata).toMatchObject({ tools: ['read', 'search'], metadata: { team: 'core' } })
      // A suite owns its files' content: a frontmatter value edit through the
      // panel path is refused and the registered file stays as authored. The
      // routing flip that is legal on agents has its own test below.
      const edited = plugin.rawText.replace('description: Review code', 'description: Reviewed elsewhere')
      await expect(panels.agents.update(plugin.id!, edited)).rejects.toThrow('only the enable state can be changed')
      expect(await readFile(plugin.path, 'utf8')).toBe(plugin.rawText)
      expect((await panels.agents.get(plugin.id!))?.metadata.model).toBe('vendor/model')
      // The document body is the suite's regardless of the frontmatter.
      const rewritten = plugin.rawText.replace('Review carefully.', 'Rewrite instead')
      await expect(panels.agents.update(plugin.id!, rewritten)).rejects.toThrow('the suite owns their content')
      // The one legal edit is the enable state: flipping only the key lands...
      const switched = plugin.rawText.replace('---\n', '---\ndisabled: true\n')
      await panels.agents.update(plugin.id!, switched)
      await catalog.notifyPanelsChanged()
      expect(await readFile(plugin.path, 'utf8')).toBe(switched)
      expect((await panels.agents.get(plugin.id!))?.disabled).toBe(true)
      // ...and flipping it back by the same rule is legal too.
      await panels.agents.update(plugin.id!, plugin.rawText)
      await catalog.notifyPanelsChanged()
      expect(await readFile(plugin.path, 'utf8')).toBe(plugin.rawText)
      expect((await panels.agents.get(plugin.id!))?.disabled).toBe(false)
      // A malformed document never reaches the file, whatever the gate says.
      await expect(panels.agents.update(plugin.id!, '---\nmodel: [\n---\nReview carefully.')).rejects.toThrow()
      expect(await readFile(plugin.path, 'utf8')).toBe(plugin.rawText)
      await catalog.setSurface('active', 'v1-suite', 'agents', false)
      expect((await panels.agents.get(plugin.id!))?.disabled).toBe(true)
      // Deleting a plugin-owned entry is a suite-management concern, not a
      // panel action: the removal is refused and the registered file stays.
      await expect(panels.agents.remove(plugin.id!)).rejects.toThrow('managed by their suite')
      await catalog.notifyPanelsChanged()
      expect(await panels.agents.list()).toHaveLength(2)
      await expect(panels.agents.update('["../../etc"]', 'x')).rejects.toThrow('Unknown installed')
      expect((await panels.skills.list()).some(row => row.origin === 'plugin')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('plugin persona allows the routing flip but rejects content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-panels-'))
    try {
      await mkdir(join(root, '.sources', 'active'), { recursive: true })
      await cp('tests/fixtures/v1-suite', join(root, '.sources', 'active'), { recursive: true })
      // Extension-surface agents live under the client namespace directory
      // (Agent Plugins §8.2); the portable dialect does not read a root `agents/`.
      await mkdir(join(root, '.sources', 'active', 'com.deepseek.harness', 'agents'), { recursive: true })
      await writeFile(
        join(root, '.sources', 'active', 'com.deepseek.harness', 'agents', 'reviewer.md'),
        '---\ndescription: Review code\nmodel: vendor/model\ntools: [read, search]\n---\nReview carefully.'
      )
      await writeFile(
        join(root, 'state.json'),
        JSON.stringify({
          version: 1,
          sources: [{ id: 'active', url: join(root, '.sources', 'active'), local: true }],
          installed: { 'active/v1-suite': { enabled: true, installedAt: new Date(0).toISOString() } }
        })
      )
      const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), agentsRoot: join(root, 'agents'), onChanged: () => {} })
      await catalog.load()
      const panels = createPanelResources(catalog, createUserPanelStores(root))
      const plugin = (await panels.agents.list()).find(row => row.origin === 'plugin')!
      // A persona's model routing is panel-editable even on a suite file: the
      // structured controls add the effort key and the write lands.
      const routed = plugin.rawText.replace('---\n', '---\nreasoning_effort: high\n')
      await panels.agents.update(plugin.id!, routed)
      expect(await readFile(plugin.path, 'utf8')).toBe(routed)
      await catalog.notifyPanelsChanged()
      expect((await panels.agents.get(plugin.id!))?.metadata.reasoning_effort).toBe('high')
      // The body is still the suite's.
      const rewritten = routed.replace('Review carefully.', 'Rewrite instead')
      await expect(panels.agents.update(plugin.id!, rewritten)).rejects.toThrow('the suite owns their content')
      // Routing controls never reach other frontmatter: `tools` is not a panel key.
      const tooled = routed.replace('tools: [read, search]', 'tools: [read]')
      await expect(panels.agents.update(plugin.id!, tooled)).rejects.toThrow('only the enable state can be changed')
      expect(await readFile(plugin.path, 'utf8')).toBe(routed)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('edits a directory-shaped user skill through its name id, keeping the cross-tool spelling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-panels-'))
    try {
      const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), agentsRoot: join(root, 'agents'), onChanged: () => {} })
      await catalog.load()
      const dir = join(root, 'skills', 'canonical')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'SKILL.md'), '---\nname: canonical\ndescription: cross-tool shape\n---\nBody')
      const panels = createPanelResources(catalog, createUserPanelStores(root))

      const row = (await panels.skills.list()).find(entry => entry.origin === 'user')
      expect(row?.name).toBe('canonical')
      // A user entry carries no id: the client addresses it by name.
      expect(row?.id).toBeUndefined()

      const changed = '---\nname: canonical\ndescription: edited\n---\nChanged'
      await panels.skills.update('canonical', changed)
      expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toBe(changed)

      await panels.skills.remove('canonical')
      expect((await panels.skills.list()).some(entry => entry.origin === 'user')).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
