import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserPanelStores, UserPanelSkillProvider } from '../src/runtime/user-panels.js'
import { parseFrontmatterRecord, serializeFrontmatter } from '../src/runtime/user-store.js'

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

/** Bilingual-stub host translator for user-panel catalog strings. */
const tStub = (key: string, params?: Record<string, string>): string => {
  const dict: Record<string, string> = {
    userSkillDescription: '[user skill] {description}',
    userPersonaDescription: '[user persona] {description}'
  }
  let text = dict[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, value)
  }
  return text
}

describe('user panel skill provider', () => {
  it('surfaces only enabled skills, keeping personas out of the skill registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panels-'))
    try {
      const stores = createUserPanelStores(root)
      await stores.skills.create('notes', '---\nname: notes\ndescription: take notes\n---\nBody')
      await stores.skills.create('gone', '---\nname: gone\ndescription: vanished\ndisabled: true\n---\nBody')
      await stores.agents.create('reviewer', '---\ndescription: reviews code\n---\nPersona body')

      const provider = new UserPanelSkillProvider(stores.skills, tStub)
      const candidates = await provider.list({})
      const names = candidates.map(entry => entry.name).sort()
      expect(names).toEqual(['notes'])
      expect(candidates.find(entry => entry.name === 'notes')?.description).toBe('[user skill] take notes')

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
      await stores.skills.create('ok-name', '---\ndescription: fine\n---\nBody')
      // A stray underscored file on disk (written out-of-band) never reaches
      // discovery: the registry would drop or reject it.
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(root, 'user', 'skills', 'my_skill.md'), '---\ndescription: underscored\n---\nBody', 'utf8')
      const provider = new UserPanelSkillProvider(stores.skills, tStub)
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
