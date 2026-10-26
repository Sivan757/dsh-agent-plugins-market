import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
const exec = promisify(execFile)
const report = (text: string): { violations: unknown[] } => JSON.parse(text) as { violations: unknown[] }
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('keeps exact test-only host dependencies in dev while rejecting source imports without runtime declarations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'market-alignment-'))
  roots.push(root)
  await mkdir(join(root, 'scripts'))
  await mkdir(join(root, 'packages'))
  await writeFile(join(root, 'scripts/check-host-alignment.mjs'), await readFile(new URL('../../../../scripts/check-host-alignment.mjs', import.meta.url), 'utf8'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { '@deepseek-ai/dsh-agent-loop-testkit': '0.2.0-rc.2' } }))
  await writeFile(join(root, 'pnpm-workspace.yaml'), "minimumReleaseAgeExclude:\n  - '@deepseek-ai/dsh-agent-loop-testkit@0.2.0-rc.2'\n")
  const run = (...args: string[]) => exec(process.execPath, [join(root, 'scripts/check-host-alignment.mjs'), '--host-version', '0.2.0-rc.2', '--json', ...args], { cwd: root })
  expect(report((await run()).stdout).violations).toEqual([])
  await run('--fix')
  expect((JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { peerDependencies: unknown }).peerDependencies).toEqual({})
  await writeFile(join(root, 'packages/index.ts'), "import '@deepseek-ai/dsh-agent-loop-testkit'\n")
  try {
    await run()
    throw new Error('expected undeclared runtime import rejection')
  } catch (error) {
    expect(report((error as { stdout: string }).stdout).violations).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'undeclared' })]))
  }
  await writeFile(join(root, 'packages/index.ts'), '')
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { '@deepseek-ai/dsh-agent-loop-testkit': '0.1.0' } }))
  try {
    await run()
    throw new Error('expected stale development pin rejection')
  } catch (error) {
    expect(report((error as { stdout: string }).stdout).violations).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'dev-stale' })]))
  }
})

it('rejects the optional marker on a package imported for value and keeps it for a type-only import', async () => {
  const root = await mkdtemp(join(tmpdir(), 'market-alignment-optional-'))
  roots.push(root)
  await mkdir(join(root, 'scripts'))
  await mkdir(join(root, 'packages'))
  await writeFile(join(root, 'scripts/check-host-alignment.mjs'), await readFile(new URL('../../../../scripts/check-host-alignment.mjs', import.meta.url), 'utf8'))
  const manifest = (optional: boolean): string =>
    JSON.stringify({
      peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.2.0-rc.2 <0.3.0-0' },
      peerDependenciesMeta: optional ? { '@deepseek-ai/dsh-tools': { optional: true } } : {},
      devDependencies: { '@deepseek-ai/dsh-tools': '0.2.0-rc.2' }
    })
  await writeFile(join(root, 'package.json'), manifest(true))
  await writeFile(join(root, 'pnpm-workspace.yaml'), "minimumReleaseAgeExclude:\n  - '@deepseek-ai/dsh-tools@0.2.0-rc.2'\n")
  const run = (...args: string[]) => exec(process.execPath, [join(root, 'scripts/check-host-alignment.mjs'), '--host-version', '0.2.0-rc.2', '--json', ...args], { cwd: root })
  await writeFile(join(root, 'packages/index.ts'), "import { defineTool } from '@deepseek-ai/dsh-tools'\n")
  try {
    await run()
    throw new Error('expected optional value-import rejection')
  } catch (error) {
    expect(report((error as { stdout: string }).stdout).violations).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'optional-static' })]))
  }
  await run('--fix')
  const repaired = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    peerDependencies: Record<string, string>
    peerDependenciesMeta: Record<string, unknown>
  }
  expect(repaired.peerDependenciesMeta).toEqual({})
  expect(repaired.peerDependencies['@deepseek-ai/dsh-tools']).toBe('>=0.2.0-rc.2 <0.3.0-0')
  // The marker stays valid for a type-only import: it is erased, so the package carries no runtime obligation.
  await writeFile(join(root, 'package.json'), manifest(true))
  await writeFile(join(root, 'packages/index.ts'), "import type { ToolDefinition } from '@deepseek-ai/dsh-tools'\n")
  expect(report((await run()).stdout).violations).toEqual([])
})
