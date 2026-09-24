import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserPanelStores, UserPanelSkillProvider } from '../src/runtime/user-panels.js'
import { parseFrontmatterRecord, serializeFrontmatter } from '../src/application/user-store.js'

describe('user panel stores', () => {
  it('creates, lists, updates, disables, and deletes entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      const stores = createUserPanelStores(root)
      const created = await stores.skills.create('my-skill', '---\nname: my-skill\ndescription: does things\n---\nBody here')
      expect(created.name).toBe('my-skill')
      expect(created.description).toBe('does things')
      expect(created.disabled).toBe(false)

      const listed = await stores.skills.list()
      expect(listed.map(entry => entry.name)).toEqual(['my-skill'])

      // A duplicate name is refused.
      await expect(stores.skills.create('my-skill', 'x')).rejects.toThrow(/already exists/)

      // Disable through the frontmatter key; the body survives.
      await stores.skills.update('my-skill', '---\nname: my-skill\ndescription: does things\ndisabled: true\n---\nBody here')
      const disabled = await stores.skills.get('my-skill')
      expect(disabled?.disabled).toBe(true)
      expect(disabled?.content).toContain('Body here')

      await stores.skills.remove('my-skill')
      expect(await stores.skills.list()).toEqual([])
      // Idempotent delete.
      await stores.skills.remove('my-skill')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects names outside the entry grammar', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      const stores = createUserPanelStores(root)
      await expect(stores.commands.create('Bad Name', 'x')).rejects.toThrow(/invalid name/)
      await expect(stores.commands.create('-lead', 'x')).rejects.toThrow(/invalid name/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('user panel directory-shaped skills', () => {
  /** Write a skill the way other Agent tools do: one directory holding SKILL.md. */
  async function writeDirectorySkill(root: string, name: string, text: string): Promise<string> {
    const dir = join(root, 'skills', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), text, 'utf8')
    return dir
  }

  it('lists, edits, and deletes the document of a directory-shaped skill, leaving its resources in place', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      const dir = await writeDirectorySkill(root, 'skill-creator', '---\nname: skill-creator\ndescription: authors skills\n---\nBody')
      await mkdir(join(dir, 'references'), { recursive: true })
      await writeFile(join(dir, 'references', 'schemas.md'), 'schema notes')

      const stores = createUserPanelStores(root)
      const listed = await stores.skills.list()
      expect(listed.map(entry => [entry.name, entry.shape, entry.disabled])).toEqual([['skill-creator', 'skill-directory', false]])
      expect(listed[0]?.path).toBe(join(dir, 'SKILL.md'))
      expect(listed[0]?.description).toBe('authors skills')

      // Editing rewrites the document the panel serves, not a new flat sibling.
      await stores.skills.update('skill-creator', '---\nname: skill-creator\ndescription: authors skills\ndisabled: true\n---\nEdited body')
      expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toContain('Edited body')
      await expect(stat(join(root, 'skills', 'skill-creator.md'))).rejects.toThrow()
      expect((await stores.skills.get('skill-creator'))?.disabled).toBe(true)

      // Removal takes that document; files beside it belong to whichever tool authored the skill.
      await stores.skills.remove('skill-creator')
      expect(await stores.skills.list()).toEqual([])
      expect(await readFile(join(dir, 'references', 'schemas.md'), 'utf8')).toBe('schema notes')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('removes a skill directory once removal leaves it empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      const dir = await writeDirectorySkill(root, 'lonely', '---\nname: lonely\ndescription: alone\n---\nBody')
      const stores = createUserPanelStores(root)
      await stores.skills.remove('lonely')
      await expect(stat(dir)).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('prefers the directory spelling when a name exists in both shapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      await writeDirectorySkill(root, 'dual', '---\nname: dual\ndescription: directory copy\n---\nDirectory body')
      await writeFile(join(root, 'skills', 'dual.md'), '---\nname: dual\ndescription: flat copy\n---\nFlat body')

      const stores = createUserPanelStores(root)
      const resolved = await stores.skills.get('dual')
      expect(resolved?.shape).toBe('skill-directory')
      expect(resolved?.description).toBe('directory copy')
      expect((await stores.skills.list()).map(entry => entry.name)).toEqual(['dual'])

      await stores.skills.update('dual', '---\nname: dual\ndescription: edited\n---\nEdited')
      expect(await readFile(join(root, 'skills', 'dual', 'SKILL.md'), 'utf8')).toContain('Edited')
      expect(await readFile(join(root, 'skills', 'dual.md'), 'utf8')).toContain('Flat body')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('creates flat entries and refuses a name a directory already uses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      await writeDirectorySkill(root, 'taken', '---\nname: taken\ndescription: taken\n---\nBody')
      const stores = createUserPanelStores(root)
      await expect(stores.skills.create('taken', 'x')).rejects.toThrow(/already exists/)
      const created = await stores.skills.create('fresh', '---\nname: fresh\ndescription: fresh\n---\nBody')
      expect(created.shape).toBe('file')
      expect(await readFile(join(root, 'skills', 'fresh.md'), 'utf8')).toContain('Body')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the skills panel at top-level documents and directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      await mkdir(join(root, 'skills'), { recursive: true })
      await writeFile(join(root, 'skills', 'flat.md'), '---\nname: flat\ndescription: flat\n---\nBody')
      await writeDirectorySkill(root, 'top', '---\nname: top\ndescription: top\n---\nBody')
      await mkdir(join(root, 'skills', 'top', 'deep'), { recursive: true })
      await writeFile(join(root, 'skills', 'top', 'deep', 'nested.md'), '---\nname: nested\ndescription: nested\n---\nBody')

      const stores = createUserPanelStores(root)
      // The harness's own reader of this directory walks no deeper than one
      // level, so the panel serves the same files it does.
      expect((await stores.skills.list()).map(entry => entry.name).sort()).toEqual(['flat', 'top'])
      expect(await stores.skills.get('top/deep/nested')).toBeUndefined()
      expect(await stores.skills.get('nested')).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('nested user panel entries', () => {
  it('lists a nested command and persona by their relative paths and addresses them by that name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      await mkdir(join(root, 'commands', 'tools', 'git'), { recursive: true })
      await writeFile(join(root, 'commands', 'tools', 'git', 'commit.md'), '---\ndescription: commit staged work\n---\nCommit: $ARGUMENTS')
      await mkdir(join(root, 'agents', 'review'), { recursive: true })
      await writeFile(join(root, 'agents', 'review', 'code.md'), '---\ndescription: review code\n---\nReview the code')

      const stores = createUserPanelStores(root)
      expect((await stores.commands.list()).map(entry => entry.name)).toEqual(['tools/git/commit'])
      expect((await stores.agents.list()).map(entry => entry.name)).toEqual(['review/code'])

      const command = await stores.commands.get('tools/git/commit')
      expect(command?.path).toBe(join(root, 'commands', 'tools', 'git', 'commit.md'))
      expect(command?.description).toBe('commit staged work')

      // Update and remove address the document through the same nested name.
      await stores.commands.update('tools/git/commit', '---\ndescription: commit staged work\n---\nEdited: $ARGUMENTS')
      expect(await readFile(join(root, 'commands', 'tools', 'git', 'commit.md'), 'utf8')).toContain('Edited: $ARGUMENTS')
      expect((await stores.commands.get('tools/git/commit'))?.content).toContain('Edited: $ARGUMENTS')
      await stores.commands.remove('tools/git/commit')
      expect(await stores.commands.list()).toEqual([])
      // Removing the command leaves the persona, and the empty category directories, alone.
      expect((await stores.agents.list()).map(entry => entry.name)).toEqual(['review/code'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('creates a nested document at its relative path and refuses an occupied name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      const stores = createUserPanelStores(root)
      const created = await stores.commands.create('git/commit', '---\ndescription: commit staged work\n---\nBody')
      expect(created.name).toBe('git/commit')
      expect(created.shape).toBe('file')
      // The parent directory is created by the write itself.
      expect(await readFile(join(root, 'commands', 'git', 'commit.md'), 'utf8')).toContain('Body')
      await expect(stores.commands.create('git/commit', '---\ndescription: duplicate\n---\nBody')).rejects.toThrow(/already exists/)
      expect((await stores.commands.list()).map(entry => entry.name)).toEqual(['git/commit'])

      // A nested persona applies the panel's own per-segment grammar too.
      const persona = await stores.agents.create('review/code', '---\ndescription: review code\n---\nReview')
      expect(persona.name).toBe('review/code')
      expect(await readFile(join(root, 'agents', 'review', 'code.md'), 'utf8')).toContain('Review')
      await expect(stores.agents.create('review/my_code', '---\ndescription: x\n---\nBody')).rejects.toThrow(/invalid name/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects names outside the path grammar at every entry point', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      const stores = createUserPanelStores(root)
      for (const name of ['../x', '/x', 'a//b', 'a/../b', 'A/B', 'a\\b']) {
        await expect(stores.commands.create(name, '---\ndescription: x\n---\nBody')).rejects.toThrow(/invalid name/)
        await expect(stores.commands.update(name, '---\ndescription: x\n---\nBody')).rejects.toThrow(/invalid entry name/)
        await expect(stores.commands.remove(name)).rejects.toThrow(/invalid entry name/)
        expect(await stores.commands.get(name)).toBeUndefined()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('skips dot-directories, node_modules, and symlinks while walking nested panels', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    const outside = await mkdtemp(join(tmpdir(), 'panels-outside-'))
    try {
      await mkdir(join(root, 'commands', 'git'), { recursive: true })
      await writeFile(join(root, 'commands', 'git', 'commit.md'), '---\ndescription: commit\n---\nBody')
      await mkdir(join(root, 'commands', '.hidden'), { recursive: true })
      await writeFile(join(root, 'commands', '.hidden', 'secret.md'), '---\ndescription: secret\n---\nBody')
      await mkdir(join(root, 'commands', 'node_modules', 'pkg'), { recursive: true })
      await writeFile(join(root, 'commands', 'node_modules', 'pkg', 'tool.md'), '---\ndescription: tool\n---\nBody')
      await writeFile(join(outside, 'escape.md'), '---\ndescription: escape\n---\nBody')
      await symlink(outside, join(root, 'commands', 'linked'))

      const stores = createUserPanelStores(root)
      expect((await stores.commands.list()).map(entry => entry.name)).toEqual(['git/commit'])
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})

describe('user panel skill provider', () => {
  it('surfaces only enabled skills, keeping personas out of the skill registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      const stores = createUserPanelStores(root)
      await stores.skills.create('notes', '---\nname: notes\ndescription: take notes\n---\nBody')
      await stores.skills.create('gone', '---\nname: gone\ndescription: vanished\ndisabled: true\n---\nBody')
      await stores.agents.create('reviewer', '---\ndescription: reviews code\n---\nPersona body')

      const provider = new UserPanelSkillProvider(stores.skills)
      const candidates = await provider.list({})
      const names = candidates.map(entry => entry.name).sort()
      expect(names).toEqual(['notes'])
      expect(candidates.find(entry => entry.name === 'notes')?.description).toBe('take notes')

      const loaded = await provider.get(
        candidates.find(entry => entry.name === 'notes')!,
        {}
      )
      expect(loaded?.content).toBe('Body')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('skips entries whose names break the harness skill grammar', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      const stores = createUserPanelStores(root)
      await stores.skills.create('ok-name', '---\nname: ok-name\ndescription: fine\n---\nBody')
      // A stray underscored file on disk (written out-of-band) never reaches
      // discovery: the registry would drop or reject it.
      await writeFile(join(root, 'skills', 'my_skill.md'), '---\ndescription: underscored\n---\nBody', 'utf8')
      const provider = new UserPanelSkillProvider(stores.skills)
      const names = (await provider.list({})).map(entry => entry.name)
      expect(names).toEqual(['ok-name'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses underscored names for skills and agents, allows them for commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      const stores = createUserPanelStores(root)
      await expect(stores.skills.create('my_skill', 'x')).rejects.toThrow(/invalid name/)
      await expect(stores.agents.create('my_skill', 'x')).rejects.toThrow(/invalid name/)
      const command = await stores.commands.create('my_cmd', '---\ndescription: c\n---\nBody')
      expect(command.name).toBe('my_cmd')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('ranks ahead of the harness reader of this same directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      const stores = createUserPanelStores(root)
      await stores.skills.create('notes', '---\nname: notes\ndescription: take notes\n---\nBody')
      const provider = new UserPanelSkillProvider(stores.skills)
      const [candidate] = await provider.list({})
      if (candidate === undefined) throw new Error('expected the panel skill to list one candidate')
      // `dsh-skill-filesystem` maps `~/.agents/skills` at rank 500 and a lower
      // rank wins a duplicate name within one layer, so the panel's localized
      // description and name precedence apply to the entries it serves.
      expect(candidate.rank).toBeLessThan(500)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves relative resources beside a directory-shaped skill and serves both shapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      const dir = join(root, 'skills', 'canonical')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'SKILL.md'), '---\nname: canonical\ndescription: cross-tool shape\n---\nBody')
      const stores = createUserPanelStores(root)
      await stores.skills.create('notes', '---\nname: notes\ndescription: flat shape\n---\nFlat body')

      const provider = new UserPanelSkillProvider(stores.skills)
      const candidates = await provider.list({})
      expect(candidates.map(entry => entry.name).sort()).toEqual(['canonical', 'notes'])
      // A flat entry's resources live in the panel directory; a directory-shaped
      // skill owns its own, so `references/…` next to its SKILL.md resolves.
      expect(candidates.find(entry => entry.name === 'canonical')?.resourceBase).toEqual({ kind: 'directory', path: dir })
      expect(candidates.find(entry => entry.name === 'notes')?.resourceBase).toEqual({ kind: 'directory', path: join(root, 'skills') })

      const loaded = await provider.get(
        candidates.find(entry => entry.name === 'canonical')!,
        {}
      )
      expect(loaded?.content).toBe('Body')
      expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: dir })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('names an entry by what its document declares, and edits it through that name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      const dir = join(root, 'skills', 'renamed')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'SKILL.md'), '---\nname: original-name\ndescription: dir shape\n---\nBody')
      await writeFile(join(root, 'skills', 'legacy.md'), '---\nname: legacy-skill\ndescription: flat shape\n---\nFlat body')

      const stores = createUserPanelStores(root)
      const entries = await stores.skills.list()
      // The declared name is the entry's name; the path keeps the file identity.
      expect(entries.map(entry => [entry.name, entry.path])).toEqual([
        ['legacy-skill', join(root, 'skills', 'legacy.md')],
        ['original-name', join(dir, 'SKILL.md')]
      ])

      // The registry gets that same name, so one file is one skill.
      const provider = new UserPanelSkillProvider(stores.skills)
      const candidates = await provider.list({})
      expect(candidates.map(entry => entry.name)).toEqual(['legacy-skill', 'original-name'])

      const loaded = await provider.get(
        candidates.find(entry => entry.name === 'original-name')!,
        {}
      )
      expect(loaded?.content).toBe('Body')
      expect(loaded?.path).toBe(join(dir, 'SKILL.md'))

      // Editing and deleting resolve the declared name back to the file.
      await stores.skills.update('legacy-skill', '---\nname: legacy-skill\ndescription: edited\n---\nEdited body')
      expect(await readFile(join(root, 'skills', 'legacy.md'), 'utf8')).toContain('Edited body')
      await stores.skills.remove('original-name')
      expect(await stores.skills.list()).toHaveLength(1)
      await expect(stat(join(dir, 'SKILL.md'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads the harness invocation pair as the skills panel off state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      await mkdir(join(root, 'skills'), { recursive: true })
      const skill = (extra: string): string => `---\n${extra}\ndescription: shape\n---\nBody`
      // Both controls off is the state the panel switch writes.
      await writeFile(join(root, 'skills', 'both-off.md'), skill('name: both-off\ndisable-model-invocation: true\nuser-invocable: false'))
      // One control alone is an authoring choice, not the panel's off state.
      await writeFile(join(root, 'skills', 'model-off.md'), skill('name: model-off\ndisable-model-invocation: true'))
      await writeFile(join(root, 'skills', 'user-off.md'), skill('name: user-off\nuser-invocable: false'))
      // An entry an older release disabled still reads as off.
      await writeFile(join(root, 'skills', 'legacy.md'), skill('name: legacy\ndisabled: true'))
      // Commands are switched through `disabled`; the invocation pair is not their control.
      await mkdir(join(root, 'commands'), { recursive: true })
      await writeFile(join(root, 'commands', 'both-off.md'), skill('name: both-off\ndisable-model-invocation: true\nuser-invocable: false'))

      const stores = createUserPanelStores(root)
      expect((await stores.skills.list()).map(entry => [entry.name, entry.disabled])).toEqual([
        ['both-off', true],
        ['legacy', true],
        ['model-off', false],
        ['user-off', false]
      ])
      expect((await stores.commands.list()).map(entry => [entry.name, entry.disabled])).toEqual([['both-off', false]])

      const provider = new UserPanelSkillProvider(stores.skills)
      expect((await provider.list({})).map(entry => entry.name)).toEqual(['model-off', 'user-off'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps a document the harness reader would reject, disabled and with the reason', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      // Every document below is one the harness's `dsh-skill-filesystem`
      // reader drops from the same directory; publishing any of them would
      // advertise a skill only a market-equipped session can load.
      await mkdir(join(root, 'skills'), { recursive: true })
      await writeFile(join(root, 'skills', 'broken.md'), '---\nname: [\n---\nBody')
      await writeFile(join(root, 'skills', 'display.md'), '---\nname: My Skill\ndescription: display\n---\nBody')
      await writeFile(join(root, 'skills', 'nodesc.md'), '---\nname: nodesc\n---\nBody')
      await writeFile(join(root, 'skills', 'plain.md'), 'just prose\n')

      const stores = createUserPanelStores(root)
      const entries = await stores.skills.list()
      expect(entries.map(entry => [entry.name, entry.disabled])).toEqual([
        ['broken', true],
        ['display', true],
        ['nodesc', true],
        ['plain', true]
      ])
      expect(entries.map(entry => entry.metadata['validationError'])).toEqual([
        expect.stringContaining('Invalid frontmatter'),
        'invalid skill name "My Skill"',
        'frontmatter requires name and description',
        'missing YAML frontmatter'
      ])
      expect(await new UserPanelSkillProvider(stores.skills).list({})).toEqual([])

      // Listing it disabled is what keeps it fixable: the document stays
      // addressable by its panel name.
      expect((await stores.skills.get('plain'))?.content).toBe('just prose\n')
      await stores.skills.update('plain', '---\nname: plain\ndescription: fixed\n---\nBody')
      expect((await stores.skills.get('plain'))?.disabled).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('frontmatter helpers', () => {
  it('preserves structured YAML and rejects malformed metadata', () => {
    const parsed = parseFrontmatterRecord('---\ndescription: hi there\ndisabled: true\n---\nbody')
    expect(parsed).toEqual({ description: 'hi there', disabled: true })
    expect(parseFrontmatterRecord('---\ntools: [read, search]\nmodel: provider/model\n---\nBody')).toEqual({ tools: ['read', 'search'], model: 'provider/model' })
    expect(() => parseFrontmatterRecord('---\nbad: [\n---\nBody')).toThrow('Invalid frontmatter')
    expect(serializeFrontmatter({ b: true, a: 'x' })).toBe('---\na: x\nb: true\n---\n')
  })
})
