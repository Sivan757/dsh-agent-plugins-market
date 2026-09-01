import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { migrateLegacyDataRoot } from '../src/catalog/legacy-root-migration.js'

describe('legacy data-root migration', () => {
  it('moves data and overrides under the user root and removes the empty legacy root', async () => {
    const legacy = await mkdtemp(join('/tmp', 'legacy-root-'))
    const userRoot = await mkdtemp(join('/tmp', 'user-root-'))
    await mkdir(join(legacy, 'overrides'), { recursive: true })
    await mkdir(join(legacy, 'data', 'cloudflare'), { recursive: true })
    await writeFile(join(legacy, 'overrides', 'cloudflare.json'), '{"a":1}')
    await writeFile(join(legacy, 'data', 'cloudflare', 'db.sqlite'), 'bytes')

    await migrateLegacyDataRoot(legacy, userRoot)

    expect(await readFile(join(userRoot, 'overrides', 'cloudflare.json'), 'utf8')).toBe('{"a":1}')
    expect(await readFile(join(userRoot, 'data', 'cloudflare', 'db.sqlite'), 'utf8')).toBe('bytes')
    expect(existsSync(legacy)).toBe(false)
  })

  it('is a no-op when the legacy root is absent', async () => {
    const userRoot = await mkdtemp(join('/tmp', 'user-root-'))
    await migrateLegacyDataRoot(join(userRoot, 'does-not-exist'), userRoot)
    expect(existsSync(join(userRoot, 'data'))).toBe(false)
  })

  it('merges into an existing target without clobbering and keeps foreign legacy files', async () => {
    const legacy = await mkdtemp(join('/tmp', 'legacy-root-'))
    const userRoot = await mkdtemp(join('/tmp', 'user-root-'))
    await mkdir(join(legacy, 'overrides'), { recursive: true })
    await writeFile(join(legacy, 'overrides', 'new.json'), 'new')
    await mkdir(join(userRoot, 'overrides'), { recursive: true })
    await writeFile(join(userRoot, 'overrides', 'existing.json'), 'existing')
    // A file the migration does not own keeps the legacy root alive.
    await writeFile(join(legacy, 'keep-me.txt'), 'x')

    await migrateLegacyDataRoot(legacy, userRoot)

    expect(await readFile(join(userRoot, 'overrides', 'new.json'), 'utf8')).toBe('new')
    expect(await readFile(join(userRoot, 'overrides', 'existing.json'), 'utf8')).toBe('existing')
    expect(existsSync(join(legacy, 'keep-me.txt'))).toBe(true)
    await rm(legacy, { recursive: true, force: true })
  })
})
