import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Filesystem-call counters for the row-cache tests, plus a lever for the
 * unreadable-document case.
 *
 * A warm panel read used to re-read every suite document and stat every row;
 * a call count is the honest way to show that it no longer does (a timing
 * assertion would pass on a fast machine either way). `unreadable` makes one
 * path fail its read the way a file the process may not open does, without
 * depending on the runner's user or umask.
 */
const fsCounts = vi.hoisted(() => ({ readFile: 0, stat: 0, unreadable: new Set<string>() }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      fsCounts.readFile += 1
      const [path] = args
      if (typeof path === 'string' && fsCounts.unreadable.has(path)) {
        return Promise.reject(Object.assign(new Error(`EACCES: permission denied, open '${path}'`), { code: 'EACCES' }))
      }
      return actual.readFile(...args)
    },
    stat: (...args: Parameters<typeof actual.stat>) => {
      fsCounts.stat += 1
      return actual.stat(...args)
    }
  }
})
import { Catalog } from '../src/application/catalog.js'
import { ROW_CACHE_MAX_AGE_MS, createPanelResources } from '../src/application/panel-resources.js'
import { createUserPanelStores } from '../src/runtime/panels/user-panels.js'
import { SuiteSkillProvider } from '../src/runtime/surfaces/skills-provider.js'
import { readCommands } from '../src/runtime/surfaces/commands-mounts.js'
import { agentRoleCatalog } from '../src/runtime/agents/agent-role-router.js'

afterEach(() => {
  fsCounts.unreadable.clear()
})

/** A temp user root with the v1-suite fixture checked out as the installed local source `active`. */
async function installedFixtureRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(root, '.sources', 'active'), { recursive: true })
  await cp('tests/fixtures/v1-suite', join(root, '.sources', 'active'), { recursive: true })
  await writeFile(
    join(root, 'state.json'),
    JSON.stringify({
      version: 1,
      sources: [{ id: 'active', url: join(root, '.sources', 'active'), local: true }],
      installed: { 'active/v1-suite': { enabled: true, installedAt: new Date(0).toISOString() } }
    })
  )
  return root
}

/** Catalog options over one fixture root, with the clock seam under test control. */
function catalogOptions(root: string, now?: () => number): ConstructorParameters<typeof Catalog>[0] {
  return {
    userRoot: root,
    dataRoot: join(root, 'data'),
    agentsRoot: join(root, 'agents'),
    onChanged: () => {},
    // Far longer than the row bound, so time alone is what ages the rows out.
    userSnapshotTtlMs: 60_000,
    ...(now === undefined ? {} : { now })
  }
}

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
      // The list read ships no document: the entry read is what carries it.
      expect(plugin.rawText).toBeUndefined()
      const authored = (await panels.agents.get(plugin.id!))!.rawText!
      expect(authored).toContain('description: Review code')
      // A suite owns its files' content: a frontmatter value edit through the
      // panel path is refused and the registered file stays as authored. The
      // routing flip that is legal on agents has its own test below.
      const edited = authored.replace('description: Review code', 'description: Reviewed elsewhere')
      await expect(panels.agents.update(plugin.id!, edited)).rejects.toThrow('only the enable state can be changed')
      expect(await readFile(plugin.path, 'utf8')).toBe(authored)
      expect((await panels.agents.get(plugin.id!))?.metadata.model).toBe('vendor/model')
      // The document body is the suite's regardless of the frontmatter.
      const rewritten = authored.replace('Review carefully.', 'Rewrite instead')
      await expect(panels.agents.update(plugin.id!, rewritten)).rejects.toThrow('the suite owns their content')
      // The one legal edit is the enable state: flipping only the key lands...
      const switched = authored.replace('---\n', '---\ndisabled: true\n')
      await panels.agents.update(plugin.id!, switched)
      await catalog.notifyPanelsChanged()
      expect(await readFile(plugin.path, 'utf8')).toBe(switched)
      expect((await panels.agents.get(plugin.id!))?.disabled).toBe(true)
      // ...and flipping it back by the same rule is legal too.
      await panels.agents.update(plugin.id!, authored)
      await catalog.notifyPanelsChanged()
      expect(await readFile(plugin.path, 'utf8')).toBe(authored)
      expect((await panels.agents.get(plugin.id!))?.disabled).toBe(false)
      // A malformed document never reaches the file, whatever the gate says.
      await expect(panels.agents.update(plugin.id!, '---\nmodel: [\n---\nReview carefully.')).rejects.toThrow()
      expect(await readFile(plugin.path, 'utf8')).toBe(authored)
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

  it.each(['skills', 'commands', 'agents'] as const)('persists a plugin %s toggle without bypassing its suite controls', async kind => {
    const root = await mkdtemp(join(tmpdir(), 'market-panel-toggle-'))
    try {
      const source = join(root, '.sources', 'active')
      await mkdir(source, { recursive: true })
      await cp('tests/fixtures/v1-suite', source, { recursive: true })
      await writeFile(
        join(root, 'state.json'),
        JSON.stringify({
          version: 1,
          sources: [{ id: 'active', url: source, local: true }],
          installed: { 'active/v1-suite': { enabled: true, installedAt: new Date(0).toISOString() } }
        })
      )
      const options = { userRoot: root, dataRoot: join(root, 'data'), agentsRoot: join(root, 'agents'), onChanged: () => {} }
      const catalog = new Catalog(options)
      await catalog.load()
      const panel = createPanelResources(catalog, createUserPanelStores(root))[kind]
      const entry = (await panel.list()).find(row => row.origin === 'plugin')!
      expect(entry.disabled).toBe(false)
      const runtimeEnabled = async (manager: Catalog): Promise<boolean> => {
        if (kind === 'skills') {
          const skill = (await new SuiteSkillProvider(manager).list({})).find(candidate => candidate.name === entry.name)
          return skill !== undefined && (skill.invocation.modelInvocable || skill.invocation.userInvocable)
        }
        if (kind === 'commands') return (await readCommands(source, [{ name: entry.name, file: entry.path }])).length > 0
        const roles = await createPanelResources(manager, createUserPanelStores(root)).agents.list()
        return (await agentRoleCatalog(roles, new AbortController().signal)).length > 0
      }
      expect(await runtimeEnabled(catalog)).toBe(true)
      const controls = kind === 'skills' ? 'disable-model-invocation: true\nuser-invocable: false\n' : 'disabled: true\n'
      const authored = (await panel.get(entry.id!))!.rawText!
      const off = authored.replace('---\n', '---\n' + controls)
      await panel.update(entry.id!, off)
      await catalog.notifyPanelsChanged()
      expect((await panel.get(entry.id!))?.disabled).toBe(true)
      expect(await runtimeEnabled(catalog)).toBe(false)
      expect(await readFile(entry.path, 'utf8')).toBe(off)

      const restarted = new Catalog(options)
      await restarted.load()
      const reloaded = createPanelResources(restarted, createUserPanelStores(root))[kind]
      expect((await reloaded.get(entry.id!))?.disabled).toBe(true)
      expect(await runtimeEnabled(restarted)).toBe(false)
      await reloaded.update(entry.id!, authored)
      await restarted.notifyPanelsChanged()
      expect((await reloaded.get(entry.id!))?.disabled).toBe(false)
      expect(await runtimeEnabled(restarted)).toBe(true)

      await restarted.setSurface('active', 'v1-suite', kind, false)
      expect(await reloaded.get(entry.id!)).toMatchObject({ disabled: true })
      await restarted.setSurface('active', 'v1-suite', kind, true)
      await restarted.setEnabled('active', 'v1-suite', false)
      expect(await reloaded.get(entry.id!)).toMatchObject({ disabled: true })
      await restarted.setEnabled('active', 'v1-suite', true)
      expect(await reloaded.get(entry.id!)).toMatchObject({ disabled: false })
      await expect(reloaded.update(entry.id!, authored + '\nChanged body')).rejects.toThrow('the suite owns their content')
      await expect(reloaded.remove(entry.id!)).rejects.toThrow('managed by their suite')
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
      const routed = (await panels.agents.get(plugin.id!))!.rawText!.replace('---\n', '---\nreasoning_effort: high\n')
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

  it('drops every document from the list read and keeps it on the entry read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-panels-wire-'))
    try {
      await mkdir(join(root, '.sources', 'active'), { recursive: true })
      await cp('tests/fixtures/v1-suite', join(root, '.sources', 'active'), { recursive: true })
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
      const panel = createPanelResources(catalog, createUserPanelStores(root)).skills
      const [row] = await panel.list()
      if (row === undefined) throw new Error('expected the fixture skill')
      // The document was most of the response; the list answers with the row.
      expect(row.rawText).toBeUndefined()
      expect(row.content).toBeUndefined()
      // Why: sending every document made one list read several times the size
      // of the rows it described, and only an opened entry needs the text.
      const detail = await panel.get(row.id ?? row.name)
      expect(detail?.rawText).toBe(await readFile(row.path, 'utf8'))
      const listBody = JSON.stringify({ entries: await panel.list() })
      expect(listBody).not.toContain('references/guide.md')
      expect(JSON.stringify(detail)).toContain('references/guide.md')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serves repeated reads without touching the files, and an edit is visible at once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-panels-cache-'))
    try {
      await mkdir(join(root, '.sources', 'active'), { recursive: true })
      await cp('tests/fixtures/v1-suite', join(root, '.sources', 'active'), { recursive: true })
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
      const panel = createPanelResources(catalog, createUserPanelStores(root)).agents
      const [first] = await panel.list()
      if (first === undefined) throw new Error('expected the fixture persona')

      // The client re-reads while translations land: those reads must not walk
      // every suite document again.
      fsCounts.readFile = 0
      fsCounts.stat = 0
      const repeated = await panel.read()
      expect(fsCounts.readFile).toBe(0)
      expect(fsCounts.stat).toBe(0)
      expect(repeated.entries).toEqual(await panel.list())

      // A catalog change is one invalidation input: the surface toggle has to
      // land on the rows without this store writing anything.
      expect(first.disabled).toBe(false)
      await catalog.setSurface('active', 'v1-suite', 'agents', false)
      expect((await panel.get(first.id!))?.disabled).toBe(true)
      await catalog.setSurface('active', 'v1-suite', 'agents', true)
      expect((await panel.get(first.id!))?.disabled).toBe(false)

      // The store's own mutation is the other: the edit must never read back
      // the rows the cache holds, with no catalog notification and no TTL wait.
      const authored = (await panel.get(first.id!))!.rawText!
      await panel.update(first.id!, authored.replace('---\n', '---\ndisabled: true\n'))
      expect((await panel.get(first.id!))?.disabled).toBe(true)
      expect(await readFile(first.path, 'utf8')).toContain('disabled: true')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('drops the raw user store document from the list wire and keeps it on the entry read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-panels-user-wire-'))
    try {
      const catalog = new Catalog(catalogOptions(root))
      await catalog.load()
      const users = createUserPanelStores(root)
      await users.commands.create('deploy', '---\ndescription: Deploy the fixture\n---\nBODYTEXT')
      const panel = createPanelResources(catalog, users).commands

      const [row] = await panel.list()
      if (row === undefined) throw new Error('expected the user command')
      // The raw store hands the panel both spellings of the document it read:
      // the file as authored, and its frontmatter-stripped body. The list ships
      // neither — the body alone was most of a real panel's list response.
      expect(row.rawText).toBeUndefined()
      expect(row.content).toBeUndefined()
      expect(JSON.stringify(row)).not.toContain('BODYTEXT')

      // The raw store keeps carrying it: a command's payload is built from
      // `content`, and that is not what this wire strip governs.
      expect((await users.commands.list())[0]?.content).toBe('BODYTEXT')

      // The entry read is what an editor seeds from, so it keeps both.
      const detail = await panel.get('deploy')
      expect(detail?.rawText).toContain('BODYTEXT')
      expect(detail?.content).toBe('BODYTEXT')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('re-derives rows once the row-cache bound lapses, and not before', async () => {
    const root = await installedFixtureRoot('market-panels-age-')
    try {
      const clock = { now: 1_000 }
      const catalog = new Catalog(catalogOptions(root, () => clock.now))
      await catalog.load()
      const panel = createPanelResources(catalog, createUserPanelStores(root)).agents
      const row = (await panel.list()).find(entry => entry.origin === 'plugin')
      if (row === undefined) throw new Error('expected the fixture persona')
      const authored = await readFile(row.path, 'utf8')
      // A hand edit: no panel mutation and no catalog notification, and the
      // snapshot TTL is far longer than the row bound, so nothing but the row
      // cache's own age can make this visible.
      await writeFile(row.path, authored.replace('description: Review code changes', 'description: Edited on disk'))
      const description = async (): Promise<string | undefined> => (await panel.list()).find(entry => entry.id === row.id)?.description

      fsCounts.readFile = 0
      // Inside the bound the memo answers: that is what keeps a translation
      // poll cheap, and the age is stated here rather than inherited from the
      // snapshot TTL.
      expect(await description()).toBe('Review code changes')
      expect(fsCounts.readFile).toBe(0)
      clock.now += ROW_CACHE_MAX_AGE_MS
      expect(await description()).toBe('Review code changes')
      expect(fsCounts.readFile).toBe(0)

      // One millisecond past it the rows are too old to serve, so the read
      // re-derives them and the hand edit lands.
      clock.now += 1
      expect(await description()).toBe('Edited on disk')
      expect(fsCounts.readFile).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('re-reads every row when the read is forced, at any age', async () => {
    const root = await installedFixtureRoot('market-panels-force-')
    try {
      const catalog = new Catalog(catalogOptions(root))
      await catalog.load()
      const panel = createPanelResources(catalog, createUserPanelStores(root)).agents
      const row = (await panel.list()).find(entry => entry.origin === 'plugin')
      if (row === undefined) throw new Error('expected the fixture persona')
      const authored = await readFile(row.path, 'utf8')
      await writeFile(row.path, authored.replace('description: Review code changes', 'description: Edited on disk'))

      // A forced read is the Refresh button: it must never be answered from a
      // memo that is well inside its bound.
      fsCounts.readFile = 0
      const forced = await panel.read(false, true)
      expect(forced.entries.find(entry => entry.id === row.id)?.description).toBe('Edited on disk')
      expect(fsCounts.readFile).toBeGreaterThan(0)

      // The scan it ran replaces the memo, so the ordinary read after it is
      // served the same fresh rows.
      fsCounts.readFile = 0
      expect((await panel.list()).find(entry => entry.id === row.id)?.description).toBe('Edited on disk')
      expect(fsCounts.readFile).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('answers the entry read from one revision of its document', async () => {
    const root = await installedFixtureRoot('market-panels-detail-')
    try {
      const catalog = new Catalog(catalogOptions(root))
      await catalog.load()
      const users = createUserPanelStores(root)
      const panel = createPanelResources(catalog, users).agents
      const row = (await panel.list()).find(entry => entry.origin === 'plugin')
      if (row === undefined) throw new Error('expected the fixture persona')
      const authored = await readFile(row.path, 'utf8')
      // A hand edit behind the panel's back, while the row cache is warm.
      const edited = authored.replace('description: Review code changes', 'description: Edited on disk').replace('---\n', '---\ndisabled: true\n')
      await writeFile(row.path, edited)

      const detail = await panel.get(row.id!)
      const stats = await stat(row.path)
      // One revision: the document and every field read out of it come from
      // the same read. Mixing them was the defect — new text, old metadata.
      expect(detail?.rawText).toBe(edited)
      expect(detail?.description).toBe('Edited on disk')
      expect(detail?.disabled).toBe(true)
      expect(detail?.metadata).toMatchObject({ description: 'Edited on disk', disabled: true })
      expect(detail?.updatedAt).toBe(new Date(stats.mtimeMs).toISOString())

      // The user-authored half is re-derived by the store that owns it, so the
      // same rule holds there: body, description, and state move together.
      await users.commands.create('deploy', '---\ndescription: authored\n---\nBODYONE')
      const commands = createPanelResources(catalog, users).commands
      const userRow = (await commands.list()).find(entry => entry.origin === 'user')
      if (userRow === undefined) throw new Error('expected the user command')
      await writeFile(userRow.path, '---\ndescription: edited\n---\nBODYTWO')
      const userDetail = await commands.get('deploy')
      expect(userDetail?.rawText).toContain('BODYTWO')
      expect(userDetail?.content).toBe('BODYTWO')
      expect(userDetail?.description).toBe('edited')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed when the document it would rewrite cannot be read', async () => {
    const root = await installedFixtureRoot('market-panels-unreadable-')
    try {
      const catalog = new Catalog(catalogOptions(root))
      await catalog.load()
      const panel = createPanelResources(catalog, createUserPanelStores(root)).agents
      const row = (await panel.list()).find(entry => entry.origin === 'plugin')
      if (row === undefined) throw new Error('expected the fixture persona')
      const authored = await readFile(row.path, 'utf8')

      // The directory stays writable while the document cannot be read — the
      // case a temp-file-plus-rename write would happily replace.
      fsCounts.unreadable.add(row.path)
      await expect(panel.get(row.id!)).rejects.toThrow('EACCES')
      await expect(panel.update(row.id!, authored.replace('Review carefully.', 'Replaced anyway'))).rejects.toThrow('EACCES')

      // Nothing was diffed against a stale copy, and nothing was written.
      fsCounts.unreadable.delete(row.path)
      expect(await readFile(row.path, 'utf8')).toBe(authored)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
