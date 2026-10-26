/**
 * The extension selection surface reads a host service, not a host package.
 *
 * `extension-session-state.ts` needs the `sessionQuery` cordis augmentation, which
 * a type-only import carries, and it needs no runtime copy of the package: the
 * host owns the service. A value import there fails module evaluation in a profile
 * without the package, and it shipped that way in 0.12.0. The declaration stays an
 * optional peer because a profile may provide no service at all, which the seam
 * answers with `extension-session-query-unavailable`.
 */
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

const MODULE = '@deepseek-ai/dsh-session-query'

it('names the session-query package only in a type-only import', async () => {
  const source = await readFile(new URL('../src/runtime/host/extension-session-state.ts', import.meta.url), 'utf8')
  const mentions = [...source.matchAll(/^.*'@deepseek-ai\/dsh-session-query'.*$/gm)].map(match => match[0].trim())
  expect(mentions).toHaveLength(1)
  expect(mentions[0]).toMatch(/^import type\b/)
})

it('keeps the declaration an optional peer, because a profile may provide no service', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
  }
  expect(manifest.peerDependencies?.[MODULE]).toBeDefined()
  expect(manifest.peerDependenciesMeta?.[MODULE]?.optional).toBe(true)
})
