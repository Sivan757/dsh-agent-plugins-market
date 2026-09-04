import { createServer, type Server } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { crc32 } from 'node:zlib'
import { zipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { codeloadTarballUrl } from '../src/application/catalog.js'
import { archiveFormatOf, archiveInstall, downloadArchive } from '../src/catalog/archive.js'
import { deriveSourceIdCandidates } from '../src/catalog/paths.js'
import { loadState, saveState } from '../src/model/state.js'
import { resolveSourceKind } from '../src/model/types.js'

const run = promisify(execFile)

/**
 * Build a stored (uncompressed) zip by hand. fflate's `zipSync` cannot
 * express traversal entry names (`../…` recurses its path flattening), so
 * the malicious fixture needs raw record construction.
 */
function storedZip(entries: Record<string, Uint8Array>): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, data] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name)
    const checksum = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    chunks.push(local, nameBuf, Buffer.from(data))
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt32LE(checksum, 16)
    directory.writeUInt32LE(data.length, 20)
    directory.writeUInt32LE(data.length, 24)
    directory.writeUInt16LE(nameBuf.length, 28)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(entries).length, 8)
  eocd.writeUInt16LE(Object.keys(entries).length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, centralBuf, eocd])
}

describe('source kind inference', () => {
  it('resolves explicit kinds over URL shape and legacy flags', () => {
    expect(resolveSourceKind({ url: 'https://example.com/x.zip' })).toBe('archive')
    expect(resolveSourceKind({ url: 'https://github.com/org/repo.git' })).toBe('git')
    expect(resolveSourceKind({ url: '/tmp/repo', local: true })).toBe('local')
    expect(resolveSourceKind({ url: 'https://github.com/org/repo.git', kind: 'archive' })).toBe('archive')
    expect(resolveSourceKind({ url: 'https://example.com/x.zip', local: true })).toBe('local')
  })

  it('strips archive suffixes when deriving source ids', () => {
    expect(deriveSourceIdCandidates('https://example.com/plugin-0.1.zip')).toEqual(['plugin-0-1', 'example-com-plugin-0-1'])
    expect(deriveSourceIdCandidates('https://example.com/bundle.tar.gz')).toEqual(['bundle', 'example-com-bundle'])
    expect(archiveFormatOf('https://example.com/a.zip')).toBe('zip')
    expect(archiveFormatOf('https://example.com/a.tgz')).toBe('targz')
    expect(archiveFormatOf('https://example.com/a.git')).toBeUndefined()
  })

  it('maps GitHub repositories to codeload tarball URLs', () => {
    expect(codeloadTarballUrl('https://github.com/org/repo', 'main')).toBe('https://codeload.github.com/org/repo/tar.gz/refs/heads/main')
    expect(codeloadTarballUrl('https://github.com/org/repo.git', undefined)).toBe('https://codeload.github.com/org/repo/tar.gz/HEAD')
    expect(codeloadTarballUrl('https://gitlab.com/org/repo', 'main')).toBeUndefined()
  })
})

describe('state normalization keeps acquisition fields', async () => {
  it('round-trips kind, sha256, and adopted through state.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-state-'))
    const statePath = join(root, 'state.json')
    await saveState(statePath, {
      version: 1,
      installed: {},
      sources: [
        { id: 'zipped', url: 'https://example.com/x.zip', kind: 'archive', sha256: 'a'.repeat(64) },
        { id: 'manual', url: 'https://github.com/org/repo', kind: 'git', adopted: true },
        { id: 'legacy', url: 'https://github.com/org/other' }
      ]
    })
    const state = await loadState(statePath)
    expect(state.sources[0]).toMatchObject({ kind: 'archive', sha256: 'a'.repeat(64) })
    expect(state.sources[1]).toMatchObject({ kind: 'git', adopted: true })
    expect(state.sources[2]).toEqual({ id: 'legacy', url: 'https://github.com/org/other' })
    await rm(root, { recursive: true, force: true })
  })
})

/** A fixture zip: one wrapper directory containing a minimal skill suite. fflate requires Uint8Array values. */
const FIXTURE_ZIP = zipSync({
  'wrapper/manifest.json': Buffer.from(JSON.stringify({ name: 'fixture' })),
  'wrapper/skills/demo/SKILL.md': Buffer.from('---\nname: demo\ndescription: demo skill\n---\nbody\n')
})

describe('archive acquisition', () => {
  let server: Server
  let baseUrl = ''
  beforeAll(async () => {
    server = createServer((request, response) => {
      const payload = request.url?.endsWith('/mismatch.zip') === true ? zipSync({ 'x.txt': Buffer.from('other bytes') }) : FIXTURE_ZIP
      response.writeHead(200, { 'content-type': 'application/zip', 'content-length': String(payload.byteLength) })
      response.end(payload)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address !== null && typeof address === 'object') baseUrl = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('downloads, unwraps the top-level directory, and reports the digest', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'dsh-archive-ok-')), 'checkout')
    const { sha256 } = await archiveInstall(`${baseUrl}/fixture.zip`, dest, { allowHttp: true })
    expect(sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(await readFile(join(dest, 'manifest.json'), 'utf8')).toContain('fixture')
    expect(await readFile(join(dest, 'skills', 'demo', 'SKILL.md'), 'utf8')).toContain('demo skill')
    expect(await stat(join(dest, 'wrapper')).catch(() => undefined)).toBeUndefined()
    await rm(dest, { recursive: true, force: true })
  })

  it('rejects a sha256 mismatch and plain http without the allow flag', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'dsh-archive-bad-')), 'checkout')
    await expect(archiveInstall(`${baseUrl}/fixture.zip`, dest, { allowHttp: true, sha256: 'b'.repeat(64) })).rejects.toThrow(/sha256 mismatch/)
    await expect(archiveInstall(`${baseUrl}/fixture.zip`, dest)).rejects.toThrow(/https:\/\//)
    await rm(dest, { recursive: true, force: true })
  })

  it('refuses zip entries that escape the extraction root (zip-slip)', async () => {
    const dest = join(await mkdtemp(join(tmpdir(), 'dsh-archive-slip-')), 'checkout')
    const payload = storedZip({ '../evil.txt': new TextEncoder().encode('escaped') })
    const server2 = createServer((_request, response) => {
      response.writeHead(200, { 'content-length': String(payload.byteLength) })
      response.end(payload)
    })
    await new Promise<void>(resolve => server2.listen(0, '127.0.0.1', resolve))
    const address = server2.address()
    const url = address !== null && typeof address === 'object' ? `http://127.0.0.1:${address.port}/slip.zip` : ''
    await expect(archiveInstall(url, dest, { allowHttp: true })).rejects.toThrow(/escapes the extraction root/)
    await new Promise<void>(resolve => server2.close(() => resolve()))
    await rm(dest, { recursive: true, force: true })
  })

  it('extracts a tar.gz payload served over the same pipeline', async () => {
    const stage = await mkdtemp(join(tmpdir(), 'dsh-archive-tar-'))
    await mkdir(join(stage, 'top', 'skills', 'demo'), { recursive: true })
    await writeFile(join(stage, 'top', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: d\n---\n')
    const tarball = join(stage, 'payload.tar.gz')
    await run('tar', ['-czf', tarball, '-C', stage, 'top'])
    const dest = join(stage, 'checkout')
    const server3 = createServer(async (_request, response) => {
      response.writeHead(200)
      response.end(await readFile(tarball))
    })
    await new Promise<void>(resolve => server3.listen(0, '127.0.0.1', resolve))
    const address = server3.address()
    const url = address !== null && typeof address === 'object' ? `http://127.0.0.1:${address.port}/payload.tar.gz` : ''
    const { sha256 } = await archiveInstall(url, dest, { allowHttp: true })
    expect(sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(await readFile(join(dest, 'skills', 'demo', 'SKILL.md'), 'utf8')).toContain('name: demo')
    await new Promise<void>(resolve => server3.close(() => resolve()))
    await rm(stage, { recursive: true, force: true })
  })

  it('streams the digest through downloadArchive', async () => {
    const temp = join(await mkdtemp(join(tmpdir(), 'dsh-archive-dl-')), 'payload.bin')
    const sha256 = await downloadArchive(`${baseUrl}/fixture.zip`, temp, { allowHttp: true })
    expect(sha256).toMatch(/^[0-9a-f]{64}$/)
    await rm(temp, { force: true })
  })

  it('rejects a symlink pointing outside the extraction root (readlink-based containment)', async () => {
    // Regression: the containment walk once read the link's target *content*
    // with readFile, so an escaping symlink resolved to a bogus in-root path
    // and the escape survived extraction.
    const { assertNoEscapingSymlinksForTest } = await import('../src/catalog/archive.js')
    const stage = await mkdtemp(join(tmpdir(), 'dsh-archive-symlink-'))
    const outside = join(stage, 'outside')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'secret.txt'), 'TOP SECRET')
    const extract = join(stage, 'extract')
    await mkdir(join(extract, 'deep'), { recursive: true })
    await writeFile(join(extract, 'keep.txt'), 'x')
    await symlink(join(outside, 'secret.txt'), join(extract, 'deep', 'leak'))
    await expect(assertNoEscapingSymlinksForTest(extract)).rejects.toThrow(/escaping the extraction root/)
    // A contained link (target inside the root) stays legal.
    await symlink('../keep.txt', join(extract, 'deep', 'ok'))
    await expect(assertNoEscapingSymlinksForTest(extract)).rejects.toThrow(/escaping the extraction root/)
    await rm(stage, { recursive: true, force: true })
  })

  it('pins the extraction bomb limits to sane ratios', async () => {
    const limits = await import('../src/catalog/archive.js')
    expect(limits.ARCHIVE_MAX_ENTRY_BYTES).toBeLessThan(limits.ARCHIVE_MAX_EXTRACTED_BYTES)
    expect(limits.ARCHIVE_MAX_EXTRACTED_BYTES).toBeGreaterThan(limits.ARCHIVE_MAX_BYTES)
    expect(limits.ARCHIVE_MAX_ENTRIES).toBeGreaterThan(0)
  })

  it('accepts an explicit format for extension-less archive URLs (codeload fallback)', async () => {
    // Regression: codeload tarball URLs end in a branch path, not `.tar.gz`,
    // so archiveFormatOf returned undefined and the git fallback path always
    // failed with "unsupported archive format".
    const stage = await mkdtemp(join(tmpdir(), 'dsh-archive-codeload-'))
    await mkdir(join(stage, 'top', 'skills', 'demo'), { recursive: true })
    await writeFile(join(stage, 'top', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: d\n---\n')
    const tarball = join(stage, 'payload.tar.gz')
    await run('tar', ['-czf', tarball, '-C', stage, 'top'])
    const dest = join(stage, 'checkout')
    const server4 = createServer(async (_request, response) => {
      response.writeHead(200)
      response.end(await readFile(tarball))
    })
    await new Promise<void>(resolve => server4.listen(0, '127.0.0.1', resolve))
    const address = server4.address()
    const url = address !== null && typeof address === 'object' ? `http://127.0.0.1:${address.port}/tar.gz/refs/heads/main` : ''
    expect(archiveFormatOf(url)).toBeUndefined()
    const { sha256 } = await archiveInstall(url, dest, { allowHttp: true, format: 'targz' })
    expect(sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(await readFile(join(dest, 'skills', 'demo', 'SKILL.md'), 'utf8')).toContain('name: demo')
    await new Promise<void>(resolve => server4.close(() => resolve()))
    await rm(stage, { recursive: true, force: true })
  })
})

describe('adopting manually cloned checkouts', () => {
  /** A real git checkout with an `origin` remote, standing in for a manual clone. */
  async function makeManualCheckout(root: string, id: string, originUrl: string): Promise<string> {
    const dir = join(root, '.sources', id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'marker.txt'), 'user data')
    await run('git', ['-C', dir, 'init'])
    await run('git', ['-C', dir, 'remote', 'add', 'origin', originUrl])
    return dir
  }

  it('lists unmanaged checkouts with their origin remotes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-adopt-list-'))
    await makeManualCheckout(root, 'manual', 'https://github.com/example/manual.git')
    await mkdir(join(root, '.sources', 'plain'), { recursive: true })
    const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), onChanged: () => {} })
    await catalog.load()
    const unmanaged = await catalog.unmanagedSources()
    expect(unmanaged).toEqual([{ id: 'manual', url: 'https://github.com/example/manual.git' }, { id: 'plain' }])
    await rm(root, { recursive: true, force: true })
  })

  it('addSource adopts a matching checkout instead of re-cloning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-adopt-add-'))
    const dir = await makeManualCheckout(root, 'manual', 'https://github.com/example/manual.git')
    const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), onChanged: () => {} })
    await catalog.load()
    const source = await catalog.addSource({ url: 'https://github.com/example/manual.git' })
    expect(source).toMatchObject({ id: 'manual', adopted: true, kind: 'git' })
    // The user's files were not touched and no `-2` clone was created.
    expect(await readFile(join(dir, 'marker.txt'), 'utf8')).toBe('user data')
    expect(await readdir(join(root, '.sources'))).toEqual(['manual'])
    // Adoption is idempotent-safe: the registered source is no longer unmanaged.
    expect(await catalog.unmanagedSources()).toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('adoptSource registers git and non-git directories in place, and removal keeps the directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-adopt-register-'))
    const gitDir = await makeManualCheckout(root, 'gitrepo', 'https://github.com/example/gitrepo.git')
    const plainDir = join(root, '.sources', 'plaindir')
    await mkdir(plainDir, { recursive: true })
    const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), onChanged: () => {} })
    await catalog.load()

    const gitSource = await catalog.adoptSource('gitrepo')
    expect(gitSource).toMatchObject({ id: 'gitrepo', url: 'https://github.com/example/gitrepo.git', kind: 'git', adopted: true })
    const plainSource = await catalog.adoptSource('plaindir')
    expect(plainSource).toMatchObject({ id: 'plaindir', local: true, adopted: true })

    await catalog.removeSource('gitrepo')
    await catalog.removeSource('plaindir')
    expect(await stat(gitDir).then(() => true)).toBe(true)
    expect(await stat(plainDir).then(() => true)).toBe(true)
    expect(catalog.sources).toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('rejects adopting an unknown or already registered checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-adopt-reject-'))
    const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), onChanged: () => {} })
    await catalog.load()
    await expect(catalog.adoptSource('missing')).rejects.toThrow(/no checkout directory/)
    await mkdir(join(root, '.sources', 'dup'), { recursive: true })
    await catalog.adoptSource('dup')
    await expect(catalog.adoptSource('dup')).rejects.toThrow(/already registered/)
    await rm(root, { recursive: true, force: true })
  })
})
