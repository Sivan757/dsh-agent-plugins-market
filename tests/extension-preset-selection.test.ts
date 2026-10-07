import { describe, expect, it } from 'vitest'
import {
  captureExtensionSelection,
  parseExtensionPresetTransfer,
  serializeExtensionPresetTransfer,
  selectionAllows,
  type ExtensionPreset,
  type ExtensionSelection
} from '../packages/market-contracts/src/contracts/extension-presets.js'

const preset = (): ExtensionPreset => ({ id: 'front', name: '前端开发', revision: 1, enabledIds: ['skills:react', 'mcp:browser', 'market:source/frontend'] })

describe('extension preset selection', () => {
  it('copies a preset into a session without keeping a live reference', () => {
    const source = preset()
    const captured = captureExtensionSelection(source, [])
    source.enabledIds.push('skills:later')
    source.name = 'Renamed'
    expect(captured.presetName).toBe('前端开发')
    expect(selectionAllows(captured, 'skills:later')).toBe(false)
    expect(selectionAllows(captured, 'skills:react')).toBe(true)
  })

  it('captures current global choices when no preset is selected', () => {
    const enabled = ['skills:react']
    const captured = captureExtensionSelection(null, enabled)
    enabled.push('mcp:later')
    expect(captured).toEqual({ presetId: null, presetName: null, presetRevision: null, modified: false, enabledIds: ['skills:react'] })
    expect(selectionAllows(captured, 'mcp:later')).toBe(false)
  })

  it('keeps sessions independent and never turns unavailable resources back on', () => {
    const a = captureExtensionSelection(preset(), [])
    const b = captureExtensionSelection(preset(), [])
    a.enabledIds.length = 0
    expect(selectionAllows(b, 'skills:react')).toBe(true)
    expect(selectionAllows(b, 'skills:react', false)).toBe(false)
  })

  it('distinguishes absent session selection from an explicit empty selection', () => {
    const empty: ExtensionSelection = captureExtensionSelection(null, [])
    expect(selectionAllows(undefined, 'skills:react')).toBe(true)
    expect(selectionAllows(empty, 'skills:react')).toBe(false)
    expect(selectionAllows(undefined, 'skills:react', false)).toBe(false)
  })
})

describe('extension preset clipboard boundary', () => {
  it('copies only portable selection and name, never identity or extra configuration', () => {
    const input = { ...preset(), token: 'not-exported', command: '/private/run' }
    const text = serializeExtensionPresetTransfer(input)
    expect(text).not.toContain('not-exported')
    expect(text).not.toContain('/private/run')
    const imported = parseExtensionPresetTransfer(text)
    expect(imported).toEqual({ name: '前端开发', enabledIds: ['market:source/frontend', 'mcp:browser', 'skills:react'] })
    expect(imported).not.toHaveProperty('id')
  })

  it('rejects unknown fields, invalid versions, malformed ids and oversized content', () => {
    const valid = JSON.parse(serializeExtensionPresetTransfer(preset())) as Record<string, unknown>
    for (const value of [
      { ...valid, version: 2 },
      { ...valid, credentials: {} },
      { ...valid, enabledIds: ['unknown:test'] },
      { ...valid, enabledIds: ['skills:bad\nname'] },
      { ...valid, name: '' }
    ]) {
      expect(() => parseExtensionPresetTransfer(JSON.stringify(value))).toThrow()
    }
    expect(() => parseExtensionPresetTransfer('invalid')).toThrow()
    expect(() => parseExtensionPresetTransfer(' '.repeat(65_537))).toThrow()
  })

  it('canonicalizes duplicate ids and preserves unknown-but-well-formed resource identities', () => {
    const source = { ...preset(), enabledIds: ['skills:missing', 'skills:missing', 'lsp:direct/typescript'] }
    expect(parseExtensionPresetTransfer(serializeExtensionPresetTransfer(source)).enabledIds).toEqual(['lsp:direct/typescript', 'skills:missing'])
  })
})
