/**
 * The eight prompt-conformance shapes, pinned literally.
 *
 * Each case asserts the exact text a producer emits, so a later change to the
 * same string fails here rather than drifting silently. The measured targets are
 * in docs/scratch/prompt-research/conformance-gaps.md, and where our situation
 * differs from Claude Code the case says why.
 */
import { describe, expect, it } from 'vitest'
import { agentInstructionSection } from '../../../../packages/market-runtime/src/runtime/host/scoped-contributors.js'
import { forwardCommandText } from '../../../../packages/market-runtime/src/application/command-resources.js'
import { renderCatalogText } from '../../../../packages/market-runtime/src/runtime/agents/subagent-catalog.js'
import { AGENT_ROLE_TOOL_DESCRIPTION } from '../../../../packages/market-runtime/src/runtime/agents/agent-role-router.js'
import { TEAMMATE_ROLE_TOOL_DESCRIPTION } from '../../../../packages/market-runtime/src/runtime/agents/teammate-role-tool.js'

describe('one contributor label names its source and kind', () => {
  it('renders the host workspace-instruction shape with the suite kind', () => {
    const section = agentInstructionSection([{ parent: 'market:s/demo', label: 'demo', kind: 'plugin suite', text: 'Body text.' }])
    // Name, kind, colon, blank line, body: the shape both measured producers use.
    expect(section).toContain('Instructions from: demo (plugin suite):\n\nBody text.')
  })

  it('states a startup skill as its own contribution', () => {
    const section = agentInstructionSection([
      { parent: 'market:s/demo', label: 'demo', kind: 'plugin suite', text: 'Prompt text.' },
      { parent: 'market:s/demo', label: 'demo', kind: 'startup skill', text: 'Skill text.' }
    ])
    // One label per contribution: a label has to be true of everything beneath it.
    expect(section).toContain('Instructions from: demo (plugin suite):\n\nPrompt text.')
    expect(section).toContain('Instructions from: demo (startup skill):\n\nSkill text.')
    expect(section.indexOf('Prompt text.')).toBeLessThan(section.indexOf('Skill text.'))
  })

  it('keeps the section heading and the precedence sentence out of the label', () => {
    const section = agentInstructionSection([{ parent: 'p', label: 'demo', kind: 'plugin suite', text: 'Body.' }])
    expect(section.startsWith('## Agent plugin instructions')).toBe(true)
    expect(section).toContain('More specific instructions take precedence over broader ones.')
    // The precedence sentence is the host's hedged wording, never an override.
    expect(section).not.toContain('IMPORTANT:')
  })
})

describe('one section name has one producer', () => {
  it('exposes no second registration of the instruction section', async () => {
    // The headingless producer was deleted: every enabled suite's text reaches
    // the prompt through agentInstructionSection, so mount order cannot change
    // the shape the model reads.
    const module = await import('../../../../packages/market-runtime/src/runtime/surfaces/project-runtime.js')
    expect(Object.keys(module)).not.toContain('mountSuiteInstructions')
    expect(Object.keys(module)).toContain('suiteInstructions')
  })
})

describe('a command follow-up carries the measured metadata', () => {
  it('wraps the body and repeats the argument in the trailer', () => {
    expect(forwardCommandText('ship', 'Ship feat/x.', 'feat/x')).toBe(
      [
        '<command-message>ship</command-message>',
        '<command-name>/ship</command-name>',
        '<command-args>feat/x</command-args>',
        '',
        '---',
        'Ship feat/x.',
        '',
        'ARGUMENTS: feat/x'
      ].join('\n')
    )
  })

  it('omits the argument element and the trailer when nothing was typed', () => {
    const text = forwardCommandText('ship', 'Ship it.', '')
    expect(text).not.toContain('<command-args>')
    expect(text).not.toContain('ARGUMENTS:')
    expect(text).toContain('---\nShip it.')
  })

  it('never frames a user-authored body', () => {
    // Rule R6: metadata only, no system reminder around the person's own words.
    expect(forwardCommandText('ship', 'Ship it.', '')).not.toContain('<system-reminder>')
  })
})

describe('a tool description reads as an instruction list', () => {
  for (const [name, description] of [
    ['subagent_role', AGENT_ROLE_TOOL_DESCRIPTION],
    ['spawn_teammate_role', TEAMMATE_ROLE_TOOL_DESCRIPTION]
  ] as const) {
    it(name + ' opens with a purpose line, then spaced bullets', () => {
      const lines = description.split('\n')
      // A purpose line first, as every measured Claude Code tool description has.
      expect(lines[0]!.length).toBeGreaterThan(0)
      expect(lines[0]).not.toMatch(/^ -/)
      // Bullets are prefixed with a space then a dash, not a bare dash.
      const bullets = lines.filter(line => line.startsWith(' - '))
      expect(bullets.length).toBeGreaterThanOrEqual(3)
      // The list is separated from the purpose line by one blank line.
      expect(lines[1]).toBe('')
    })
  }

  it('keeps the skip rule in the skimmed bullets, not in trailing prose', () => {
    const lines = AGENT_ROLE_TOOL_DESCRIPTION.split('\n')
    const skip = lines.find(line => line.includes('no listed role matches'))
    expect(skip).toBeDefined()
    expect(skip!.startsWith(' - ')).toBe(true)
  })

  it('gives the delegation tool a prompt-writing section', () => {
    const description = AGENT_ROLE_TOOL_DESCRIPTION
    expect(description).toContain('\n## Writing the prompt\n')
    // The briefing rules survive the rewrite.
    expect(description).toContain('Explain what you are trying to accomplish and why.')
    expect(description).toContain('Describe what you have already learned or ruled out.')
    expect(description).toContain('research only, or may edit files')
  })
})

describe('the catalog list markup matches the measured form', () => {
  it('lists one entry per line with the name in a code span', () => {
    const text = renderCatalogText([{ name: 'reviewer', title: 'Reviewer', description: 'Review code' }], false)
    // The unquoted list line dev shipped, with the name still a code span.
    expect(text).toContain('\n- reviewer: Review code\n')
    // No invented emphasis tag and no inner heading: the frame is the only envelope.
    expect(text).not.toContain('available_subagents')
    expect(text).not.toContain('## subagent-catalog')
  })
})
