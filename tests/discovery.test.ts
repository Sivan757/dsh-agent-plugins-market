import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverSuitesInSource } from '../src/catalog/suite-scanner.js'
import { Catalog } from '../src/application/catalog.js'
import { validateMcpJson, validatePluginManifest, expandPlaceholders, pathContainmentError } from '../src/catalog/validate.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures')

describe('discovery: agent-plugins.org v1 layout', () => {
  it('normalizes a single portable suite with skills and mcp', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'v1-suite'), 'demo', 'user')
    expect(suites).toHaveLength(1)
    const suite = suites[0]!
    expect(suite.manifest.layout).toBe('agent-plugin-v1')
    expect(suite.manifest.name).toBe('v1-suite')
    expect(suite.manifest.version).toBe('1.2.3')
    expect(suite.manifest.keywords).toEqual(['fixture', 'v1'])
    expect(suite.skills.map(skill => skill.name)).toEqual(['greet'])
    expect(suite.mcp).toBeDefined()
    expect(Object.keys(suite.mcp!.servers)).toEqual(['toolbox', 'remote'])
    expect(suite.surfaces).toMatchObject({ skills: 1, mcp: 2 })
    expect(suite.errors).toEqual([])
  })
})

describe('discovery: Claude Code marketplace layout', () => {
  it('uses the marketplace manifest, keeps local entries and remote references', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'cc-marketplace'), 'cc', 'user')
    expect(suites.map(suite => suite.id)).toEqual(['demo-one', 'demo-two', 'demo-three', 'external-one', 'typescript-lsp', 'extra-plugin'])
    expect(suites[0]!.manifest.layout).toBe('claude-code')
    expect(suites[0]!.skills[0]!.name).toBe('demo-one')
    // A manifest-less marketplace entry still surfaces as a skill collection.
    expect(suites[2]!.manifest.layout).toBe('skill-collection')
    expect(suites[2]!.skills[0]!.name).toBe('demo-three')
    // Remote-URL entries surface as metadata-only remote suites.
    expect(suites[3]!.manifest.layout).toBe('remote')
    expect(suites[3]!.remote).toEqual({ url: 'https://github.com/example/external.git' })
    expect(suites[3]!.root).toBe('')
    // A manifest-bearing container dir the marketplace did not list is supplemented.
    expect(suites[5]!.manifest.layout).toBe('claude-code')
    expect(suites[5]!.manifest.name).toBe('extra-plugin')
  })

  it('surfaces inline lspServers declared on a marketplace entry', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'cc-marketplace'), 'cc', 'user')
    const lsp = suites.find(suite => suite.id === 'typescript-lsp')!
    expect(lsp).toBeDefined()
    // A declaration-only suite: the entry's inline lspServers are its manifest.
    expect(lsp.manifest.layout).toBe('claude-code')
    expect(lsp.lsp).toBeDefined()
    const spec = lsp.lsp!.servers['typescript']!
    expect(spec).toMatchObject({ key: 'typescript', command: 'typescript-language-server', args: ['--stdio'] })
    expect(spec.extensionToLanguage).toEqual({ '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.jsx': 'javascriptreact' })
    expect(lsp.surfaces.lsp).toBe(1)
    expect(lsp.errors).toEqual([])
    // Suites without declarations carry no lsp field.
    expect(suites[0]!.lsp).toBeUndefined()
    expect(suites[0]!.surfaces.lsp).toBe(0)
  })
})

describe('overview: remote marketplace references', () => {
  it('includes the remote source URL on remote suite cards', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-remote-overview-'))
    const manager = new Catalog({ userRoot, dataRoot: `${userRoot}/data`, onChanged: () => {} })
    await manager.load()
    await manager.mergeSources([{ id: 'cc', url: join(fixtures, 'cc-marketplace'), local: true }])

    const overview = await manager.overview()
    const remote = overview.suites.find(suite => suite.suiteId === 'external-one')
    expect(remote).toMatchObject({ remoteUrl: 'https://github.com/example/external.git' })
  })
})

describe('discovery: Codex marketplace and nested bundles', () => {
  it('reads .agents/plugins/marketplace.json with Codex source objects, validating MCP', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'codex-bundled'), 'cb', 'user')
    expect(suites.map(suite => suite.id)).toEqual(['demo-tools', 'remote-thing'])
    const demo = suites[0]!
    expect(demo.manifest.layout).toBe('codex')
    expect(demo.mcp).toBeDefined()
    expect(Object.keys(demo.mcp!.servers)).toEqual(['demo'])
    expect(demo.mcp!.servers['demo']).toMatchObject({ type: 'streamable-http', url: 'https://mcp.demo.example.com' })
    expect(demo.errors).toEqual([])
    expect(suites[1]!.manifest.layout).toBe('remote')
    expect(suites[1]!.remote).toEqual({ url: 'https://github.com/example/remote-thing.git' })
  })

  it('recurses nested plugins containers without a marketplace (Codex runtime layout)', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'codex-runtime'), 'cr', 'user')
    expect(suites.map(suite => suite.id)).toEqual(['deep-tools'])
    expect(suites[0]!.manifest.layout).toBe('codex')
    expect(suites[0]!.skills.map(skill => skill.name)).toEqual(['deep'])
    expect(suites[0]!.errors).toEqual([])
  })
})

describe('discovery: containment of broken content', () => {
  it('keeps valid skills when mcp.json has escaping paths, invalidating only that server', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'bad-mcp'), 'bad', 'user')
    expect(suites).toHaveLength(1)
    const suite = suites[0]!
    expect(suite.skills.map(skill => skill.name)).toEqual(['ok-skill'])
    expect(Object.keys(suite.mcp!.servers)).toEqual(['good'])
    expect(suite.errors.some(error => error.includes('escape'))).toBe(true)
  })

  it('drops skills with non-normalizable frontmatter names', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'bad-skill'), 'bs', 'user')
    expect(suites).toHaveLength(1)
    expect(suites[0]!.skills).toEqual([])
    expect(suites[0]!.errors.some(error => error.includes('bad-name'))).toBe(true)
  })

  it('normalizes display-style frontmatter names to kebab-case (codex plugins)', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'display-name-skill'), 'ds', 'user')
    expect(suites).toHaveLength(1)
    expect(suites[0]!.skills.map(skill => skill.name)).toEqual(['presentations'])
    expect(suites[0]!.errors).toEqual([])
  })

  it('rejects manifest-declared skills paths that escape the suite root', async () => {
    // Regression: containment used a bare string-prefix test, so a declared
    // path resolving to a sibling directory (`<root>-evil`) passed the check
    // and SKILL.md files outside the suite were scanned.
    const { mkdir, writeFile, rm } = await import('node:fs/promises')
    const stage = await mkdtemp(join(tmpdir(), 'dsh-escape-'))
    const suiteRoot = join(stage, 'suite')
    const evil = `${stage}-evil`
    await mkdir(join(suiteRoot, '.claude-plugin'), { recursive: true })
    await mkdir(evil, { recursive: true })
    await writeFile(join(evil, 'SKILL.md'), '---\nname: evil\ndescription: outside\n---\n')
    await writeFile(join(suiteRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'suite', skills: '../suite-evil' }))
    const suites = await discoverSuitesInSource(suiteRoot, 'esc', 'user')
    expect(suites[0]!.skills).toEqual([])
    // A `../` escape is rejected the same way.
    await writeFile(join(suiteRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'suite', skills: '../../out' }))
    const suites2 = await discoverSuitesInSource(suiteRoot, 'esc', 'user')
    expect(suites2[0]!.skills).toEqual([])
    // A legitimate declared subdirectory still scans.
    await mkdir(join(suiteRoot, 'skills', 'real'), { recursive: true })
    await writeFile(join(suiteRoot, 'skills', 'real', 'SKILL.md'), '---\nname: real\ndescription: r\n---\n')
    await writeFile(join(suiteRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'suite', skills: 'skills' }))
    const suites3 = await discoverSuitesInSource(suiteRoot, 'esc', 'user')
    expect(suites3[0]!.skills.map(skill => skill.name)).toEqual(['real'])
    await rm(stage, { recursive: true, force: true })
    await rm(evil, { recursive: true, force: true })
  })
})

describe('validate: manifest and mcp.json', () => {
  it('accepts the recognized 1.0.0 schema', async () => {
    const errors = await validatePluginManifest({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'ok' })
    expect(errors).toEqual([])
  })

  it('rejects an unknown $schema', async () => {
    const errors = await validatePluginManifest({ $schema: 'https://example.com/other.json', name: 'ok' })
    expect(errors.some(error => error.includes('unrecognized'))).toBe(true)
  })

  it('rejects a missing name', async () => {
    const errors = await validatePluginManifest({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json' })
    expect(errors.some(error => error.includes('name'))).toBe(true)
  })

  it('enforces §4 path containment for stdio command', async () => {
    const { config, errors } = await validateMcpJson('/tmp/fixture-root', {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        bad: { type: 'stdio', command: '../outside' },
        good: { type: 'stdio', command: './bin/ok' }
      }
    })
    expect(errors.some(error => error.includes('bad'))).toBe(true)
    expect(Object.keys(config!.servers)).toEqual(['good'])
  })

  it('rejects unknown mcp.json $schema wholesale', async () => {
    const { config, errors } = await validateMcpJson('/tmp/fixture-root', {
      $schema: 'https://example.com/mcp.json',
      mcpServers: {}
    })
    expect(config).toBeUndefined()
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects a stdio command without ./ prefix when it is a path', async () => {
    const reason = await pathContainmentError('/tmp/root', '../escape')
    expect(reason).toContain('must begin')
  })

  it('reads a top-level server map leniently (Claude Code .mcp.json shorthand)', async () => {
    const { config, errors } = await validateMcpJson(
      '/tmp/fixture-root',
      {
        github: { type: 'http', url: 'https://api.example.com/mcp', headers: { Authorization: 'Bearer ${TOKEN:-x}' } }
      },
      { strict: false }
    )
    expect(errors).toEqual([])
    expect(config!.servers['github']).toMatchObject({ type: 'streamable-http', url: 'https://api.example.com/mcp' })
  })

  it('treats a command-only server as stdio (Claude Code default)', async () => {
    const { config, errors } = await validateMcpJson(
      '/tmp/fixture-root',
      {
        mcpServers: { local: { command: 'bun', args: ['start'] } }
      },
      { strict: false }
    )
    expect(errors).toEqual([])
    expect(config!.servers['local']).toMatchObject({ type: 'stdio', command: 'bun' })
  })

  it('normalizes the Claude Code local transport to stdio', async () => {
    const { config, errors } = await validateMcpJson(
      '/tmp/fixture-root',
      {
        mcpServers: { script: { type: 'local', command: 'node', args: ['server.js'] } }
      },
      { strict: false }
    )
    expect(errors).toEqual([])
    expect(config!.servers['script']).toMatchObject({ type: 'stdio', command: 'node' })
  })
})

describe('validate: placeholder expansion', () => {
  it('expands PLUGIN_ROOT, PLUGIN_DATA, and process env', () => {
    expect(expandPlaceholders('${PLUGIN_ROOT}/a ${PLUGIN_DATA}/b ${HOME}/c', '/p', '/d', { HOME: '/h' })).toBe('/p/a /d/b /h/c')
    expect(expandPlaceholders('${UNSET_VAR}', '/p', '/d')).toBe('')
  })

  it('honors Claude Code ${NAME:-default} fallbacks', () => {
    expect(expandPlaceholders('${API_KEY:-none}', '/p', '/d', {})).toBe('none')
    expect(expandPlaceholders('${API_KEY:-none}', '/p', '/d', { API_KEY: 'real' })).toBe('real')
    expect(expandPlaceholders('${API_KEY:-none}', '/p', '/d', { API_KEY: '' })).toBe('none')
    expect(expandPlaceholders('${API_KEY:-}', '/p', '/d', {})).toBe('')
  })

  it('expands Claude Code CLAUDE_PLUGIN_ROOT/DATA aliases', () => {
    expect(expandPlaceholders('--cwd ${CLAUDE_PLUGIN_ROOT} ${CLAUDE_PLUGIN_DATA}/x', '/p', '/d')).toBe('--cwd /p /d/x')
  })
})

describe('discovery: manifest-less skill collection layout', () => {
  it('treats flat SKILL.md directories as synthetic suites', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'flat-skills'), 'flat', 'user')
    expect(suites.map(suite => suite.id)).toEqual(['order-crud'])
    expect(suites[0]!.manifest.layout).toBe('skill-collection')
    expect(suites[0]!.skills[0]!.name).toBe('order-crud')
    expect(suites[0]!.skills[0]!.description).toContain('order CRUD code')
  })
})

describe('suite detail and skill content (market detail endpoints)', () => {
  it('lists skills, mcp servers, and file lists from the v1 fixture', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-det-'))
    const manager = new Catalog({ userRoot, dataRoot: `${userRoot}/data`, onChanged: () => {} })
    await manager.load()
    await manager.mergeSources([{ id: 'demo', url: join(fixtures, 'v1-suite'), local: true }])
    const detail = await manager.suiteDetail('demo', 'v1-suite')
    expect(detail).toMatchObject({ name: 'v1-suite', version: '1.2.3', layout: 'agent-plugin-v1' })
    expect((detail['skills'] as Array<{ name: string }>).map(skill => skill.name)).toEqual(['greet'])
    expect((detail['mcpServers'] as Array<{ key: string }>).map(server => server.key)).toEqual(['toolbox', 'remote'])
    const content = await manager.skillContent('demo', 'v1-suite', 'greet')
    expect(content.content).toContain('${CLAUDE_PLUGIN_ROOT}')
    await expect(manager.suiteDetail('demo', 'missing')).rejects.toThrow('not found')
  })
})

describe('category-nested skill collections', () => {
  it('finds skills at skills/<category>/<name>/SKILL.md', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'cc-commands'), 'cc', 'user')
    expect(suites).toHaveLength(1)
    const names = suites[0]!.skills.map(skill => skill.name)
    expect(names).toContain('ask-matt')
    expect(names).toContain('plain')
  })
})

describe('suite detail: hooks preview entries', () => {
  it('flattens CC hooks.json into event/matcher/command entries', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-hooks-'))
    const manager = new Catalog({ userRoot, dataRoot: `${userRoot}/data`, onChanged: () => {} })
    await manager.load()
    await manager.mergeSources([{ id: 'cc', url: join(fixtures, 'cc-commands'), local: true }])
    const detail = await manager.suiteDetail('cc', 'cc-commands')
    const hooks = detail['hooks'] as { count: number; entries: Array<{ event: string; matcher?: string; command: string }> }
    expect(hooks.count).toBe(1)
    expect(hooks.entries[0]).toMatchObject({ event: 'PreToolUse', matcher: 'Bash', command: 'echo hi' })
  })
})

describe('multi-client manifest paradigms (vercel-style)', () => {
  it('discovers a cursor-only repo and honors its declared skills path', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'cursor-only'), 'c', 'user')
    expect(suites).toHaveLength(1)
    expect(suites[0]!.manifest.layout).toBe('cursor')
    expect(suites[0]!.skills.map(skill => skill.name)).toEqual(['foo'])
  })

  it('discovers a kimi-only repo, honoring declared skills and mapping http to streamable-http', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'kimi-only'), 'k', 'user')
    expect(suites).toHaveLength(1)
    expect(suites[0]!.manifest.layout).toBe('kimi')
    expect(suites[0]!.skills.map(skill => skill.name)).toEqual(['bar'])
    expect(suites[0]!.mcp).toBeDefined()
    expect(Object.keys(suites[0]!.mcp!.servers)).toEqual(['k'])
    expect(suites[0]!.mcp!.servers['k']).toMatchObject({ type: 'streamable-http', url: 'https://x' })
    expect(suites[0]!.errors).toEqual([])
  })

  it('discovers a universal-only repo', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'universal-only'), 'u', 'user')
    expect(suites).toHaveLength(1)
    expect(suites[0]!.manifest.layout).toBe('universal')
    expect(suites[0]!.skills.map(skill => skill.name)).toEqual(['baz'])
  })

  it('reads .mcp.json leniently: maps http to streamable-http and keeps known transports', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'dot-mcp'), 'd', 'user')
    expect(suites).toHaveLength(1)
    expect(suites[0]!.mcp).toBeDefined()
    expect(Object.keys(suites[0]!.mcp!.servers)).toEqual(['httpSrv', 'good'])
    expect(suites[0]!.mcp!.servers['httpSrv']).toMatchObject({ type: 'streamable-http', url: 'https://mcp.example.com' })
    expect(suites[0]!.errors).toEqual([])
  })
})
