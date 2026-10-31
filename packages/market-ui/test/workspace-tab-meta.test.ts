/**
 * The tab metadata: one table, and two rows that read from it.
 *
 * The workspace row, the preset manager and the install confirmation each used to
 * carry their own label map, so a renamed tab could survive in one of them. These
 * assertions pin the parts that made the drift possible.
 */
import { describe, expect, it } from 'vitest'

import { WORKSPACE_TAB_KEYS } from '../../market-contracts/src/contracts/tab-layout.js'
import { en, zh } from '../../market-ui/src/locales.js'
import { PRESET_FACES, WORKSPACE_TAB_META, faceOfWorkspaceKey, workspaceKeyOfFace } from '../../market-ui/src/workspace/tab-meta.js'

describe('workspace tab metadata', () => {
  it('names every tab in the contract, in both languages', () => {
    for (const key of WORKSPACE_TAB_KEYS) {
      const meta = WORKSPACE_TAB_META[key]
      expect(meta, key).toBeDefined()
      expect(zh[meta.label], key).toBeTruthy()
      expect(en[meta.label], key).toBeTruthy()
      if (meta.surface !== undefined) {
        expect(zh[meta.surface], key).toBeTruthy()
        expect(en[meta.surface], key).toBeTruthy()
      }
    }
    expect(Object.keys(WORKSPACE_TAB_META).sort()).toEqual([...WORKSPACE_TAB_KEYS].sort())
  })

  it('maps each preset face to one tab and back', () => {
    const seen = new Set<string>()
    for (const face of PRESET_FACES) {
      const key = workspaceKeyOfFace(face)
      expect(key, face).toBeDefined()
      expect(seen.has(key!), face).toBe(false)
      seen.add(key!)
      expect(faceOfWorkspaceKey(key!)).toBe(face)
    }
    expect(seen.size).toBe(PRESET_FACES.length)
  })

  it('leaves the prompt layer out of the preset row', () => {
    // A preset switches what a suite installs; the prompt layer is authored in the
    // workspace and cannot be installed, so it has no face and no preset face.
    for (const key of ['instructions', 'outputStyles'] as const) {
      expect(WORKSPACE_TAB_META[key].presetFace).toBeUndefined()
      expect(PRESET_FACES).not.toContain(key as never)
    }
  })
})
