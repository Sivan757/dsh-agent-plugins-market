import { describe, expect, it } from 'vitest'
import { projectExtensionSuites } from '../src/application/extension-suite-selection.js'
import { pluginResourceId } from '../src/application/panel-resources.js'
import { captureExtensionSelection } from '../src/contracts/extension-presets.js'
import { effectiveSurfaces, type Suite } from '../src/model/types.js'

const parent = 'market:source/suite'
const entry = (kind: 'skills' | 'commands' | 'agents', name: string) => kind + ':' + pluginResourceId('source', 'suite', kind, name)
function suite(): Suite {
  return {
    sourceId: 'source',
    id: 'suite',
    root: '/suite',
    dimension: 'user',
    enabled: false,
    activeSurfaces: effectiveSurfaces({ skills: false, commands: false, agents: false, mcp: false, lsp: false, hooks: false }),
    manifest: { id: 'suite', name: 'Suite', layout: 'agent-plugin-v1', path: '/suite/plugin.json', startupSkill: 'one' },
    skills: ['one', 'two'].map(name => ({ name, file: '/suite/' + name, directory: '/suite', description: name, invocation: { modelInvocable: true, userInvocable: false } })),
    resources: {
      commands: [
        { name: 'one', file: '/suite/command.md' },
        { name: 'two', file: '/suite/two.md' }
      ],
      agents: [{ name: 'one', file: '/suite/agent.md' }]
    },
    mcp: {
      schema: 'test',
      servers: {
        db: {
          type: 'streamable-http',
          url: 'https://example.test',
          auth: { enabled: false },
          disabledTools: ['delete'],
          enabledTools: ['read'],
          headers: { Authorization: '${TOKEN}' }
        },
        other: { type: 'stdio', command: 'other' }
      }
    },
    lsp: { servers: { ts: { key: 'ts', command: 'ts', args: [], extensionToLanguage: { '.ts': 'typescript' } } } },
    hooks: { events: { SessionStart: [{ hooks: [{ type: 'command', command: 'hook' }] }] } },
    systemPrompt: 'suite prompt',
    surfaces: { skills: 2, commands: 2, agents: 1, mcp: 2, lsp: 1, hooks: 1 },
    errors: ['diagnostic retained']
  }
}
const selected = (...ids: string[]) => captureExtensionSelection(null, ids)

describe('pure extension suite projection', () => {
  it('restores explicitly selected ordinary-off declarations without changing originals or global defaults', () => {
    const original = suite()
    const before = structuredClone(original)
    const [result] = projectExtensionSuites(
      [{ suite: original, validSurfaces: effectiveSurfaces(undefined) }],
      selected(parent, entry('skills', 'one'), entry('commands', 'one'), entry('agents', 'one'), 'mcp:plugin:source/suite/db', 'lsp:source/suite/ts')
    )
    expect(result!.globalEnabled).toBe(false)
    expect(result!.globalSurfaces).toEqual(before.activeSurfaces)
    expect(result!.suite.enabled).toBe(true)
    expect(result!.suite.activeSurfaces).toEqual(effectiveSurfaces(undefined))
    expect(result!.suite.skills.map(row => row.name)).toEqual(['one'])
    expect(result!.suite.resources!.commands.map(row => row.name)).toEqual(['one'])
    expect(result!.suite.resources!.agents.map(row => row.name)).toEqual(['one'])
    expect(Object.keys(result!.suite.mcp!.servers)).toEqual(['db'])
    expect(result!.suite.mcp!.servers.db).toEqual(before.mcp!.servers.db)
    expect(result!.suite.skills[0]!.invocation).toEqual(before.skills[0]!.invocation)
    result!.suite.mcp!.servers.db!.disabledTools!.push('new')
    result!.globalSurfaces.commands = true
    expect(original).toEqual(before)
  })
  it('requires source-qualified parent and entry identities and keeps an explicit empty selection empty', () => {
    const candidates = [{ suite: suite(), validSurfaces: effectiveSurfaces(undefined) }]
    expect(projectExtensionSuites(candidates, selected(entry('commands', 'one')))).toEqual([])
    expect(projectExtensionSuites(candidates, selected())).toEqual([])
    const [result] = projectExtensionSuites(candidates, selected(parent, 'commands:one', 'mcp:db'))
    expect(result!.suite.resources!.commands).toEqual([])
    expect(result!.suite.mcp!.servers).toEqual({})
    expect(result!.suite.activeSurfaces.commands).toBe(false)
    expect(result!.suite.manifest.startupSkill).toBeUndefined()
  })
  it('does not override invalid surfaces even when selected and preserves unrelated valid surfaces', () => {
    const original = suite()
    const [result] = projectExtensionSuites(
      [{ suite: original, validSurfaces: effectiveSurfaces({ commands: false, mcp: false, hooks: false }) }],
      selected(parent, entry('commands', 'one'), entry('agents', 'one'), 'mcp:plugin:source/suite/db')
    )
    expect(result!.suite.activeSurfaces.commands).toBe(false)
    expect(result!.suite.resources!.commands).toEqual([])
    expect(result!.suite.activeSurfaces.agents).toBe(true)
    expect(result!.suite.mcp!.servers).toEqual({})
    expect(result!.suite.hooks).toBeUndefined()
    expect(result!.suite.errors).toEqual(original.errors)
  })
  it('uses the LSP spec key shared by status and mounting, not its storage table alias', () => {
    const original = suite()
    const spec = original.lsp!.servers.ts!
    original.lsp!.servers = { tableAlias: spec }
    const candidates = [{ suite: original, validSurfaces: effectiveSurfaces(undefined) }]
    expect(projectExtensionSuites(candidates, selected(parent, 'lsp:source/suite/ts'))[0]!.suite.lsp!.servers).toEqual({ tableAlias: spec })
    expect(projectExtensionSuites(candidates, selected(parent, 'lsp:source/suite/tableAlias'))[0]!.suite.lsp!.servers).toEqual({})
  })
  it('admits a project suite hook only through its own row identity, and an installed suite through its parent', () => {
    const project = suite()
    project.dimension = 'project'
    const candidates = [{ suite: project, validSurfaces: effectiveSurfaces(undefined) }]
    const hookId = 'hooks:source/suite/SessionStart/0'
    // The session window exposes one row per command hook here, so the parent grant
    // alone admits none of them: a control that is presented must be enforced.
    expect(projectExtensionSuites(candidates, selected(parent))[0]!.suite.hooks).toBeUndefined()
    expect(projectExtensionSuites(candidates, selected(parent))[0]!.suite.activeSurfaces.hooks).toBe(false)
    // A declaration position that no longer exists grants nothing.
    expect(projectExtensionSuites(candidates, selected(parent, 'hooks:source/suite/SessionStart/7'))[0]!.suite.hooks).toBeUndefined()
    expect(projectExtensionSuites(candidates, selected(parent, 'hooks:source/suite/Stop/0'))[0]!.suite.hooks).toBeUndefined()
    // The exact identity keeps the declaration, and the numbering the inventory published.
    const [granted] = projectExtensionSuites(candidates, selected(parent, hookId))
    expect(granted!.suite.hooks).toEqual(project.hooks)
    expect(granted!.suite.activeSurfaces.hooks).toBe(true)
    // An installed user suite has no individual rows, so its parent grant still admits its hooks.
    const installed = suite()
    expect(projectExtensionSuites([{ suite: installed, validSurfaces: effectiveSurfaces(undefined) }], selected(parent))[0]!.suite.hooks).toEqual(installed.hooks)
  })
  it('never enables project LSP or invents missing declarations from counts', () => {
    const original = suite()
    original.dimension = 'project'
    delete original.resources
    delete original.hooks
    const [result] = projectExtensionSuites([{ suite: original, validSurfaces: effectiveSurfaces(undefined) }], selected(parent, entry('commands', 'one'), 'lsp:source/suite/ts'))
    expect(result!.suite.activeSurfaces.lsp).toBe(false)
    expect(result!.suite.lsp!.servers).toEqual({})
    expect(result!.suite.resources).toEqual({ commands: [], agents: [] })
    expect(result!.suite.activeSurfaces.commands).toBe(false)
    expect(result!.suite.activeSurfaces.hooks).toBe(false)
  })
})
