/** Plain-Node catalog preparation benchmark. Synthetic sources, no host mounts or network, no timing gate. */
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const SUITES_PER_SOURCE = 600
const SAMPLES = 3
const mode = process.argv.includes('--adopted') ? 'adopted' : 'managed'
const moduleOption = process.argv.indexOf('--module')
const modulePath = moduleOption < 0 ? '../lib/packages/market-bundle/src/application/catalog.js' : process.argv[moduleOption + 1]
if (modulePath === undefined) throw new Error('--module requires a module path')
const { Catalog } = await import(modulePath)
let sourceRoot = ''
let counts = {}
for (const operation of ['stat', 'readdir', 'readFile']) {
  const original = fs[operation]
  fs[operation] = function (...args) {
    if (String(args[0]).startsWith(sourceRoot) && sourceRoot !== '') counts[operation] = (counts[operation] ?? 0) + 1
    return original.apply(this, args)
  }
}
syncBuiltinESMExports()

async function fixture(root) {
  const sources = ['active', 'unused'].map(id => ({
    id,
    kind: mode === 'adopted' ? 'git' : 'archive',
    url: `https://example.test/${id}`,
    ...(mode === 'adopted' ? { adopted: true } : {})
  }))
  for (const source of sources) {
    for (let start = 0; start < SUITES_PER_SOURCE; start += 20) {
      await Promise.all(
        Array.from({ length: Math.min(20, SUITES_PER_SOURCE - start) }, async (_, offset) => {
          const id = `suite-${start + offset}`
          const dir = join(root, '.sources', source.id, 'plugins', id)
          await fs.mkdir(join(dir, '.claude-plugin'), { recursive: true })
          await fs.mkdir(join(dir, 'skills', id), { recursive: true })
          await fs.writeFile(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: id, description: 'Synthetic catalog fixture' }))
          await fs.writeFile(join(dir, 'skills', id, 'SKILL.md'), `---\nname: ${id}\ndescription: Synthetic skill\n---\n`)
        })
      )
    }
  }
  await fs.writeFile(join(root, 'state.json'), JSON.stringify({ version: 1, sources, installed: { 'active/suite-0': { enabled: true, installedAt: '2026-01-01T00:00:00.000Z' } } }))
}

async function prepare(catalog) {
  const [enabled, declarations] = await Promise.all([catalog.enabledUserSuites(), catalog.installedSuiteDeclarations()])
  if (enabled.length !== 1 || declarations.length !== 1 || enabled[0]?.id !== 'suite-0') throw new Error('catalog result changed')
  return { enabled: enabled.length, declarations: declarations.length }
}

async function measure(phase, work) {
  counts = {}
  const cpuStart = process.cpuUsage()
  const start = performance.now()
  const result = await work()
  const cpu = process.cpuUsage(cpuStart)
  return { phase, wallMs: Math.round(performance.now() - start), cpuMs: Math.round((cpu.user + cpu.system) / 1000), sourceCalls: { ...counts }, result }
}

const samples = []
for (let sample = 0; sample < SAMPLES; sample++) {
  const root = await fs.mkdtemp(join(tmpdir(), 'market-catalog-bench-'))
  let catalog
  try {
    await fixture(root)
    sourceRoot = join(root, '.sources')
    let now = 0
    const options = { userRoot: root, dataRoot: join(root, 'data'), agentsRoot: join(root, 'agents'), onChanged: () => {}, now: () => now }
    catalog = new Catalog(options)
    samples.push({
      sample,
      ...(await measure('first-import', async () => {
        await catalog.load()
        return prepare(catalog)
      }))
    })
    now = 60_000
    samples.push({ sample, ...(await measure('after-freshness-window', () => prepare(catalog))) })
    await catalog.dispose()
    catalog = new Catalog(options)
    samples.push({
      sample,
      ...(await measure('catalog-reopen', async () => {
        await catalog.load()
        return prepare(catalog)
      }))
    })
  } finally {
    await catalog?.dispose()
    sourceRoot = ''
    await fs.rm(root, { recursive: true, force: true })
  }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const aggregates = ['first-import', 'after-freshness-window', 'catalog-reopen'].map(phase => ({
  phase,
  medianWallMs: median(samples.filter(s => s.phase === phase).map(s => s.wallMs)),
  medianCpuMs: median(samples.filter(s => s.phase === phase).map(s => s.cpuMs))
}))
console.log(
  JSON.stringify(
    {
      node: process.version,
      workload: { sources: 2, sourceMode: mode, suitesPerSource: SUITES_PER_SOURCE, installed: 1 },
      endpoint: 'catalog startup preparation; excludes fixture creation, module import, host mounts, network and browser',
      samples,
      aggregates
    },
    null,
    2
  )
)
