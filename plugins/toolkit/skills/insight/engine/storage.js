// All mutable native artifacts live in marked, private run directories.
// The configured home may be an alias; no links below that trust root are followed.
import {
  constants,
  realpathSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  readdirSync,
  rmdirSync,
} from 'node:fs'
import {
  resolve,
  relative,
  isAbsolute,
  sep,
  dirname,
  basename,
} from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

export const MAX_JSON_BYTES = 16 * 1024 * 1024
const MARKER = '.dsh-agent-plugins-insight-native.json'
const ID = /^run-[0-9TZ-]+-[0-9a-f-]{36}$/
function inside(root, path) {
  const rel = relative(root, path)
  if (
    isAbsolute(rel) ||
    rel === '..' ||
    rel.startsWith(`..${sep}`) ||
    resolve(root, rel) !== path
  )
    throw new Error('artifact must be inside the managed root')
  return rel
}
function info(path) {
  try {
    return lstatSync(path)
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
}
export function homePath() {
  const home = resolve(process.env.DSH_HOME || resolve(homedir(), '.dsh'))
  // Do not create a configured home implicitly or accept a missing alias.
  return realpathSync.native(home)
}
export class Store {
  constructor(home = homePath()) {
    this.home = realpathSync.native(home)
    this.root = resolve(this.home, 'insights', 'runs')
  }
  check(path, { directory = false, create = false } = {}) {
    path = resolve(path)
    const rel = inside(this.home, path)
    let current = this.home
    const parts = rel.split(sep).filter(Boolean)
    for (const [i, part] of parts.entries()) {
      current = resolve(current, part)
      let st = info(current)
      const dir = i < parts.length - 1 || directory
      if (!st && dir && create) {
        mkdirSync(current, { mode: 0o700 })
        st = lstatSync(current)
      }
      if (!st) {
        if (i < parts.length - 1) throw new Error('artifact parent is missing')
        continue
      }
      if (
        st.isSymbolicLink() ||
        (dir ? !st.isDirectory() : !st.isFile()) ||
        (!dir && st.nlink !== 1)
      )
        throw new Error(
          'unsafe artifact: links and special files are not supported',
        )
    }
    return path
  }
  run(workdir) {
    if (typeof workdir !== 'string') throw new Error('workdir must be a string')
    const path = resolve(workdir)
    if (dirname(path) !== this.root || !ID.test(basename(path)))
      throw new Error('workdir must be a direct managed run directory')
    this.check(path, { directory: true })
    const marker = this.read(path, MARKER, false)
    if (
      marker.product !== 'dsh-agent-plugins-insight' ||
      marker.storage_version !== 1 ||
      marker.run_id !== basename(path)
    )
      throw new Error('unmanaged run directory')
    return path
  }
  path(run, name, managed = true) {
    if (managed) this.run(run)
    if (
      typeof name !== 'string' ||
      !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(name) ||
      name.includes('\\') ||
      name.split('/').some((p) => !p || p === '.' || p === '..') ||
      name.includes('\0')
    )
      throw new Error('invalid artifact name')
    const path = resolve(run, name)
    inside(run, path)
    return this.check(path)
  }
  read(run, name, managed = true) {
    const path = this.path(run, name, managed)
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try {
      const st = fstatSync(fd)
      if (!st.isFile() || st.nlink !== 1 || st.size > MAX_JSON_BYTES)
        throw new Error('unsafe or oversized artifact')
      const chunks = []
      let size = 0
      while (true) {
        const buffer = Buffer.alloc(
          Math.min(64 * 1024, MAX_JSON_BYTES + 1 - size),
        )
        const length = readSync(fd, buffer, 0, buffer.length, null)
        if (!length) break
        size += length
        if (size > MAX_JSON_BYTES) throw new Error('oversized artifact')
        chunks.push(buffer.subarray(0, length))
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } finally {
      closeSync(fd)
    }
  }
  write(run, name, value, { text = false, managed = true } = {}) {
    if (managed) this.run(run)
    // Validate name before creating any directories.
    if (
      typeof name !== 'string' ||
      !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(name) ||
      name.split('/').some((p) => p === '.' || p === '..')
    )
      throw new Error('invalid artifact name')
    const path = resolve(run, name)
    inside(run, path)
    this.check(dirname(path), { directory: true, create: true })
    this.check(path)
    const data = text ? value : JSON.stringify(value, null, 2) + '\n'
    if (Buffer.byteLength(data) > (text ? 32 * 1024 * 1024 : MAX_JSON_BYTES))
      throw new Error('oversized artifact')
    const temporary = resolve(dirname(path), `.write-${randomUUID()}`)
    const fd = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW || 0),
      0o600,
    )
    try {
      writeFileSync(fd, data, 'utf8')
      this.check(path)
      renameSync(temporary, path)
    } finally {
      closeSync(fd)
      if (info(temporary)) unlinkSync(temporary)
    }
  }
  create() {
    this.check(this.root, { directory: true, create: true })
    const id = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`
    const run = resolve(this.root, id)
    mkdirSync(run, { mode: 0o700 })
    this.write(
      run,
      MARKER,
      {
        product: 'dsh-agent-plugins-insight',
        storage_version: 1,
        run_id: id,
        created_at: new Date().toISOString(),
      },
      { managed: false },
    )
    return run
  }
  list() {
    if (!info(resolve(this.home, 'insights'))) return []
    this.check(resolve(this.home, 'insights'), { directory: true })
    if (!info(this.root)) return []
    this.check(this.root, { directory: true })
    return readdirSync(this.root)
      .filter((id) => ID.test(id))
      .flatMap((id) => {
        const run = resolve(this.root, id)
        try {
          this.run(run)
          return [run]
        } catch {
          return []
        }
      })
      .sort()
      .reverse()
  }
  removeFile(run, name) {
    const path = this.path(run, name)
    if (info(path)) unlinkSync(path)
  }
  inventory(run) {
    this.run(run)
    const files = []
    const visit = (dir) => {
      this.check(dir, { directory: true })
      for (const name of readdirSync(dir)) {
        const path = resolve(dir, name),
          st = lstatSync(path)
        if (
          st.isSymbolicLink() ||
          (!st.isFile() && !st.isDirectory()) ||
          (st.isFile() && st.nlink !== 1)
        )
          throw new Error('unsafe cleanup target')
        if (st.isDirectory()) visit(path)
        else files.push({ path: relative(run, path), bytes: st.size })
      }
    }
    visit(run)
    return {
      workdir: run,
      files,
      bytes: files.reduce((n, f) => n + f.bytes, 0),
    }
  }
  cleanup(run, confirm = false) {
    const plan = this.inventory(run)
    if (!confirm) return { ...plan, deleted: false }
    // No recursive rm: inspect every entry again and never follow links.
    const erase = (dir) => {
      this.check(dir, { directory: true })
      for (const name of readdirSync(dir)) {
        const path = resolve(dir, name),
          st = lstatSync(path)
        if (st.isDirectory() && !st.isSymbolicLink()) erase(path)
        else {
          this.check(path)
          unlinkSync(path)
        }
      }
      rmdirSync(dir)
    }
    erase(run)
    return { ...plan, deleted: true }
  }
}
