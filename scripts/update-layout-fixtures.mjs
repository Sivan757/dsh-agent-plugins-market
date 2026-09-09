/** Snapshot README sample declarations and runtime text into offline, commit-pinned fixtures. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const config = JSON.parse(await readFile(join(root, 'scripts/compat-sources.json'), 'utf8'))
const output = join(root, 'tests/fixtures/real-layouts')
await mkdir(output, { recursive: true })
const index = []
for (const sample of config.samples) {
  const checkout = join(root, 'node_modules/.cache/compat-report', sample.dialect)
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim()
  const commit = git('rev-parse', 'HEAD')
  const tracked = new Set(git('ls-tree', '-r', '--name-only', '-z', commit).split('\0'))
  const files = {}
  async function walk(relative = '') {
    for (const entry of await readdir(join(checkout, relative), { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(path)
      } else if (
        entry.isFile() &&
        tracked.has(path) &&
        (path === sample.pluginManifest ||
          path === sample.marketplaceManifest ||
          /(?:^|\/)(?:plugin\.json|kimi\.plugin\.json|marketplace\.json|api_marketplace\.json|SKILL\.md)$/.test(path) ||
          /(?:^|\/)(?:commands|agents)\/.+\.(?:md|mdc|markdown|txt)$/.test(path) ||
          /(?:^|\/)(?:skills|hooks|plugins|\.github|\.qoder)\/.+\.json$/.test(path) ||
          /^[^/]*\.json$/.test(path))
      ) {
        files[path] = execFileSync('git', ['-C', checkout, 'show', `${commit}:${path}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      }
    }
  }
  await walk()
  const licenses = git('ls-tree', '--name-only', 'HEAD')
    .split('\n')
    .filter(path => /^(?:LICEN[CS]E|COPYING|NOTICE)(?:[.-].*)?$/i.test(path))
  for (const path of licenses) files[path] = execFileSync('git', ['-C', checkout, 'show', `${commit}:${path}`], { encoding: 'utf8' })
  if (licenses.length === 0) throw new Error(`${sample.repo}: no root license found; review redistribution before snapshotting`)
  const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
  const hashes = Object.fromEntries(Object.entries(ordered).map(([path, text]) => [path, createHash('sha256').update(text).digest('hex')]))
  const fixture = {
    repo: sample.repo,
    commit,
    dialect: sample.dialect,
    pluginManifest: sample.pluginManifest,
    marketplaceManifest: sample.marketplaceManifest,
    licenses,
    hashes,
    files: ordered
  }
  const target = join(output, `${sample.dialect}.json`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(fixture, null, 2) + '\n')
  index.push({ dialect: sample.dialect, schema: sample.schema, repo: sample.repo, commit, fixture: `${sample.dialect}.json` })
  console.log(`${sample.dialect}: ${Object.keys(files).length} files at ${commit.slice(0, 12)}`)
}
await writeFile(join(output, 'index.json'), JSON.stringify(index, null, 2) + '\n')
