/** Configuration parents never persist in a preset, a copy, or a session selection; their grants derive from children. */
import { describe, expect, it } from 'vitest'
import {
  CONFIGURATION_PARENT_IDS,
  captureExtensionSelection,
  parseExtensionPresetTransfer,
  serializeExtensionPresetTransfer,
  type ExtensionResource
} from '../packages/market-contracts/src/contracts/extension-presets.js'
import { extensionResourceEnabled } from '../packages/market-runtime/src/application/extension-authorization.js'
import { projectExtensionSuites, type ExtensionSuiteCandidate } from '../packages/market-runtime/src/application/extension-suite-selection.js'

const HOOKS_PARENT = 'market:@user-hooks/user-hooks'
const NATIVE_PARENT = 'market:native/agents-native'
const hookId = 'hooks:@user-hooks/user-hooks/PreToolUse/0'
const nativeSkillId = 'skills:' + JSON.stringify(['native', 'agents-native', 'skills', 'greet'])

const parentRow = (id: string, configuration: 'user-hooks' | 'project'): ExtensionResource => ({
  id,
  face: 'market',
  configuration,
  name: configuration,
  source: '@config',
  available: true,
  globalEnabled: true,
  detail: { kind: 'suite', sourceId: '@user-hooks', suiteId: 'user-hooks' }
})
const childRow = (id: string, suiteResourceId: string, face: ExtensionResource['face']): ExtensionResource => ({
  id,
  face,
  name: id,
  source: '@config',
  suiteResourceId,
  available: true,
  globalEnabled: true,
  detail: { kind: 'suite', sourceId: '@user-hooks', suiteId: 'user-hooks' }
})

describe('configuration parent ids', () => {
  it('enumerate the user hooks suite and every native project layout', () => {
    expect(CONFIGURATION_PARENT_IDS.has(HOOKS_PARENT)).toBe(true)
    expect(CONFIGURATION_PARENT_IDS.has(NATIVE_PARENT)).toBe(true)
    expect(CONFIGURATION_PARENT_IDS.has('market:demo/v1')).toBe(false)
  })

  it('never serializes a configuration parent into a copy, and drops it on paste', () => {
    const text = serializeExtensionPresetTransfer({ name: 'P', enabledIds: [HOOKS_PARENT, NATIVE_PARENT, hookId, nativeSkillId] })
    const parsed = parseExtensionPresetTransfer(text)
    expect(parsed.enabledIds).toEqual([hookId, nativeSkillId].sort())
    // A hand-written transfer carrying the old ids is cleaned, not rejected.
    const legacy = JSON.stringify({ format: 'dsh-agent-extension-preset', version: 1, name: 'P', enabledIds: [HOOKS_PARENT, hookId] })
    expect(parseExtensionPresetTransfer(legacy).enabledIds).toEqual([hookId])
  })

  it('captures a selection without configuration parents while preset ids survive', () => {
    const captured = captureExtensionSelection(null, [HOOKS_PARENT, hookId, NATIVE_PARENT, nativeSkillId])
    expect(captured.enabledIds).toEqual([hookId, nativeSkillId].sort())
    const preset = { id: 'p', name: 'P', revision: 1, enabledIds: ['market:demo/v1'] }
    expect(captureExtensionSelection(preset, []).enabledIds).toEqual(['market:demo/v1'])
  })

  it('grants a configuration parent through any selected child, and a child of one on its own id', () => {
    const parent = parentRow(HOOKS_PARENT, 'user-hooks')
    const hook = childRow(hookId, HOOKS_PARENT, 'hooks')
    const rows = [parent, hook]
    // The parent row itself: a legacy selection carrying the explicit parent id
    // keeps granting only while a child is also selected — the parent alone
    // grants nothing, and new selections never carry the id at all (the bridge
    // derives the same grant from the children when no row exists).
    const childSelection = { presetId: null, presetName: null, presetRevision: null, modified: false, enabledIds: [hookId] }
    expect(extensionResourceEnabled(parent, { ...childSelection, enabledIds: [hookId, HOOKS_PARENT] }, rows)).toBe(true)
    expect(extensionResourceEnabled(parent, { ...childSelection, enabledIds: [HOOKS_PARENT] }, rows)).toBe(false)
    // The child: its own id decides, no parent id required.
    expect(extensionResourceEnabled(hook, childSelection, rows)).toBe(true)
  })

  it('keeps the real-market-suite contract unchanged: child requires its selected, available parent', () => {
    const suite = { ...parentRow('market:demo/v1', 'project' as const), configuration: undefined, detail: { kind: 'suite' as const, sourceId: 'demo', suiteId: 'v1' } }
    const skill = childRow('skills:' + JSON.stringify(['demo', 'v1', 'skills', 'x']), 'market:demo/v1', 'skills')
    const rows = [suite, skill]
    const both = { presetId: null, presetName: null, presetRevision: null, modified: false, enabledIds: ['market:demo/v1', skill.id] }
    expect(extensionResourceEnabled(skill, both, rows)).toBe(true)
    expect(extensionResourceEnabled(skill, { ...both, enabledIds: [skill.id] }, rows)).toBe(false)
    expect(extensionResourceEnabled(skill, { ...both, enabledIds: [skill.id, 'market:demo/v1'] }, rows)).toBe(true)
    const disabledSuite = { ...suite, available: false }
    expect(extensionResourceEnabled(skill, both, [disabledSuite, skill])).toBe(false)
  })

  it('projects a configuration suite from child ids alone, in both spellings', () => {
    const hooksSuite = {
      sourceId: '@user-hooks',
      id: 'user-hooks',
      root: '/tmp/agents',
      dimension: 'user' as const,
      enabled: true,
      skills: [],
      resources: { commands: [], agents: [] },
      activeSurfaces: { skills: false, commands: false, agents: false, mcp: false, lsp: false, hooks: true },
      surfaces: { skills: 0, commands: 0, agents: 0, mcp: 0, lsp: 0, hooks: 1 },
      manifest: { layout: 'agent-plugin-v1' as const, path: 'x', id: 'user-hooks', name: 'user-hooks' },
      installedAt: 'user',
      errors: [],
      hooks: { events: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command' as const, command: 'echo x' }] }] } }
    }
    const candidates: ExtensionSuiteCandidate[] = [{ suite: hooksSuite, validSurfaces: { skills: false, commands: false, agents: false, mcp: false, lsp: false, hooks: true } }]
    const selection = { presetId: null, presetName: null, presetRevision: null, modified: false, enabledIds: [hookId] }
    const projected = projectExtensionSuites(candidates, selection)
    expect(projected).toHaveLength(1)
    expect(projected[0]!.suite.hooks).toBeDefined()
    const empty = projectExtensionSuites(candidates, { ...selection, enabledIds: [] })
    expect(empty).toHaveLength(0)
  })
})
