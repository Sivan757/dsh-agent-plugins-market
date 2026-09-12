import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { projectAgentRoles } from '../src/application/project-agent-roles.js'
import { discoverMcp } from '../src/catalog/surfaces.js'
import { detectManifest, readMarketplaces } from '../src/catalog/manifests.js'
import { scanSource, resolveMarketplaceEntry } from '../src/catalog/suite-scanner.js'
import { discoverNativeProjectSuites } from '../src/catalog/native-project.js'
import { PLUGIN_LAYOUTS, PROJECT_LAYOUTS } from '../src/model/layouts.js'
import { SuiteSkillProvider } from '../src/runtime/skills-provider.js'
import { CommandMountRegistry } from '../src/runtime/commands-mounts.js'

const roots: string[] = []
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'market-layout-'))
  roots.push(path)
  return path
}
async function put(root: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), text)
}
const skill = '---\nname: layout-test\ndescription: A layout test skill.\n---\nBody.\n'
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('layout registry', () => {
  it('rejects non-string marketplace identities without interrupting valid remote entries', async () => {
    const dir = await root()
    await put(
      dir,
      '.qoder-plugin/marketplace.json',
      JSON.stringify({
        name: 'market',
        plugins: [
          { name: 42, source: { source: 'github', repo: 'example/broken' } },
          { name: 'valid', source: { source: 'github', repo: 'example/valid' } }
        ]
      })
    )
    const result = await scanSource(dir, 'market', 'user')
    expect(result.suites.map(suite => suite.id)).toEqual(['valid'])
    expect(result.notes.join('\n')).toContain('invalid plugin entry metadata')
  })
  it.each(PLUGIN_LAYOUTS.filter(layout => ['zcode', 'qoder', 'github-copilot'].includes(layout.kind)))('scans $kind manifests and surfaces', async layout => {
    const dir = await root()
    await put(dir, layout.manifest, JSON.stringify({ name: 'example', version: '1.0.0' }))
    await put(dir, 'skills/test/SKILL.md', skill)
    await put(dir, '.mcp.json', JSON.stringify({ mcpServers: { test: { command: 'example-server' } } }))
    const result = await scanSource(dir, 'example', 'user')
    expect(result.suites).toHaveLength(1)
    expect(result.suites[0].manifest.layout).toBe(layout.kind)
    expect(result.suites[0].surfaces).toMatchObject({ skills: 1, mcp: 1 })
  })

  it('keeps existing dialect precedence when a source declares several manifests', async () => {
    const dir = await root()
    for (const layout of PLUGIN_LAYOUTS) await put(dir, layout.manifest, JSON.stringify({ name: layout.kind }))
    expect((await detectManifest(dir))?.kind).toBe('agent-plugin-v1')
  })

  it('uses the same layout order for competing manifests and productive marketplace catalogs', async () => {
    const dir = await root()
    const candidates = [
      ['.plugin/plugin.json', '.plugin/marketplace.json', 'universal'],
      ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'claude-code'],
      ['.cursor-plugin/plugin.json', '.cursor-plugin/marketplace.json', 'cursor'],
      ['kimi.plugin.json', '.kimi-plugin/marketplace.json', 'kimi'],
      ['.codex-plugin/plugin.json', '.agents/plugins/marketplace.json', 'codex'],
      ['.codex-plugin/plugin.json', '.agents/plugins/api_marketplace.json', 'codex'],
      ['.qoder-plugin/plugin.json', '.qoder-plugin/marketplace.json', 'qoder'],
      ['.github/plugin/plugin.json', '.github/plugin/marketplace.json', 'github-copilot']
    ] as const
    for (const [manifest, marketplace, kind] of candidates) {
      await put(dir, manifest, JSON.stringify({ name: kind }))
      await put(dir, marketplace, JSON.stringify({ name: kind, plugins: [{ name: kind, source: { source: 'github', repo: `example/${kind}` } }] }))
    }
    await put(dir, 'marketplace.json', JSON.stringify({ name: 'shared', plugins: [{ name: 'shared', source: { source: 'github', repo: 'example/shared' } }] }))
    expect((await readMarketplaces(dir)).map(market => market.path)).toEqual([...candidates.map(([, path]) => join(dir, path)), join(dir, 'marketplace.json')])
    for (const [index, [manifest, marketplace, kind]] of candidates.entries()) {
      expect((await detectManifest(dir))?.kind).toBe(kind)
      expect((await scanSource(dir, 'market', 'user')).suites.map(suite => suite.id)).toEqual([kind])
      await rm(join(dir, marketplace))
      if (candidates[index + 1]?.[0] !== manifest) await rm(join(dir, manifest))
    }
    expect((await scanSource(dir, 'market', 'user')).suites.map(suite => suite.id)).toEqual(['shared'])
  })

  it('continues past invalid and empty higher-priority catalogs', async () => {
    const dir = await root()
    await put(dir, '.plugin/marketplace.json', '{invalid')
    await put(dir, '.claude-plugin/marketplace.json', JSON.stringify({ name: 'empty', plugins: [] }))
    await put(dir, '.cursor-plugin/marketplace.json', JSON.stringify({ name: 'cursor', plugins: [{ name: 'usable', source: { source: 'github', repo: 'example/usable' } }] }))
    const result = await scanSource(dir, 'market', 'user')
    expect(result.suites.map(suite => suite.id)).toEqual(['usable'])
    expect(result.notes.join('\n')).toContain('.plugin/marketplace.json')
    expect(result.notes.join('\n')).toContain('no entry resolved')
  })

  it.each(['.qoder-plugin/marketplace.json', '.github/plugin/marketplace.json', 'marketplace.json'])('resolves suites from %s', async path => {
    const dir = await root()
    await put(dir, path, JSON.stringify({ name: 'market', plugins: [{ name: 'example', source: './bundles/example' }] }))
    await put(dir, 'bundles/example/.qoder-plugin/plugin.json', JSON.stringify({ name: 'example' }))
    expect((await scanSource(dir, 'market', 'user')).suites.map(suite => suite.id)).toEqual(['example'])
  })

  it('diagnoses malformed marketplace entries and accepts ZCode keyed catalogs', async () => {
    const dir = await root()
    await put(dir, 'marketplace.json', JSON.stringify({ name: 'market', plugins: { example: { source: './bundle' }, broken: null } }))
    await put(dir, 'bundle/.zcode-plugin/plugin.json', JSON.stringify({ name: 'example' }))
    const result = await scanSource(dir, 'market', 'user')
    expect(result.suites.map(suite => suite.id)).toEqual(['example'])
    expect(result.notes.join('\n')).toContain('invalid plugin entry')
  })

  it('does not reinterpret a remote subdirectory as a local path', async () => {
    const dir = await root()
    await mkdir(join(dir, 'plugin'))
    const entry = { source: { source: 'git-subdir', url: 'https://example.test/remote.git', path: 'plugin' } }
    expect(await resolveMarketplaceEntry(dir, entry, undefined)).toEqual({ kind: 'remote', url: entry.source.url })
    expect(await resolveMarketplaceEntry(dir, entry, entry.source.url)).toEqual({ kind: 'local', dir: join(dir, 'plugin') })
  })

  it.each(['{invalid', '[]', 'null'])('rejects malformed manifests instead of exposing their skills: %s', async manifest => {
    const dir = await root()
    await put(dir, '.qoder-plugin/plugin.json', manifest)
    await put(dir, 'skills/test/SKILL.md', skill)
    await put(dir, 'loose/SKILL.md', skill)
    const result = await scanSource(dir, 'example', 'user')
    expect(result.suites).toEqual([])
    expect(result.notes.join('\n')).toContain('rejected declared manifest')
  })

  it('rejects a marketplace self-reference whose subdirectory is an external symlink', async () => {
    const dir = await root()
    const external = await root()
    await symlink(external, join(dir, 'plugin'))
    const url = 'https://example.test/repo.git'
    const result = await resolveMarketplaceEntry(dir, { source: { source: 'git-subdir', url, path: 'plugin' } }, url)
    expect(result).toMatchObject({ kind: 'rejected' })
    expect(result).toHaveProperty('reason', expect.stringContaining('symlink'))
  })
})

/** Role names are JSON-encoded identity segments; the last segment is the role's own name. */
function roleLeaf(name: string): string {
  const segments: unknown = JSON.parse(name)
  if (!Array.isArray(segments)) throw new Error(`expected role identity segments, got ${name}`)
  const leaf: unknown = segments.at(-1)
  if (typeof leaf !== 'string') throw new Error(`expected a string role name, got ${name}`)
  return leaf
}

describe('project layout discovery and switch', () => {
  it('keeps Copilot roles out of skill and command menus while preserving their source identity', async () => {
    const project = await root()
    const userRoot = await root()
    await mkdir(join(project, '.git'))
    await put(project, '.github/agents/reviewer.agent.md', '---\nname: reviewer\ndescription: Review changes\n---\nReview the diff.')
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await catalog.load()
    const provider = new SuiteSkillProvider(catalog)
    expect(await provider.list({ cwd: project })).toEqual([])
    const roles = await projectAgentRoles(catalog, { session: { header: { cwd: project } } })
    expect(roles[0]).toMatchObject({ path: join(project, '.github/agents/reviewer.agent.md'), title: 'reviewer', description: 'Review changes' })
    expect(roleLeaf(roles[0].name)).toBe('reviewer.agent')
    const commands: string[] = []
    const registry = new CommandMountRegistry({
      commands: {
        register: (entry: { name: string }) => {
          commands.push(entry.name)
          return () => {}
        }
      }
    } as never)
    await registry.reconcile((await catalog.readProjectCatalog(project)).enabledSuites)
    expect(commands).toEqual([])
    registry.disposeAll()
  })

  it('does not reinterpret an ordinary skill named agent-helper as an agent role', async () => {
    const project = await root()
    const userRoot = await root()
    await mkdir(join(project, '.git'))
    await put(project, '.github/skills/helper/SKILL.md', '---\nname: agent-helper\ndescription: A normal skill\n---\nNormal skill body.')
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await catalog.load()
    const provider = new SuiteSkillProvider(catalog)
    const [candidate] = await provider.list({ cwd: project })
    expect((await provider.get(candidate, { cwd: project }))?.content).toBe('Normal skill body.')
  })

  it('retains both plain and compound-suffix role identities without alias collisions', async () => {
    const project = await root()
    const userRoot = await root()
    await mkdir(join(project, '.git'))
    for (const name of ['reviewer.md', 'reviewer.agent.md']) await put(project, `.github/agents/${name}`, `---\ndescription: ${name}\n---\nReview.`)
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await catalog.load()
    expect(await new SuiteSkillProvider(catalog).list({ cwd: project })).toEqual([])
    const roles = await projectAgentRoles(catalog, { session: { header: { cwd: project } } })
    expect(roles.map(role => roleLeaf(role.name)).sort()).toEqual(['reviewer', 'reviewer.agent'])
  })
  it('resolves project roles only for the calling session and honors the scan switch', async () => {
    const project = await root()
    const other = await root()
    const userRoot = await root()
    await mkdir(join(project, '.git'))
    await mkdir(join(other, '.git'))
    await put(project, '.qoder/agents/reviewer.md', '---\ndescription: Review changes\n---\nReview changes.')
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await catalog.load()
    const parent = { session: { header: { cwd: project } } }
    expect((await projectAgentRoles(catalog, parent)).map(entry => entry.path)).toEqual([join(project, '.qoder/agents/reviewer.md')])
    expect(await projectAgentRoles(catalog, { session: { header: { cwd: other } } })).toEqual([])
    expect(await projectAgentRoles(catalog, undefined)).toEqual([])
    await catalog.setScanProjectLayouts(false)
    expect(await projectAgentRoles(catalog, parent)).toEqual([])
  })
  it.each(PROJECT_LAYOUTS)('reads $dirName skills in place', async layout => {
    const dir = await root()
    await put(dir, `${layout.dirName}/skills/test/SKILL.md`, skill)
    const suites = await discoverNativeProjectSuites(dir, 'project')
    expect(suites).toHaveLength(1)
    expect(suites[0].skills[0].file).toBe(join(dir, layout.dirName, 'skills/test/SKILL.md'))
    expect(suites[0].activeSurfaces).toMatchObject({ mcp: false, hooks: false, lsp: false })
  })

  it('does not expose unsupported Markdown agent files from Codex projects', async () => {
    const dir = await root()
    await put(dir, '.codex/skills/test/SKILL.md', skill)
    await put(dir, '.codex/agents/unrelated.md', 'Unrelated document')
    const suites = await discoverNativeProjectSuites(dir, 'project')
    expect(suites[0].surfaces.agents).toBe(0)
    expect(suites[0].activeSurfaces?.agents).toBe(false)
  })

  it('removes and restores project skill candidates immediately despite cached snapshots', async () => {
    const project = await root()
    const userRoot = await root()
    await mkdir(join(project, '.git'))
    await put(project, '.qoder/skills/test/SKILL.md', skill)
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {}, projectSnapshotTtlMs: 60_000 })
    await catalog.load()
    const provider = new SuiteSkillProvider(catalog)
    expect((await provider.list({ cwd: project })).map(item => item.name)).toEqual(['layout-test'])
    await catalog.setScanProjectLayouts(false)
    expect(await provider.list({ cwd: project })).toEqual([])
    await catalog.setScanProjectLayouts(true)
    expect((await provider.list({ cwd: project })).map(item => item.name)).toEqual(['layout-test'])
  })
})

describe('dialect MCP file resolution', () => {
  it('Qoder prefers dot-prefixed config over its bare-file fallback', async () => {
    const dir = await root()
    await put(dir, '.qoder-plugin/plugin.json', '{"name":"example"}')
    await put(dir, '.mcp.json', '{"mcpServers":{"preferred":{"command":"preferred"}}}')
    await put(dir, 'mcp.json', '{"mcpServers":{"fallback":{"command":"fallback"}}}')
    expect(Object.keys((await discoverMcp(dir, []))!.servers)).toEqual(['preferred'])
  })
  it('Copilot reads its .github MCP file', async () => {
    const dir = await root()
    await put(dir, '.github/plugin/plugin.json', '{"name":"example"}')
    await put(dir, '.github/mcp.json', '{"mcpServers":{"github":{"command":"server"}}}')
    expect(Object.keys((await discoverMcp(dir, []))!.servers)).toEqual(['github'])
  })
  it('ZCode merges inline servers over file declarations', async () => {
    const dir = await root()
    await put(dir, '.zcode-plugin/plugin.json', '{"name":"example","mcpServers":{"same":{"command":"inline"}}}')
    await put(dir, '.mcp.json', '{"mcpServers":{"same":{"command":"file"},"extra":{"command":"extra"}}}')
    const config = await discoverMcp(dir, [])
    expect(config?.servers.same).toMatchObject({ command: 'inline' })
    expect(Object.keys(config!.servers).sort()).toEqual(['extra', 'same'])
  })
})
