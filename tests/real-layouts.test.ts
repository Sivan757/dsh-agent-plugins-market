import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { scanSource } from '../src/catalog/suite-scanner.js'
import { MARKETPLACE_PATHS, PLUGIN_LAYOUTS, MANIFEST_ALIASES } from '../src/model/layouts.js'
import { readMarketplaces } from '../src/catalog/manifests.js'
import { readCommands } from '../src/runtime/commands-mounts.js'
import { buildSuiteDetail } from '../src/application/details.js'
import { mountSuiteInstructions, suiteInstructions } from '../src/runtime/project-runtime.js'
import { SuiteSkillProvider } from '../src/runtime/skills-provider.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'
import Ajv2020Default from 'ajv/dist/2020.js'

const fixtures = fileURLToPath(new URL('./fixtures/real-layouts/', import.meta.url))
interface Sample {
  dialect: string
  schema: string
  repo: string
  commit: string
  fixture: string
}
interface Snapshot {
  repo: string
  commit: string
  dialect: string
  pluginManifest: string | null
  marketplaceManifest: string | null
  licenses: string[]
  hashes: Record<string, string>
  files: Record<string, string>
}
const samples: Sample[] = JSON.parse(await readFile(join(fixtures, 'index.json'), 'utf8'))
const roots: string[] = []
const Ajv2020 = Ajv2020Default as unknown as { new (options: Record<string, unknown>): { compile(schema: unknown): ((data: unknown) => boolean) & { errors?: unknown } } }
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function snapshot(sample: Sample): Promise<Snapshot> {
  return JSON.parse(await readFile(join(fixtures, sample.fixture), 'utf8'))
}
const rootManifests = new Set([...PLUGIN_LAYOUTS.map(layout => layout.manifest), ...Object.values(MANIFEST_ALIASES).flat()])
const rootMarkets = new Set([...MARKETPLACE_PATHS, '.cursor-plugin/marketplace.json', '.kimi-plugin/marketplace.json', '.agents/plugins/api_marketplace.json'])
async function materialize(data: Snapshot, isolated: boolean, manifestless = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'market-real-layout-'))
  roots.push(root)
  for (const [path, text] of Object.entries(data.files)) {
    const rel = relative(root, resolve(root, path))
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw new Error('fixture path escapes temporary root')
    const manifestKind = [...rootManifests].sort((a, b) => b.length - a.length).find(candidate => path === candidate || path.endsWith(`/${candidate}`))
    const wantedManifest = data.pluginManifest ?? PLUGIN_LAYOUTS.find(layout => layout.kind === data.dialect)?.manifest
    if (manifestless && (rootManifests.has(path) || rootMarkets.has(path))) continue
    if (isolated && ((manifestKind !== undefined && manifestKind !== wantedManifest) || (rootMarkets.has(path) && path !== data.marketplaceManifest))) continue
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
  return root
}

describe('README repository layout compatibility (offline snapshots)', () => {
  it('covers every schema layout and preserves source provenance', async () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false })
    const dirs = await readdir(fileURLToPath(new URL('../schemas/', import.meta.url)), { withFileTypes: true })
    expect(samples.map(sample => sample.schema).sort()).toEqual(
      dirs
        .filter(dir => dir.isDirectory() && !['1.0.0', 'skill-collection'].includes(dir.name))
        .map(dir => dir.name)
        .sort()
    )
    for (const sample of samples) {
      const data = await snapshot(sample)
      expect(data.commit).toMatch(/^[a-f0-9]{40}$/)
      expect(data.licenses.length).toBeGreaterThan(0)
      expect(Object.keys(data.hashes).sort()).toEqual(Object.keys(data.files).sort())
      for (const license of data.licenses) expect(data.files[license]).toBeTruthy()
      const suffix = PLUGIN_LAYOUTS.find(layout => layout.kind === sample.dialect)?.manifest
      const pluginManifest = data.pluginManifest ?? Object.keys(data.files).find(path => suffix !== undefined && path.endsWith(`/${suffix}`)) ?? null
      for (const [manifest, type] of [
        [pluginManifest, 'plugin'],
        [data.marketplaceManifest, 'marketplace']
      ] as const) {
        if (manifest === null) continue
        const schemaDir = sample.schema === 'agent-plugins' ? '1.0.0' : sample.schema
        const schema = JSON.parse(await readFile(fileURLToPath(new URL(`../schemas/${schemaDir}/${type}.schema.json`, import.meta.url)), 'utf8'))
        const validate = ajv.compile(schema)
        expect(validate(JSON.parse(data.files[manifest]!)), `${sample.dialect}: ${JSON.stringify(validate.errors)}`).toBe(true)
      }
      for (const [path, content] of Object.entries(data.files)) expect(createHash('sha256').update(content).digest('hex'), `${sample.dialect}/${path}`).toBe(data.hashes[path])
    }
  })
  it.each(samples)('$dialect: real multi-layout repository remains discoverable', async sample => {
    const data = await snapshot(sample)
    const result = await scanSource(await materialize(data, false), sample.dialect, 'user', `https://github.com/${sample.repo}`)
    expect(result.suites.length).toBeGreaterThan(0)
    expect(result.suites.some(suite => Object.values(suite.surfaces).some(count => count > 0))).toBe(true)
    if (sample.dialect === 'qoder') {
      expect(result.suites[0]?.manifest.path).toMatch(/\/plugin\.json$/)
      expect(result.suites[0]?.surfaces.hooks).toBe(3)
    }
  })
  it('Kimi primary manifest, startup skill and skillInstructions use the real superpowers source', async () => {
    const data = await snapshot(samples.find(sample => sample.dialect === 'kimi')!)
    const root = await materialize(data, true)
    await rename(join(root, '.kimi-plugin/plugin.json'), join(root, 'kimi.plugin.json'))
    const [suite] = (await scanSource(root, 'kimi', 'user')).suites
    expect(suite?.manifest.layout).toBe('kimi')
    expect(suite?.manifest.path).toBe(join(root, 'kimi.plugin.json'))
    suite!.enabled = true
    const instructions = await suiteInstructions([withDefaultSurfaces(suite!)])
    expect(instructions.errors).toEqual([])
    expect(instructions.text).toContain('Kimi Code tool mapping')
    const provider = new SuiteSkillProvider({ enabledUserSuites: async () => [withDefaultSurfaces(suite!)] } as never)
    const candidate = (await provider.list({})).find(candidate => candidate.name === 'using-superpowers')!
    expect((await provider.get(candidate, {}))?.content).toContain('Kimi Code tool mapping')
    expect((await suiteInstructions([withDefaultSurfaces({ ...suite!, enabled: false })])).text).toBe('')
  })
  it('Kimi startup instructions mount and withdraw through the scoped host interface without a cwd', async () => {
    const data = await snapshot(samples.find(sample => sample.dialect === 'kimi')!)
    const root = await materialize(data, true)
    const [suite] = (await scanSource(root, 'kimi', 'user')).suites
    suite!.enabled = true
    let text = () => ''
    let removed = false
    const cleanups: Array<() => Promise<void>> = []
    const agent = {
      session: { header: {} },
      ctx: {
        inject: (_services: string[], callback: (scope: unknown) => void) => {
          callback({
            systemPrompt: {
              section: (section: { text(): string }) => {
                text = section.text
                return () => {
                  removed = true
                }
              }
            },
            effect: (setup: () => () => Promise<void>) => {
              cleanups.push(setup())
            }
          })
          return {
            dispose: async () => {
              await Promise.all(cleanups.map(cleanup => cleanup()))
            }
          }
        }
      }
    }
    const runtime = mountSuiteInstructions(
      { agents: { list: () => [agent] }, on: () => () => {} } as never,
      { enabledUserSuites: async () => (suite!.enabled ? [withDefaultSurfaces(suite!)] : []) } as never
    )
    await runtime.refresh()
    expect(text()).toContain('Kimi Code tool mapping')
    suite!.enabled = false
    await runtime.refresh()
    expect(text()).toBe('')
    await runtime.dispose()
    expect(removed).toBe(true)
  })
  it.each(samples)('$dialect: its own declaration works without higher-priority layouts', async sample => {
    const data = await snapshot(sample)
    const root = await materialize(data, true)
    const result = await scanSource(root, sample.dialect, 'user', `https://github.com/${sample.repo}`)
    expect(result.suites.length).toBeGreaterThan(0)
    if (data.pluginManifest !== null)
      expect(result.suites.some(suite => suite.manifest.layout === (sample.dialect === 'agent-plugins' ? 'agent-plugin-v1' : sample.dialect))).toBe(true)
    if (data.marketplaceManifest !== null) {
      expect((await readMarketplaces(root)).map(market => market.path)).toContain(join(root, data.marketplaceManifest))
      expect(result.marketplacePath).toBe(join(root, data.marketplaceManifest))
    }
    expect(result.suites.some(suite => Object.values(suite.surfaces).some(count => count > 0))).toBe(true)
    const suite = result.suites[0]!
    if (sample.dialect === 'zcode') {
      expect(suite.resources?.commands.length).toBeGreaterThan(0)
      expect(suite.resources!.commands.every(resource => resource.file.includes('references/zcode/commands/'))).toBe(true)
      expect((await readCommands(root, suite.resources?.commands)).length).toBeGreaterThan(0)
      expect(suite.surfaces.hooks).toBe(4)
    }
    if (sample.dialect === 'qoder') expect(suite.surfaces.hooks).toBe(2)
    if (sample.dialect === 'github-copilot') {
      expect(suite.manifest.layout).toBe('github-copilot')
      expect(suite.surfaces.hooks).toBe(2)
    }
    const detail = await buildSuiteDetail(withDefaultSurfaces(suite), { enabled: true, installedAt: '2026-09-09T00:00:00Z' }, [])
    expect(detail.commands.length).toBe(suite.resources?.commands.length ?? 0)
    expect(detail.hooks.count).toBe(suite.surfaces.hooks)
  })
  it('skill-collection: real skills remain usable with no plugin manifests', async () => {
    const data = await snapshot(samples.find(sample => sample.dialect === 'universal')!)
    const result = await scanSource(await materialize(data, false, true), 'real-skills', 'user')
    expect(result.suites.some(suite => suite.manifest.layout === 'skill-collection' && suite.skills.length > 0)).toBe(true)
  })
  it('ponytail Copilot variant loads its native hook event names and bash commands', async () => {
    const data = await snapshot(samples.find(sample => sample.dialect === 'qoder')!)
    const root = await materialize({ ...data, dialect: 'github-copilot', pluginManifest: '.github/plugin/plugin.json', marketplaceManifest: null }, true)
    const [suite] = (await scanSource(root, 'ponytail', 'user')).suites
    expect(suite?.manifest.layout).toBe('github-copilot')
    expect(suite?.hooks?.events.SessionStart).toHaveLength(1)
    expect(suite?.hooks?.events.UserPromptSubmit).toHaveLength(1)
    expect(suite?.surfaces.hooks).toBe(2)
  })
})
