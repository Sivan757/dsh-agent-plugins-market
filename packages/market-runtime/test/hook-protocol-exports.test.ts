/**
 * The hooks executor imports eight values from @deepseek-ai/dsh-hook-protocol
 * and derives one type from the return value of `mergeHookOutputs`. The
 * package is self-provisioned with the support range, and that range resolves
 * to its floor, which is the copy a profile install gets (measured with the
 * repository-pinned pnpm 11.17.0). Every value this file imports must exist in
 * that copy, or the static import fails at module evaluation and the plugin
 * registers nothing.
 *
 * The second case pins the floor itself rather than the window. A window check
 * also passes against `0.2.1-rc.2`, which is the state that hid the defect, so
 * the floor is read from the declared range and compared exactly.
 *
 * The test reads the import list out of the real source file, so a name added
 * to the executor is covered without editing this test.
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const MODULE = '@deepseek-ai/dsh-hook-protocol'

/** Value names the hooks executor imports from the protocol package. */
async function importedValues(): Promise<string[]> {
  const source = await readFile(new URL('../src/runtime/surfaces/extension-hooks.ts', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@deepseek-ai\/dsh-hook-protocol'/g)]
  expect(imports).toHaveLength(1)
  const block = imports[0]?.[1]
  if (block === undefined) throw new Error('the hooks executor no longer imports the hook protocol')
  const names = block
    .split(',')
    .map(name => name.trim())
    .filter(name => name !== '')
    // `import { type X }` names a type, which is erased and carries no runtime export.
    .filter(name => !name.startsWith('type '))
  expect(names.length).toBeGreaterThan(0)
  return names
}

/** The version of the copy this repository resolves for the protocol package. */
async function installedVersion(): Promise<string> {
  const entry = import.meta.resolve(MODULE)
  // The published entry sits at <package root>/lib/index.js, so one level up names the root.
  const manifest = JSON.parse(await readFile(new URL('../package.json', entry), 'utf8')) as { version: string }
  return manifest.version
}

/** The version the declared support range resolves to: its lower bound. */
async function declaredFloor(): Promise<string> {
  const manifest = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const range = manifest.dependencies?.[MODULE]
  if (range === undefined) throw new Error(`package.json no longer declares ${MODULE} as a dependency`)
  const floor = /^>=\s*([^\s]+)/.exec(range)?.[1]
  if (floor === undefined) throw new Error(`cannot read a floor out of the declared range ${range}`)
  return floor
}

describe('hook protocol floor copy', () => {
  it('exports every value the hooks executor imports', async () => {
    const protocol = (await import(MODULE)) as Record<string, unknown>
    const names = await importedValues()
    for (const name of names) expect(protocol[name], name).toBeDefined()
  })

  it('resolves exactly the floor of the declared support range', async () => {
    // Exact, not a window check: the window also contains 0.2.1-rc.2, the copy
    // that made the reported install fail while every local run passed.
    expect(await installedVersion()).toBe(await declaredFloor())
  })
})
