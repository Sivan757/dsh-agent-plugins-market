import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Catalog } from '../packages/market-bundle/src/application/catalog.js'
import { createPanelResources } from '../packages/market-runtime/src/application/panel-resources.js'
import { createUserPanelStores } from '../packages/market-runtime/src/runtime/panels/user-panels.js'

describe('panel read locale resolution', () => {
  it('resolves the host locale once per read, not once per row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-panel-locale-'))
    try {
      let reads = 0
      const catalog = new Catalog({
        userRoot: root,
        dataRoot: join(root, 'data'),
        agentsRoot: join(root, 'agents'),
        onChanged: () => {},
        ports: {
          localePreference: () => {
            reads += 1
            return 'zh'
          }
        }
      })
      await catalog.load()
      const users = createUserPanelStores(root)
      for (const name of ['alpha-skill', 'beta-skill', 'gamma-skill', 'delta-skill']) {
        await users.skills.create(name, `---\ndescription: ${name} description\n---\nBody`)
      }
      const panels = createPanelResources(catalog, users)
      expect((await panels.skills.read()).entries).toHaveLength(4)

      // Every row of one read serves the same preference. The host answers the
      // preference by projecting every profile entry's live configuration, so a
      // per-row read made a panel's latency scale with its row count.
      reads = 0
      expect((await panels.skills.read()).entries).toHaveLength(4)
      expect(reads).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
