/**
 * What a preset's summary line counts.
 *
 * The line sits above the faces and has to agree with them: suites in the unit the market
 * face totals, one style, and the instruction files — including the ones the host will not
 * inject, which a bare count would hide.
 */
import { describe, expect, it } from 'vitest'

import type { ExtensionResource } from '../../market-contracts/src/contracts/extension-presets.js'
import { presetCoverage } from '../../market-ui/src/features/extension-presets/resource.js'

function row(overrides: Partial<ExtensionResource> & Pick<ExtensionResource, 'id' | 'face'>): ExtensionResource {
  return { name: overrides.id, source: 'src', available: true, globalEnabled: true, detail: { kind: 'suite', sourceId: 'src', suiteId: 'x' }, ...overrides }
}

describe('preset coverage', () => {
  it('counts suites the way the market face does, not every switched id', () => {
    // A suite carries its children: counting them produced a number the face's own filter
    // tabs could not explain.
    const rows = [row({ id: 'market:src/one', face: 'market' }), row({ id: 'skills:src/one/a', face: 'skills', suiteResourceId: 'market:src/one' })]
    expect(presetCoverage(rows, ['market:src/one', 'skills:src/one/a']).suites).toBe(1)
  })

  it('names the style the preset carries, and whether it can take effect', () => {
    const ready = [row({ id: 'outputStyles:brief', face: 'outputStyles', name: 'Brief' })]
    expect(presetCoverage(ready, ['outputStyles:brief'])).toMatchObject({ style: 'Brief', styleInEffect: true })
    expect(presetCoverage(ready, []).style).toBeUndefined()
    // A suite style whose text was never captured is listed but injects nothing: the
    // summary must not claim it applies.
    const pending = [row({ id: 'outputStyles:suite/src/a', face: 'outputStyles', name: 'teaching-style', available: false })]
    expect(presetCoverage(pending, ['outputStyles:suite/src/a'])).toMatchObject({ style: 'teaching-style', styleInEffect: false })
  })

  it('reports instruction files the host will not inject', () => {
    const rows = [
      row({ id: 'instructions:user-global/./AGENTS.md', face: 'instructions' }),
      row({ id: 'instructions:project/./AGENTS.md', face: 'instructions', available: false })
    ]
    expect(presetCoverage(rows, [])).toMatchObject({ files: 2, missingFiles: 1 })
  })
})
