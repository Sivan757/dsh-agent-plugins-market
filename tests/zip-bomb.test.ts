import { mkdtemp, writeFile, mkdir, rm, readdir, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { createServer, type ServerResponse } from 'node:http'
import { archiveInstall, ARCHIVE_MAX_ENTRIES } from '../src/catalog/archive.js'

const run = promisify(execFile)

/**
 * Serve `file` as the only response body. `createServer`'s listener returns
 * `void`, so the read is dispatched deliberately instead of being an async
 * listener whose rejected promise nothing observes.
 */
function serveFile(response: ServerResponse, file: string): void {
  void (async () => {
    response.writeHead(200)
    response.end(await readFile(file))
  })()
}

/**
 * One 512-byte POSIX ustar header for a zero-length regular-file member.
 * Extraction shells out to the system tar, so a synthesized archive has to be
 * a real ustar stream, checksum field included.
 */
function ustarHeader(name: string): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  writeOctalField(header, 100, 8, 0o644)
  writeOctalField(header, 108, 8, 0)
  writeOctalField(header, 116, 8, 0)
  writeOctalField(header, 124, 12, 0)
  writeOctalField(header, 136, 12, 0)
  // The checksum is the whole header summed with its own field read as spaces.
  header.fill(0x20, 148, 156)
  header.write('0', 156, 1, 'utf8')
  header.write('ustar', 257, 5, 'utf8')
  header.write('00', 263, 2, 'utf8')
  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'latin1')
  return header
}

/** Octal numeric field: zero-padded digits plus the terminating NUL. */
function writeOctalField(target: Buffer, offset: number, length: number, value: number): void {
  target.write(value.toString(8).padStart(length - 1, '0'), offset, length - 1, 'ascii')
}

/**
 * A ustar archive of `count` empty regular files, built entirely in memory:
 * an empty member carries no data block, so the payload is 512 bytes per
 * member plus the two zero blocks that terminate the archive.
 */
function tarOfEmptyFiles(count: number): Buffer {
  const members: Buffer[] = []
  for (let i = 0; i < count; i++) members.push(ustarHeader(`f${i}.txt`))
  members.push(Buffer.alloc(1024))
  return Buffer.concat(members)
}

describe('archive pre-extraction bounds', () => {
  it('extracts a tar below the entry limit through the write-then-walk path', async () => {
    const stage = await mkdtemp(join(tmpdir(), 'dsh-archive-tarbomb-'))
    const top = join(stage, 'top')
    await mkdir(top, { recursive: true })
    // The success path for tar: real members written by the system tar, so
    // every one lands on disk and the digest is taken from the extracted
    // tree. The walk's own ARCHIVE_MAX_ENTRIES guard is pinned separately
    // below by a synthesized archive, which costs no per-member filesystem
    // work to build.
    for (let i = 0; i < 300; i++) await writeFile(join(top, `f${i}.txt`), 'x'.repeat(10))
    const tarball = join(stage, 'payload.tar')
    await run('tar', ['-cf', tarball, '-C', stage, 'top'])
    const dest = join(stage, 'checkout')
    const server = createServer((_q, response) => serveFile(response, tarball))
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const addr = server.address()
    const url = addr !== null && typeof addr === 'object' ? `http://127.0.0.1:${addr.port}/p.tar` : ''
    const { sha256 } = await archiveInstall(url, dest, { allowHttp: true, format: 'tar' })
    expect(sha256).toMatch(/^[0-9a-f]{64}$/)
    expect((await readdir(dest)).filter(name => name.endsWith('.txt')).length).toBe(300)
    await rm(stage, { recursive: true, force: true })
  })

  it('rejects a symlink inside a tar payload pointing outside (post-extract walk)', async () => {
    const stage = await mkdtemp(join(tmpdir(), 'dsh-archive-tarsymlink-'))
    const outside = join(stage, 'outside')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'secret.txt'), 'TOP SECRET')
    const top = join(stage, 'top', 'deep')
    await mkdir(top, { recursive: true })
    await symlink(join(outside, 'secret.txt'), join(top, 'leak'))
    const tarball = join(stage, 'payload.tar')
    await run('tar', ['-cf', tarball, '-C', stage, 'top'])
    const dest = join(stage, 'checkout')
    const server = createServer((_q, response) => serveFile(response, tarball))
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const addr = server.address()
    const url = addr !== null && typeof addr === 'object' ? `http://127.0.0.1:${addr.port}/p.tar` : ''
    await expect(archiveInstall(url, dest, { allowHttp: true, format: 'tar' })).rejects.toThrow(/escaping the extraction root/)
    await rm(stage, { recursive: true, force: true })
  })

  it('rejects a zip exceeding the entry-count limit', async () => {
    const stage = await mkdtemp(join(tmpdir(), 'dsh-archive-zipcount-'))
    // Build a zip just over the 20k entry cap with tiny files.
    const entries: Record<string, Uint8Array> = {}
    for (let i = 0; i < ARCHIVE_MAX_ENTRIES + 10; i++) entries[`f${i}.txt`] = Buffer.from('x')
    const payload = join(stage, 'payload.zip')
    await writeFile(payload, zipSync(entries))
    const dest = join(stage, 'checkout')
    const server = createServer((_q, response) => serveFile(response, payload))
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const addr = server.address()
    const url = addr !== null && typeof addr === 'object' ? `http://127.0.0.1:${addr.port}/p.zip` : ''
    await expect(archiveInstall(url, dest, { allowHttp: true, format: 'zip' })).rejects.toThrow(/entry limit/)
    await rm(stage, { recursive: true, force: true })
  }, 30_000)

  // Positive control for the two tar tests below: if the hand-built ustar
  // headers were malformed, the entry-limit test would still "pass" because
  // the system tar failed on the archive rather than because the walk counted
  // too many entries. Extracting a small archive of the same members proves
  // the headers are well-formed before the rejection is trusted.
  it('extracts a small synthesized tar, so its hand-built ustar headers are well-formed', async () => {
    const stage = await mkdtemp(join(tmpdir(), 'dsh-archive-ustar-'))
    const payload = join(stage, 'payload.tar')
    await writeFile(payload, tarOfEmptyFiles(5))
    const dest = join(stage, 'checkout')
    const server = createServer((_q, response) => serveFile(response, payload))
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const addr = server.address()
    const url = addr !== null && typeof addr === 'object' ? `http://127.0.0.1:${addr.port}/p.tar` : ''
    const { sha256 } = await archiveInstall(url, dest, { allowHttp: true, format: 'tar' })
    expect(sha256).toMatch(/^[0-9a-f]{64}$/)
    expect((await readdir(dest)).sort()).toEqual(['f0.txt', 'f1.txt', 'f2.txt', 'f3.txt', 'f4.txt'])
    await rm(stage, { recursive: true, force: true })
  })

  it('rejects a tar exceeding the entry-count limit on the post-extraction walk', async () => {
    const stage = await mkdtemp(join(tmpdir(), 'dsh-archive-tarcount-'))
    // One member past the cap, synthesized in memory: the system tar still
    // materializes every member, but building the archive touches no disk.
    const payload = join(stage, 'payload.tar')
    await writeFile(payload, tarOfEmptyFiles(ARCHIVE_MAX_ENTRIES + 1))
    const dest = join(stage, 'checkout')
    const server = createServer((_q, response) => serveFile(response, payload))
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const addr = server.address()
    const url = addr !== null && typeof addr === 'object' ? `http://127.0.0.1:${addr.port}/p.tar` : ''
    await expect(archiveInstall(url, dest, { allowHttp: true, format: 'tar' })).rejects.toThrow(/entry limit/)
    // The walk rejects before the swap into `dest`, so the failed install
    // leaves the checkout empty rather than half-populated.
    expect(await readdir(dest).catch(() => [])).toEqual([])
    await rm(stage, { recursive: true, force: true })
  }, 30_000)
})
