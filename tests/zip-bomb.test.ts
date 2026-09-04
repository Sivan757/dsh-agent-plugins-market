import { mkdtemp, writeFile, mkdir, rm, readdir, symlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { createServer } from 'node:http'
import { archiveInstall, ARCHIVE_MAX_ENTRIES } from '../src/catalog/archive.js'

const run = promisify(execFile)

describe('archive pre-extraction bounds', () => {
  it('rejects a tar member count over the limit during the bounded walk', async () => {
    const stage = await mkdtemp(join(tmpdir(), 'dsh-archive-tarbomb-'))
    const top = join(stage, 'top')
    await mkdir(top, { recursive: true })
    // ARCHIVE_MAX_ENTRIES is 20k; creating that many files is slow — build
    // 300 entries and pin the walk limit through a zip path instead, keeping
    // this tar test for the write-then-walk contract.
    for (let i = 0; i < 300; i++) await writeFile(join(top, `f${i}.txt`), 'x'.repeat(10))
    const tarball = join(stage, 'payload.tar')
    await run('tar', ['-cf', tarball, '-C', stage, 'top'])
    const dest = join(stage, 'checkout')
    const server = createServer(async (_q, response) => {
      response.writeHead(200)
      response.end(await readFile(tarball))
    })
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
    const server = createServer(async (_q, response) => {
      response.writeHead(200)
      response.end(await readFile(tarball))
    })
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
    const server = createServer(async (_q, response) => {
      response.writeHead(200)
      response.end(await readFile(payload))
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const addr = server.address()
    const url = addr !== null && typeof addr === 'object' ? `http://127.0.0.1:${addr.port}/p.zip` : ''
    await expect(archiveInstall(url, dest, { allowHttp: true, format: 'zip' })).rejects.toThrow(/entry limit/)
    await rm(stage, { recursive: true, force: true })
  }, 30_000)
})
