import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { discoverProjectMcp } from '../src/catalog/project-config.js'
import { mountProjectMcp } from '../src/runtime/project-runtime.js'
import { discoverNativeProjectSuites } from '../src/catalog/native-project.js'
import { toMcpMounts } from '../src/runtime/mcp-config.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'

const roots: string[] = []
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'market-project-mcp-'))
  roots.push(path)
  await mkdir(join(path, '.git'))
  return path
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('native project MCP configurations', () => {
  it('reads Codex TOML and carries credentials, tool restrictions and timeouts into bridge requests', async () => {
    const project = await root()
    await mkdir(join(project, '.codex'))
    await writeFile(
      join(project, '.codex/config.toml'),
      `model = "unrelated-model"
[mcp_servers.local]
command = "/usr/bin/example"
args = ["--label", "example with spaces"]
env_vars = ["API_TOKEN"]
env = { MODE = "test" }
enabled_tools = ["search", "write"]
disabled_tools = ["write"]
startup_timeout_sec = 2.5
tool_timeout_sec = 4
[mcp_servers.remote]
url = "https://example.test/mcp"
bearer_token_env_var = "MCP_TOKEN"
env_http_headers = { "X-Project" = "PROJECT_ID" }
http_headers = { "X-Static" = "static" }
[mcp_servers.disabled]
enabled = false
command = "never-run"
`
    )
    const [suite] = await discoverNativeProjectSuites(project, 'project')
    expect(suite?.errors).toEqual([])
    expect(suite?.surfaces.mcp).toBe(2)
    const { mounts, failures } = await toMcpMounts(withDefaultSurfaces(suite), '/runtime', {}, { resolve: async ref => ({ value: `resolved-${ref}` }) })
    expect(failures).toEqual([])
    expect(mounts[0]?.config).toMatchObject({
      command: '/usr/bin/example',
      cwd: project,
      env: { API_TOKEN: 'resolved-API_TOKEN', MODE: 'test' },
      enabledTools: ['search', 'write'],
      disabledTools: ['write'],
      startupTimeoutMs: 2500,
      toolCallTimeoutMs: 4000
    })
    expect(mounts[1]?.config).toMatchObject({ headers: { Authorization: 'Bearer resolved-MCP_TOKEN', 'X-Project': 'resolved-PROJECT_ID', 'X-Static': 'static' } })
  })

  it('rejects malformed or unsupported Codex server policies without losing valid neighbors', async () => {
    const project = await root()
    await mkdir(join(project, '.codex'))
    await writeFile(
      join(project, '.codex/config.toml'),
      `[mcp_servers.good]
command = "server"
enabled_tools = []
[mcp_servers.mixed]
command = "server"
url = "https://example.test"
[mcp_servers.bad_enabled]
enabled = "false"
command = "server"
[mcp_servers.unknown]
command = "server"
unknown_policy = true
[mcp_servers.bad_timeout]
command = "server"
tool_timeout_sec = nan
`
    )
    const errors: string[] = []
    const config = await discoverProjectMcp(project, ['.codex/config.toml'], errors, 'codex')
    expect(Object.keys(config!.servers)).toEqual(['good'])
    expect(config?.servers.good?.enabledTools).toEqual([])
    expect(errors).toHaveLength(4)
    await writeFile(join(project, '.codex/config.toml'), 'secret = "DO_NOT_LOG\n')
    const invalid: string[] = []
    expect(await discoverProjectMcp(project, ['.codex/config.toml'], invalid, 'codex')).toBeUndefined()
    expect(invalid).toEqual(['.codex/config.toml: project configuration is invalid TOML'])
  })

  it('diagnoses project LSP configuration without activating an LSP surface', async () => {
    const project = await root()
    await mkdir(join(project, '.codex'))
    await writeFile(join(project, '.codex/config.toml'), '[lsp_servers.typescript]\ncommand = "never-start"\n')
    await writeFile(join(project, '.lsp.json'), '{"typescript":{"command":"never-start"}}')
    const suites = await discoverNativeProjectSuites(project, 'project')
    expect(suites).toHaveLength(2)
    expect(suites.every(suite => suite.activeSurfaces?.lsp === false && suite.lsp === undefined)).toBe(true)
    expect(suites.flatMap(suite => suite.errors).every(error => error.includes('project LSP'))).toBe(true)
  })

  it('keeps installed project-suite LSP disabled and reports the host boundary on its source', async () => {
    const project = await root()
    const userRoot = await root()
    const source = await root()
    await writeFile(join(source, '.mcp.json'), '{"mcpServers":{}}')
    await writeFile(
      join(source, 'plugin.json'),
      JSON.stringify({ name: 'project-language', lspServers: { ts: { command: 'language-server', extensionToLanguage: { '.ts': 'typescript' } } } })
    )
    const dimensionRoot = join(project, '.dsh/agent-plugins')
    await mkdir(dimensionRoot, { recursive: true })
    await writeFile(
      join(dimensionRoot, 'state.json'),
      JSON.stringify({
        version: 1,
        sources: [{ id: 'local', url: source, local: true }],
        installed: { 'local/project-language': { enabled: true, installedAt: '2026-09-09T00:00:00Z' } }
      })
    )
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await catalog.load()
    const snapshot = await catalog.readProjectCatalog(project)
    expect(snapshot.enabledSuites[0]?.activeSurfaces.lsp).toBe(false)
    expect(snapshot.scanNotes?.local?.join('\n')).toContain('project LSP declarations are not mounted')
  })
  it('reads ZCode nested servers and uses the agents fallback only when no native server exists', async () => {
    const project = await root()
    await mkdir(join(project, '.zcode'))
    await mkdir(join(project, '.agents'))
    await writeFile(join(project, '.agents/mcp.json'), '{"mcpServers":{"fallback":{"command":"fallback"}}}')
    const files = ['zcode.json', '.zcode/config.json']
    expect(Object.keys((await discoverProjectMcp(project, files, [], 'zcode'))!.servers)).toEqual(['fallback'])
    await writeFile(join(project, '.zcode/config.json'), '{"mcp":{"servers":{"native":{"command":"native"},"off":{"command":"disabled","enabled":false}}}}')
    expect(Object.keys((await discoverProjectMcp(project, files, [], 'zcode'))!.servers)).toEqual(['native'])
  })
  it('reads Qoder MCP keys only, merges local overrides, and supports native absolute commands', async () => {
    const project = await root()
    await mkdir(join(project, '.qoder'))
    await writeFile(
      join(project, '.qoder/settings.json'),
      JSON.stringify({ model: 'ignored', mcpServers: { example: { command: '/usr/bin/example' }, remote: { url: 'https://example.test/mcp' } } })
    )
    await writeFile(join(project, '.qoder/settings.local.json'), JSON.stringify({ permissions: {}, mcpServers: { example: { command: '/usr/bin/local-example', cwd: project } } }))
    const errors: string[] = []
    const config = await discoverProjectMcp(project, ['.qoder/settings.json', '.qoder/settings.local.json'], errors)
    expect(errors).toEqual([])
    expect(Object.keys(config!.servers).sort()).toEqual(['example', 'remote'])
    expect(config!.servers.example).toMatchObject({ command: '/usr/bin/local-example', cwd: project })
    expect(config!.servers.remote).toMatchObject({ type: 'streamable-http' })
    expect(config!.root).toBe(project)
  })

  it('rejects a malformed higher-priority layer without reviving overridden servers', async () => {
    const project = await root()
    await writeFile(join(project, '.mcp.json'), '{"mcpServers":{"server":{"command":"example"}}}')
    await writeFile(join(project, 'local.json'), '{broken')
    const errors: string[] = []
    expect(await discoverProjectMcp(project, ['.mcp.json', 'local.json'], errors)).toBeUndefined()
    expect(errors).toEqual(['local.json: project configuration is invalid JSON'])
  })

  it('rejects configuration symlinks escaping the project', async () => {
    const project = await root()
    const external = await root()
    await writeFile(join(external, 'servers.json'), '{"mcpServers":{}}')
    await symlink(join(external, 'servers.json'), join(project, '.mcp.json'))
    const errors: string[] = []
    expect(await discoverProjectMcp(project, ['.mcp.json'], errors)).toBeUndefined()
    expect(errors.join()).toContain('escapes the project root')
  })
})

describe('project MCP runtime scope', () => {
  it('mounts distinct project configs in distinct agent contexts and removes both on switch-off', async () => {
    const first = await root()
    const second = await root()
    const userRoot = await root()
    for (const [index, project] of [first, second].entries()) {
      await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { example: { command: `server-${index}` } } }))
    }
    const scopes: Array<Map<string, { serverName: string; command: string; cwd: string }>> = []
    const agents = [first, second].map(cwd => ({
      session: { header: { cwd } },
      ctx: {
        inject: (services: string[], callback: (scope: unknown) => void) => {
          expect(services).toEqual(['tools'])
          const mounts = new Map<string, { serverName: string; command: string; cwd: string }>()
          scopes.push(mounts)
          const cleanups: Array<() => Promise<void>> = []
          callback({
            plugin: (_plugin: unknown, config: { serverName: string; command: string; cwd: string }) => {
              mounts.set(config.serverName, config)
              return {
                await: async () => {},
                dispose: async () => {
                  mounts.delete(config.serverName)
                }
              }
            },
            effect: (setup: () => () => Promise<void>) => {
              cleanups.push(setup())
            }
          })
          return {
            dispose: async () => {
              await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
            }
          }
        }
      }
    }))
    const host = { agents: { list: () => agents }, on: () => () => {}, logger: { warn: () => {} } }
    const catalog = new Catalog({
      userRoot,
      dataRoot: join(userRoot, 'data'),
      onChanged: async () => {
        await runtime.refresh()
      }
    })
    await catalog.load()
    const runtime = mountProjectMcp(host as unknown as Context, catalog, join(userRoot, 'data'))
    try {
      await runtime.refresh()
      expect([...scopes[0].values()]).toEqual([expect.objectContaining({ command: 'server-0', cwd: first })])
      expect([...scopes[1].values()]).toEqual([expect.objectContaining({ command: 'server-1', cwd: second })])
      expect([...scopes[0].keys()]).not.toEqual([...scopes[1].keys()])
      await catalog.setScanProjectLayouts(false)
      expect(scopes.map(scope => scope.size)).toEqual([0, 0])
      await catalog.setScanProjectLayouts(true)
      expect(scopes.map(scope => scope.size)).toEqual([1, 1])
    } finally {
      await runtime.dispose()
    }
    expect(scopes.map(scope => scope.size)).toEqual([0, 0])
  })
})
