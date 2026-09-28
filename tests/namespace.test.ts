/**
 * The `com.deepseek.harness` extension namespace (Agent Plugins §8): manifest
 * data under `extensions`, file-based extension surfaces under the top-level
 * namespace directory, and the portable-dialect reading rules that keep the
 * fixed locations (`skills/`, `mcp.json`) as the only other package inputs.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverSuitesInSource } from '../src/catalog/suite-scanner.js'
import { toMcpMounts } from '../src/application/mcp/mcp-config.js'
import { effectiveSurfaces, type Suite } from '../src/model/types.js'
import { required } from './helpers/fixture.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures')

function portableSuite(overrides: Partial<Suite> = {}): Suite {
  return {
    sourceId: 'demo',
    id: 'my-suite',
    root: '/tmp/my-suite',
    manifest: { layout: 'agent-plugin-v1', path: '/tmp/my-suite/plugin.json', id: 'my-suite', name: 'My Suite' },
    skills: [],
    surfaces: { skills: 0, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 0 },
    // An installed third-party portable suite is the 'market' dimension;
    // 'user' marks the user's own ~/.agents suite, which keeps the credential seam.
    dimension: 'project',
    enabled: true,
    activeSurfaces: effectiveSurfaces(undefined),
    errors: [],
    ...overrides
  }
}

describe('namespace: com.deepseek.harness extension data', () => {
  it('reads the namespace policy onto portable MCP servers and reports unmatched names', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'v1-suite'), 'demo', 'user')
    const suite = required(suites[0], 'the v1 fixture to yield one suite')
    expect(suite.manifest.harness).toBeDefined()
    expect(suite.manifest.harness?.schemaVersion).toBe('1.0.0')
    // The policy rides the manifest; the portable mcp.json body stays pristine.
    expect(suite.manifest.harness?.mcpServers['remote']).toEqual({ auth: { enabled: true, scope: 'mcp:read' }, toolCallTimeoutMs: 45000 })
    expect(suite.manifest.harness?.mcpServers['ghost']).toEqual({ enabledTools: ['ping'] })
    expect(suite.mcp?.servers['remote']).toMatchObject({ type: 'streamable-http' })
    // The unmatched name is namespace-internal diagnostics territory, not a suite error.
    expect(suite.errors.join('\n')).not.toContain('ghost')
  })

  it('ignores unknown namespaces without validating their contents (§8.1)', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'v1-suite'), 'demo', 'user')
    const suite = required(suites[0], 'the v1 fixture to yield one suite')
    // The suite loaded despite `com.other.client` carrying arbitrary data.
    expect(suite.manifest.layout).toBe('agent-plugin-v1')
    expect(suite.manifest.harness?.schemaVersion).toBe('1.0.0')
  })

  it('skips the whole namespace when schemaVersion is unsupported, keeping portable surfaces', async () => {
    const { readFile } = await import('node:fs/promises')
    const root = await mkdtemp(join(tmpdir(), 'market-ns-version-'))
    try {
      await cp(join(fixtures, 'v1-suite'), root, { recursive: true })
      const manifest = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8')) as { extensions: { 'com.deepseek.harness': { schemaVersion: string } } }
      manifest.extensions['com.deepseek.harness'].schemaVersion = '9.9.9'
      await writeFile(join(root, 'plugin.json'), JSON.stringify(manifest))
      const suites = await discoverSuitesInSource(root, 'demo', 'user')
      const suite = required(suites[0], 'the suite to load with an unsupported namespace version')
      expect(suite.manifest.harness).toBeUndefined()
      // Portable surfaces are unaffected.
      expect(suite.skills.map(skill => skill.name)).toEqual(['greet'])
      expect(suite.mcp?.servers['toolbox']).toBeDefined()
      // Namespace directories are not read.
      expect(suite.surfaces.commands).toBe(0)
      expect(suite.surfaces.agents).toBe(0)
      expect(suite.surfaces.hooks).toBe(0)
      expect(suite.surfaces.lsp).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('namespace: extension directory surfaces (§8.2)', () => {
  it('reads commands, agents, hooks, and lsp from the namespace directory', async () => {
    const suites = await discoverSuitesInSource(join(fixtures, 'v1-suite'), 'demo', 'user')
    const suite = required(suites[0], 'the v1 fixture to yield one suite')
    expect(suite.resources?.commands.map(command => command.name)).toEqual(['deploy'])
    expect(suite.resources?.agents.map(agent => agent.name)).toEqual(['reviewer'])
    expect(suite.hooks?.events['PreToolUse']).toHaveLength(1)
    expect(suite.lsp?.servers['typescript']).toMatchObject({ command: 'typescript-language-server', args: ['--stdio'] })
    expect(suite.surfaces).toMatchObject({ commands: 1, agents: 1, hooks: 1, lsp: 1, skills: 1, mcp: 2 })
  })

  it('reports unread root component directories and files instead of reading them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-ns-root-'))
    try {
      await cp(join(fixtures, 'v1-suite'), root, { recursive: true })
      await mkdir(join(root, 'commands'), { recursive: true })
      await writeFile(join(root, 'commands', 'legacy.md'), '---\ndescription: Legacy\n---\nLegacy command.')
      await mkdir(join(root, 'hooks'), { recursive: true })
      await writeFile(join(root, 'hooks', 'hooks.json'), '{}')
      const suites = await discoverSuitesInSource(root, 'demo', 'user')
      const suite = required(suites[0], 'the suite to survive unread root components')
      // The namespace copies are read; the root copies are not.
      expect(suite.resources?.commands.map(command => command.name)).toEqual(['deploy'])
      expect(suite.surfaces.hooks).toBe(1)
      expect(suite.surfaces.commands).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not read .mcp.json for a portable suite (§7.2.1: no alternative core path)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-ns-dotmcp-'))
    try {
      await cp(join(fixtures, 'v1-suite'), root, { recursive: true })
      await writeFile(join(root, '.mcp.json'), JSON.stringify({ sneaky: { type: 'stdio', command: 'sneaky' } }))
      const suites = await discoverSuitesInSource(root, 'demo', 'user')
      const suite = required(suites[0], 'the suite to load with a stray .mcp.json')
      expect(Object.keys(suite.mcp?.servers ?? {})).toEqual(['toolbox', 'remote'])
      expect(suite.errors.join('\n')).not.toContain('sneaky')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('namespace: portable placeholder discipline (§9.2)', () => {
  it('keeps unrecognized placeholders literal and skips credential lookup for portable suites', async () => {
    const suite = portableSuite({
      manifest: {
        layout: 'agent-plugin-v1',
        path: '/tmp/my-suite/plugin.json',
        id: 'my-suite',
        name: 'My Suite',
        schemaVersion: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
      },
      mcp: {
        schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
        servers: { db: { type: 'stdio', command: 'db', args: ['--flag', '${NOT_A_CREDENTIAL}'] } }
      }
    })
    const { mounts, failures } = await toMcpMounts(suite, '/tmp/data', {}, { resolve: async () => undefined })
    expect(failures).toEqual([])
    const [mount] = mounts.map(candidate => candidate.config)
    if (mount === undefined || mount.transport !== 'stdio') throw new Error('expected the portable stdio server to mount without credential resolution')
    expect(mount.args).toEqual(['--flag', '${NOT_A_CREDENTIAL}'])
  })

  it('resolves credential references for user-owned dialect-native suites', async () => {
    const suite = portableSuite({
      manifest: { layout: 'claude-code', path: '/tmp/my-suite/.claude-plugin/plugin.json', id: 'my-suite', name: 'My Suite' },
      mcp: {
        schema: 'native-client',
        servers: { db: { type: 'stdio', command: 'db', env: { TOKEN: '${MY_TOKEN}' } } }
      }
    })
    const { mounts, failures } = await toMcpMounts(suite, '/tmp/data', {}, { resolve: async () => ({ value: 'secret' }) })
    expect(failures).toEqual([])
    const [mount] = mounts.map(candidate => candidate.config)
    if (mount === undefined || mount.transport !== 'stdio') throw new Error('expected the dialect-native stdio server to resolve its credential')
    expect(mount.env).toMatchObject({ TOKEN: 'secret', PLUGIN_ROOT: '/tmp/my-suite', PLUGIN_DATA: '/tmp/data/demo/my-suite' })
  })

  it('applies the namespace OAuth policy through the mount config', async () => {
    const suite = portableSuite({
      manifest: {
        layout: 'agent-plugin-v1',
        path: '/tmp/my-suite/plugin.json',
        id: 'my-suite',
        name: 'My Suite',
        schemaVersion: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
        harness: { schemaVersion: '1.0.0', mcpServers: { web: { auth: { enabled: true, scope: 'mcp:read' } } } }
      },
      mcp: {
        schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
        servers: { web: { type: 'streamable-http', url: 'https://example.com/mcp' } }
      }
    })
    const { mounts, failures } = await toMcpMounts(suite, '/tmp/data', {}, { resolve: async () => undefined })
    expect(failures).toEqual([])
    const [mount] = mounts.map(candidate => candidate.config)
    if (mount === undefined || mount.transport !== 'streamable-http') throw new Error('expected the portable remote server to mount')
    expect(mount).toMatchObject({ transport: 'streamable-http', auth: { enabled: true, scope: 'mcp:read' } })
  })
})
