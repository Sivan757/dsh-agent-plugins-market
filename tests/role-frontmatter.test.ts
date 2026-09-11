import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { readRoleFields, updateFrontmatter, updateRoleReasoning } from '../src/client/features/personas/frontmatter.js'

describe('role metadata editing', () => {
  it('changes routing fields without corrupting nested metadata, comments or Markdown', () => {
    const body = '\n# Role\n\nUse $ARGUMENTS.\n'
    const original = `---\n# keep this\nname: reviewer\ntools:\n  - Read\n  - Grep\nmetadata:\n  tier: 2\n  flags: [true, false]\nmodel: old\n---\n${body}`
    const updated = updateFrontmatter(original, 'model', 'deepseek/deepseek-chat')
    expect(updated).toContain('# keep this')
    expect(updated.endsWith(body)).toBe(true)
    expect(parse(updated.split('---\n')[1]!)).toEqual({ name: 'reviewer', tools: ['Read', 'Grep'], metadata: { tier: 2, flags: [true, false] }, model: 'deepseek/deepseek-chat' })
    // `tools` stays in the document but is no longer surfaced: the executor never applies it.
    expect(readRoleFields(updated)).toEqual({ model: 'deepseek/deepseek-chat', provider: '', reasoningEffort: '' })
  })

  it('adds frontmatter to plain Markdown and supports clearing a model', () => {
    const text = updateFrontmatter('Role body\n', 'model', 'inherit')
    expect(readRoleFields(text).model).toBe('inherit')
    expect(readRoleFields(updateFrontmatter(text, 'model', '')).model).toBe('')
    expect(updateFrontmatter('Role body\n', 'model', '')).toBe('Role body\n')
  })

  it('toggles disabled without rewriting nested keys or a sequence into strings', () => {
    const original = '---\nmetadata:\n  disabled: no\ntools: [Read, Grep]\ndisabled: false\n---\nBody\n'
    const changed = updateFrontmatter(original, 'disabled', true)
    expect(parse(changed.split('---\n')[1]!)).toEqual({ metadata: { disabled: 'no' }, tools: ['Read', 'Grep'], disabled: true })
  })

  it('fails closed on malformed metadata', () => {
    expect(() => updateFrontmatter('---\nmodel: [\n---\nbody', 'model', 'new')).toThrow()
    expect(() => readRoleFields('---\n- invalid\n---\nbody')).toThrow('mapping')
    expect(() => readRoleFields('---\nmodel: x')).toThrow('Unclosed')
  })

  it('reads effort aliases and saves one canonical key without changing the role body', () => {
    const original = '---\n# retain\nmodel: p/m\nreasoningEffort: high\nmetadata: {tier: 2}\n---\nRole body\n'
    expect(readRoleFields(original).reasoningEffort).toBe('high')
    const updated = updateRoleReasoning(original, 'low')
    expect(updated).toContain('# retain')
    expect(updated.endsWith('Role body\n')).toBe(true)
    expect(parse(updated.split('---\n')[1]!)).toEqual({ model: 'p/m', reasoning_effort: 'low', metadata: { tier: 2 } })
    expect(readRoleFields(updateRoleReasoning(updated, '')).reasoningEffort).toBe('')
    expect(updateRoleReasoning('Role body', '')).toBe('Role body')
    expect(() => readRoleFields('---\nreasoning_effort: low\nreasoningEffort: high\n---\nRole')).toThrow('conflict')
    expect(() => readRoleFields('---\nreasoning_effort: false\n---\nRole')).toThrow('non-empty string')
  })
})
