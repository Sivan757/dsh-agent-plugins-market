import { describe, expect, it } from 'vitest'
import { skillEntryRejection, withSkillName } from '../src/scanning/skills-parse.js'

describe('withSkillName', () => {
  it('supplies the name a panel draft omits', () => {
    const draft = '---\ndescription: writes release notes\n---\n\nSummarize the commits since the last tag.\n'
    const named = withSkillName(draft, 'release-notes')
    expect(named).toBe('---\nname: release-notes\ndescription: writes release notes\n---\n\nSummarize the commits since the last tag.\n')
    // The repaired document is one the shared reader accepts.
    expect(skillEntryRejection(named)).toBeUndefined()
  })

  it('keeps a name the document already declares', () => {
    const text = '---\nname: other\ndescription: d\n---\nbody'
    expect(withSkillName(text, 'release-notes')).toBe(text)
  })

  it("keeps the document's own line endings", () => {
    expect(withSkillName('---\r\ndescription: d\r\n---\r\nbody', 'notes')).toBe('---\r\nname: notes\r\ndescription: d\r\n---\r\nbody')
  })

  it('gives a body-only document the block it was missing', () => {
    expect(withSkillName('Just a body.', 'notes')).toBe('---\nname: notes\n---\n\nJust a body.')
  })

  it('fills an empty block', () => {
    expect(withSkillName('---\n---\nbody', 'notes')).toBe('---\nname: notes\n---\nbody')
  })

  it('leaves frontmatter this parser cannot read exactly as written', () => {
    const text = '---\ndescription: [unclosed\n---\nbody'
    expect(withSkillName(text, 'notes')).toBe(text)
  })

  it('ignores a name the skill grammar would reject', () => {
    const text = '---\ndescription: d\n---\nbody'
    expect(withSkillName(text, 'Bad Name')).toBe(text)
  })
})
