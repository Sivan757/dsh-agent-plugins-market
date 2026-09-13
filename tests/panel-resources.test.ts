import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { createPanelResources } from '../src/application/panel-resources.js'
import { createUserPanelStores } from '../src/runtime/user-panels.js'

describe('installed and user panel resources', () => {
  it('projects installed resources, preserves structured metadata and applies edits/deletion to the registered file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-panels-'))
    try {
      for (const id of ['active', 'unused']) {
        await mkdir(join(root, '.sources', id), { recursive: true })
        await cp('tests/fixtures/v1-suite', join(root, '.sources', id), { recursive: true })
        await mkdir(join(root, '.sources', id, 'agents'), { recursive: true })
        await writeFile(
          join(root, '.sources', id, 'agents', 'reviewer.md'),
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
      const changed = plugin.rawText.replace('vendor/model', 'vendor/new-model')
      await panels.agents.update(plugin.id!, changed)
      await catalog.notifyPanelsChanged()
      expect(await readFile(plugin.path, 'utf8')).toBe(changed)
      expect((await panels.agents.get(plugin.id!))?.metadata.model).toBe('vendor/new-model')
      await expect(panels.agents.update(plugin.id!, '---\nmodel: [\n---\ntext')).rejects.toThrow()
      expect(await readFile(plugin.path, 'utf8')).toBe(changed)
      await catalog.setSurface('active', 'v1-suite', 'agents', false)
      expect((await panels.agents.get(plugin.id!))?.disabled).toBe(true)
      await panels.agents.remove(plugin.id!)
      await catalog.notifyPanelsChanged()
      expect(await panels.agents.list()).toHaveLength(1)
      await expect(panels.agents.update('["../../etc"]', 'x')).rejects.toThrow('Unknown installed')
      expect((await panels.skills.list()).some(row => row.origin === 'plugin')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
