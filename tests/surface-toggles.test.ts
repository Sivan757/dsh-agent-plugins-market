import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ALL_SURFACES_ON, resolveSurfaceToggles, SURFACE_TOGGLE_KEYS } from '../src/contracts/surface-toggles.js'
import { loadSurfaceToggles, saveSurfaceToggles, surfaceTogglesPath } from '../src/application/state/surface-toggles.js'

describe('resolveSurfaceToggles', () => {
  it('defaults every surface to on for absent or malformed input', () => {
    expect(resolveSurfaceToggles(undefined)).toEqual(ALL_SURFACES_ON)
    expect(resolveSurfaceToggles('nope')).toEqual(ALL_SURFACES_ON)
    expect(resolveSurfaceToggles({ market: 'yes' })).toEqual(ALL_SURFACES_ON)
  })

  it('keeps known boolean keys and drops unknown ones', () => {
    expect(resolveSurfaceToggles({ mcp: false, lsp: false, mystery: true })).toEqual({
      ...ALL_SURFACES_ON,
      mcp: false,
      lsp: false
    })
  })
})

describe('surface toggle state roundtrip', () => {
  it('persists per workspace under a hashed file name in the data root', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'surface-toggles-'))
    const wsA = '/Users/sivan/workspace/alpha'
    const wsB = '/Users/sivan/workspace/beta'
    await saveSurfaceToggles(dataRoot, wsA, { ...ALL_SURFACES_ON, mcp: false, lsp: false })
    await saveSurfaceToggles(dataRoot, wsB, { ...ALL_SURFACES_ON, skills: false })

    const a = await loadSurfaceToggles(dataRoot, wsA)
    const b = await loadSurfaceToggles(dataRoot, wsB)
    expect(a.mcp).toBe(false)
    expect(a.lsp).toBe(false)
    expect(a.skills).toBe(true)
    expect(b.skills).toBe(false)
    expect(b.mcp).toBe(true)
    expect(surfaceTogglesPath(dataRoot, wsA)).not.toBe(surfaceTogglesPath(dataRoot, wsB))
    expect(surfaceTogglesPath(dataRoot, wsA)).not.toContain('alpha')
  })

  it('reads an all-on default when the workspace has no file', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'surface-toggles-'))
    expect(await loadSurfaceToggles(dataRoot, '/nowhere')).toEqual(ALL_SURFACES_ON)
  })

  it('degrades a hand-edited malformed file to the known keys', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'surface-toggles-'))
    const ws = '/Users/sivan/workspace/alpha'
    await saveSurfaceToggles(dataRoot, ws, { ...ALL_SURFACES_ON, agents: false })
    const path = surfaceTogglesPath(dataRoot, ws)
    const document = JSON.parse(await readFile(path, 'utf8')) as { toggles: Record<string, unknown> }
    document.toggles.market = 42
    document.toggles.unknown = true
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`)
    const loaded = await loadSurfaceToggles(dataRoot, ws)
    expect(loaded.agents).toBe(false)
    expect(loaded.market).toBe(true)
    expect(SURFACE_TOGGLE_KEYS.every(key => typeof loaded[key] === 'boolean')).toBe(true)
  })
})
