import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverSuitesInSource } from '../src/catalog/suite-scanner.js'
import { Catalog } from '../src/application/catalog.js'
import { validateMcpJson, validatePluginManifest, expandPlaceholders, pathContainmentError } from '../src/catalog/validate.js'
import { required } from './helpers/fixture.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures')

describe('discovery: agent-plugins.org v1 layout', () => {
  it('normalizes a single portable suite with skills and mcp', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'v1-suite'), 'demo', 'user')
    expect(suites).toHaveLength(1)
    const suite = required(suites[0], 'the v1 fixture to yield one suite')
    expect(suite.manifest.layout).toBe('agent-plugin-v1')
    expect(suite.manifest.name).toBe('v1-suite')
    expect(suite.manifest.version).toBe('1.2.3')
    expect(suite.manifest.keywords).toEqual(['fixture', 'v1'])
    expect(suite.skills.map(skill => skill.name)).toEqual(['greet'])
    const mcp = required(suite.mcp, 'the v1 fixture suite to declare mcp servers')
    expect(Object.keys(mcp.servers)).toEqual(['toolbox', 'remote'])
    expect(suite.surfaces).toMatchObject({ skills: 1, mcp: 2 })
    expect(suite.errors).toEqual([])
  })
})

describe('discovery: Claude Code marketplace layout', () => {
  it('uses the marketplace manifest, keeps local entries and remote references', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'cc-marketplace'), 'cc', 'user')
    expect(suites.map(suite => suite.id)).toEqual(['demo-one', 'demo-two', 'demo-three', 'external-one', 'typescript-lsp', 'extra-plugin'])
    const demoOne = required(suites[0], 'demo-one as the first marketplace entry')
    expect(demoOne.manifest.layout).toBe('claude-code')
    expect(required(demoOne.skills[0], 'demo-one to ship one skill').name).toBe('demo-one')
    // A manifest-less marketplace entry still surfaces as a skill collection.
    const demoThree = required(suites[2], 'demo-three as the third marketplace entry')
    expect(demoThree.manifest.layout).toBe('skill-collection')
    expect(required(demoThree.skills[0], 'demo-three to ship one skill').name).toBe('demo-three')
    // Remote-URL entries surface as metadata-only remote suites.
    const externalOne = required(suites[3], 'external-one as the fourth marketplace entry')
    expect(externalOne.manifest.layout).toBe('remote')
    expect(externalOne.remote).toEqual({ url: 'https://github.com/example/external.git' })
    expect(externalOne.root).toBe('')
    // A manifest-bearing container dir the marketplace did not list is supplemented.
    const extraPlugin = required(suites[5], 'extra-plugin as the sixth marketplace entry')
    expect(extraPlugin.manifest.layout).toBe('claude-code')
    expect(extraPlugin.manifest.name).toBe('extra-plugin')
  })

  it('surfaces inline lspServers declared on a marketplace entry', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'cc-marketplace'), 'cc', 'user')
    const lsp = required(
      suites.find(suite => suite.id === 'typescript-lsp'),
      'the cc-marketplace fixture to list a typescript-lsp suite'
    )
    // A declaration-only suite: the entry's inline lspServers are its manifest.
    expect(lsp.manifest.layout).toBe('claude-code')
    const declared = required(lsp.lsp, 'the typescript-lsp entry to declare inline lspServers')
    const spec = required(declared.servers['typescript'], 'a typescript server in the inline lspServers')
    expect(spec).toMatchObject({ key: 'typescript', command: 'typescript-language-server', args: ['--stdio'] })
    expect(spec.extensionToLanguage).toEqual({ '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.jsx': 'javascriptreact' })
    expect(lsp.surfaces.lsp).toBe(1)
    expect(lsp.errors).toEqual([])
    // Suites without declarations carry no lsp field.
    const plain = required(suites[0], 'a first marketplace entry without lsp declarations')
    expect(plain.lsp).toBeUndefined()
    expect(plain.surfaces.lsp).toBe(0)
  })
})

describe('overview: remote marketplace references', () => {
  it('includes the remote source URL on remote suite cards', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-remote-overview-'))
    const manager = new Catalog({ userRoot, dataRoot: `${userRoot}/data`, agentsRoot: `${userRoot}/agents`, onChanged: () => {} })
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
    const demo = required(suites[0], 'demo-tools as the first codex entry')
    expect(demo.manifest.layout).toBe('codex')
    const demoMcp = required(demo.mcp, 'the codex demo-tools entry to declare mcp servers')
    expect(Object.keys(demoMcp.servers)).toEqual(['demo'])
    expect(demoMcp.servers['demo']).toMatchObject({ type: 'streamable-http', url: 'https://mcp.demo.example.com' })
    expect(demo.errors).toEqual([])
    const remoteThing = required(suites[1], 'remote-thing as the second codex entry')
    expect(remoteThing.manifest.layout).toBe('remote')
    expect(remoteThing.remote).toEqual({ url: 'https://github.com/example/remote-thing.git' })
  })

  it('recurses nested plugins containers without a marketplace (Codex runtime layout)', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'codex-runtime'), 'cr', 'user')
    expect(suites.map(suite => suite.id)).toEqual(['deep-tools'])
    const deepTools = required(suites[0], 'deep-tools as the only codex runtime suite')
    expect(deepTools.manifest.layout).toBe('codex')
    expect(deepTools.skills.map(skill => skill.name)).toEqual(['deep'])
    expect(deepTools.errors).toEqual([])
  })
})

describe('discovery: containment of broken content', () => {
  it('keeps valid skills when mcp.json has escaping paths, invalidating only that server', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'bad-mcp'), 'bad', 'user')
    expect(suites).toHaveLength(1)
    const suite = required(suites[0], 'the bad-mcp fixture to yield one suite')
    expect(suite.skills.map(skill => skill.name)).toEqual(['ok-skill'])
    const mcp = required(suite.mcp, 'the suite to keep its valid mcp server')
    expect(Object.keys(mcp.servers)).toEqual(['good'])
    expect(suite.errors.some(error => error.includes('escape'))).toBe(true)
  })

  it('drops skills with non-normalizable frontmatter names', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'bad-skill'), 'bs', 'user')
    expect(suites).toHaveLength(1)
    const suite = required(suites[0], 'the bad-skill fixture to yield one suite')
    expect(suite.skills).toEqual([])
    expect(suite.errors.some(error => error.includes('bad-name'))).toBe(true)
  })

  it('normalizes display-style frontmatter names to kebab-case (codex plugins)', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'display-name-skill'), 'ds', 'user')
    expect(suites).toHaveLength(1)
    const suite = required(suites[0], 'the display-name-skill fixture to yield one suite')
    expect(suite.skills.map(skill => skill.name)).toEqual(['presentations'])
    expect(suite.errors).toEqual([])
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
    const escaped = required(suites[0], 'the escaping suite root to yield one suite')
    expect(escaped.skills).toEqual([])
    // A `../` escape is rejected the same way.
    await writeFile(join(suiteRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'suite', skills: '../../out' }))
    const suites2 = await discoverSuitesInSource(suiteRoot, 'esc', 'user')
    const relativeEscape = required(suites2[0], 'the escaping suite root to yield one suite')
    expect(relativeEscape.skills).toEqual([])
    // A legitimate declared subdirectory still scans.
    await mkdir(join(suiteRoot, 'skills', 'real'), { recursive: true })
    await writeFile(join(suiteRoot, 'skills', 'real', 'SKILL.md'), '---\nname: real\ndescription: r\n---\n')
    await writeFile(join(suiteRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'suite', skills: 'skills' }))
    const suites3 = await discoverSuitesInSource(suiteRoot, 'esc', 'user')
    const declaredSkills = required(suites3[0], 'the escaping suite root to yield one suite')
    expect(declaredSkills.skills.map(skill => skill.name)).toEqual(['real'])
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
    const valid = required(config, 'a config kept after dropping the escaping server')
    expect(Object.keys(valid.servers)).toEqual(['good'])
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
    const lenient = required(config, 'a config for the lenient top-level server map')
    expect(lenient.servers['github']).toMatchObject({ type: 'streamable-http', url: 'https://api.example.com/mcp' })
  })

  it.each([
    ['a command-only server (Claude Code default)', 'local', { command: 'bun', args: ['start'] }, 'bun'],
    ['the Claude Code local transport', 'script', { type: 'local', command: 'node', args: ['server.js'] }, 'node']
  ])('normalizes %s to stdio', async (_label, name, server, command) => {
    const { config, errors } = await validateMcpJson('/tmp/fixture-root', { mcpServers: { [name]: server } }, { strict: false })
    expect(errors).toEqual([])
    expect(required(config, 'a config for the normalized stdio server').servers[name]).toMatchObject({ type: 'stdio', command })
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
    const suite = required(suites[0], 'order-crud as the only flat-skills suite')
    expect(suite.manifest.layout).toBe('skill-collection')
    const skill = required(suite.skills[0], 'order-crud to ship one skill')
    expect(skill.name).toBe('order-crud')
    expect(skill.description).toContain('order CRUD code')
  })
})

describe('suite detail and skill content (market detail endpoints)', () => {
  it('lists skills, mcp servers, and file lists from the v1 fixture', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-det-'))
    const manager = new Catalog({ userRoot, dataRoot: `${userRoot}/data`, agentsRoot: `${userRoot}/agents`, onChanged: () => {} })
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
    const names = required(suites[0], 'the cc-commands fixture to yield one suite').skills.map(skill => skill.name)
    expect(names).toContain('ask-matt')
    expect(names).toContain('plain')
  })
})

describe('suite detail: hooks preview entries', () => {
  it('flattens CC hooks.json into event/matcher/command entries', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-hooks-'))
    const manager = new Catalog({ userRoot, dataRoot: `${userRoot}/data`, agentsRoot: `${userRoot}/agents`, onChanged: () => {} })
    await manager.load()
    await manager.mergeSources([{ id: 'cc', url: join(fixtures, 'cc-commands'), local: true }])
    const detail = await manager.suiteDetail('cc', 'cc-commands')
    const hooks = detail['hooks']
    expect(hooks.count).toBe(1)
    expect(hooks.entries[0]).toMatchObject({ event: 'PreToolUse', matcher: 'Bash', command: 'echo hi' })
  })
})

describe('multi-client manifest paradigms (vercel-style)', () => {
  it.each([
    ['cursor-only', 'cursor', 'foo'],
    ['universal-only', 'universal', 'baz']
  ])('discovers a %s repo and honors its declared skills path', async (dir, layout, skillName) => {
    const suites = await discoverSuitesInSource(join(fixtures, dir), dir, 'user')
    expect(suites).toHaveLength(1)
    const suite = required(suites[0], `${dir} to yield one suite`)
    expect(suite.manifest.layout).toBe(layout)
    expect(suite.skills.map(skill => skill.name)).toEqual([skillName])
  })

  it('discovers a kimi-only repo, honoring declared skills and mapping http to streamable-http', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'kimi-only'), 'k', 'user')
    expect(suites).toHaveLength(1)
    const suite = required(suites[0], 'the kimi-only fixture to yield one suite')
    expect(suite.manifest.layout).toBe('kimi')
    expect(suite.skills.map(skill => skill.name)).toEqual(['bar'])
    const mcp = required(suite.mcp, 'the kimi-only suite to declare an mcp server')
    expect(Object.keys(mcp.servers)).toEqual(['k'])
    expect(mcp.servers['k']).toMatchObject({ type: 'streamable-http', url: 'https://x' })
    expect(suite.errors).toEqual([])
  })

  it('reads .mcp.json leniently: maps http to streamable-http and keeps known transports', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'dot-mcp'), 'd', 'user')
    expect(suites).toHaveLength(1)
    const suite = required(suites[0], 'the dot-mcp fixture to yield one suite')
    const mcp = required(suite.mcp, 'the dot-mcp suite to declare mcp servers')
    expect(Object.keys(mcp.servers)).toEqual(['httpSrv', 'good'])
    expect(mcp.servers['httpSrv']).toMatchObject({ type: 'streamable-http', url: 'https://mcp.example.com' })
    expect(suite.errors).toEqual([])
  })
})
