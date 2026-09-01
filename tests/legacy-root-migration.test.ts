import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { migrateLegacyDataRoot } from '../src/catalog/legacy-root-migration.js'

describe('legacy data-root migration', () => {
  it('moves data and overrides under the user root and removes the empty legacy root', async () => {
    const legacy = await mkdtemp(join('/tmp', 'legacy-root-'))
    const dataRoot = await mkdtemp(join('/tmp', 'data-root-'))
    await mkdir(join(legacy, 'overrides'), { recursive: true })
    await mkdir(join(legacy, 'data', 'cloudflare'), { recursive: true })
    await writeFile(join(legacy, 'overrides', 'cloudflare.json'), '{"a":1}')
    await writeFile(join(legacy, 'data', 'cloudflare', 'db.sqlite'), 'bytes')

    await migrateLegacyDataRoot(legacy, dataRoot)

    expect(await readFile(join(dataRoot, 'overrides', 'cloudflare.json'), 'utf8')).toBe('{"a":1}')
    expect(await readFile(join(dataRoot, 'data', 'cloudflare', 'db.sqlite'), 'utf8')).toBe('bytes')
    expect(existsSync(legacy)).toBe(false)
  })

  it('is a no-op when the legacy root is absent', async () => {
    const dataRoot = await mkdtemp(join('/tmp', 'data-root-'))
    await migrateLegacyDataRoot(join(dataRoot, 'does-not-exist'), dataRoot)
    expect(existsSync(join(dataRoot, 'data'))).toBe(false)
  })

  it('merges into an existing target without clobbering and keeps foreign legacy files', async () => {
    const legacy = await mkdtemp(join('/tmp', 'legacy-root-'))
    const dataRoot = await mkdtemp(join('/tmp', 'data-root-'))
    await mkdir(join(legacy, 'overrides'), { recursive: true })
    await writeFile(join(legacy, 'overrides', 'new.json'), 'new')
    await mkdir(join(dataRoot, 'overrides'), { recursive: true })
    await writeFile(join(dataRoot, 'overrides', 'existing.json'), 'existing')
    // A file the migration does not own keeps the legacy root alive.
    await writeFile(join(legacy, 'keep-me.txt'), 'x')

    await migrateLegacyDataRoot(legacy, dataRoot)

    expect(await readFile(join(dataRoot, 'overrides', 'new.json'), 'utf8')).toBe('new')
    expect(await readFile(join(dataRoot, 'overrides', 'existing.json'), 'utf8')).toBe('existing')
    expect(existsSync(join(legacy, 'keep-me.txt'))).toBe(true)
    await rm(legacy, { recursive: true, force: true })
  })
})
