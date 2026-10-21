/**
 * The root `.pnpmfile.cjs` exists for one resolution problem in the dev tree
 * only, and the risk of a pnpmfile is that it quietly rewrites manifests this
 * repository does not own. This test drives the hook itself, so a broadened
 * condition fails here instead of changing resolution unnoticed.
 *
 * The condition it pins: exactly one package's hook-protocol peer edge moves,
 * and the version written comes from that package's own peer declaration, so
 * a baseline bump needs no edit to the hook.
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { hooks } = require('../../../../.pnpmfile.cjs') as {
  hooks: { readPackage(pkg: Record<string, unknown> | Package): Package }
}
const BRIDGE = '@deepseek-ai/dsh-hooks-claude-code'
const PROTOCOL = '@deepseek-ai/dsh-hook-protocol'

interface Package {
  name?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/** A manifest shaped like the bridge's own, at a version no constant in the hook names. */
function bridge(protocolVersion: string, other?: Record<string, string>): Package {
  return {
    name: BRIDGE,
    dependencies: { '@deepseek-ai/dsh-llm': protocolVersion },
    peerDependencies: { ...other, [PROTOCOL]: protocolVersion }
  }
}

describe('dev-tree pnpmfile hook', () => {
  it('moves the bridge protocol peer edge to a dependency at the version the bridge declares', () => {
    const result = hooks.readPackage(bridge('9.9.9-rc.1'))
    expect(result.peerDependencies).not.toHaveProperty(PROTOCOL)
    expect(result.dependencies).toMatchObject({ [PROTOCOL]: '9.9.9-rc.1' })
    expect(result.peerDependencies).toMatchObject({})
  })

  it('leaves every other package manifest untouched', () => {
    const unrelated: Package = {
      name: 'some-other-plugin',
      dependencies: { [PROTOCOL]: '0.2.0-rc.2' },
      peerDependencies: { [PROTOCOL]: '>=0.2.0-rc.2 <0.3.0-0' }
    }
    expect(hooks.readPackage(unrelated)).toEqual({
      name: 'some-other-plugin',
      dependencies: { [PROTOCOL]: '0.2.0-rc.2' },
      peerDependencies: { [PROTOCOL]: '>=0.2.0-rc.2 <0.3.0-0' }
    })
  })

  it('keeps the other peer edges of the bridge where they are', () => {
    const result = hooks.readPackage(bridge('0.2.1-rc.2', { '@deepseek-ai/dsh-llm': '0.2.1-rc.2' }))
    expect(result.peerDependencies).toMatchObject({ '@deepseek-ai/dsh-llm': '0.2.1-rc.2' })
    expect(result.dependencies).toMatchObject({ '@deepseek-ai/dsh-llm': '0.2.1-rc.2' })
  })

  it('does nothing for a bridge manifest that declares no protocol peer', () => {
    const result = hooks.readPackage({ name: BRIDGE, peerDependencies: {} })
    expect(result).toEqual({ name: BRIDGE, peerDependencies: {} })
  })

  // The scope cases above use invented manifests. This case runs the hook over the
  // manifest pnpm actually reads for the dev-only bridge, so a condition that stopped
  // matching the real package fails here (AC-110-11).
  it('rewrites the real installed bridge manifest at the version it declares', async () => {
    const manifestPath = createRequire(import.meta.url).resolve(`${BRIDGE}/package.json`)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Package
    const declared = manifest.peerDependencies?.[PROTOCOL]
    expect(declared, 'the installed bridge no longer declares a protocol peer, so the hook has no work').toBeDefined()
    const before = manifest.peerDependencies ?? {}
    const result = hooks.readPackage(structuredClone(manifest))
    // The value comes from the manifest, so no version constant can drift here.
    expect(result.dependencies).toMatchObject({ [PROTOCOL]: declared })
    expect(result.peerDependencies).not.toHaveProperty(PROTOCOL)
    // Exactly one peer entry left the table.
    expect(Object.keys(result.peerDependencies ?? {})).toHaveLength(Object.keys(before).length - 1)
    // Every other peer edge kept its value.
    for (const [name, version] of Object.entries(before)) {
      if (name === PROTOCOL) continue
      expect(result.peerDependencies?.[name], name).toBe(version)
    }
  })
})
