import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { MCP_SCHEMA_ID, validateAgainstSchema, validateMcpJson } from '../catalog/validate.js'
import { effectiveSurfaces, type McpSuiteConfig, type Suite } from '../model/types.js'

export const USER_MCP_SOURCE = '@user-mcp'
export const USER_MCP_SUITE = 'user-mcp'

/**
 * User-created services reuse the owned bridge lifecycle without changing host configuration.
 *
 * The declarations live in the shared Agent layout root
 * (`~/.agents/mcp.json`), so a service the user adds by hand is ordinary
 * `mcpServers` JSON in the same place other Agent tools look.
 *
 * The suite always carries an `mcp` document — an absent or malformed
 * `mcp.json` leaves an empty one — so callers read `.mcp.servers` directly
 * instead of re-checking the optional field.
 */
export async function loadUserMcpSuite(agentsRoot: string): Promise<Suite & { mcp: McpSuiteConfig }> {
  const path = userMcpPath(agentsRoot)
  let mcp: McpSuiteConfig = { schema: MCP_SCHEMA_ID, servers: {} }
  const errors: string[] = []
  try {
    mcp = await validateUserMcp(agentsRoot, JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`mcp.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  return {
    sourceId: USER_MCP_SOURCE,
    id: USER_MCP_SUITE,
    root: agentsRoot,
    manifest: { layout: 'agent-plugin-v1', path, id: USER_MCP_SUITE, name: USER_MCP_SUITE },
    skills: [],
    mcp,
    surfaces: { skills: 0, mcp: Object.keys(mcp.servers).length, commands: 0, agents: 0, hooks: 0, lsp: 0 },
    dimension: 'user',
    enabled: true,
    // A user-created suite has no install entry and no overrides, so every
    // surface keeps its enabled default.
    activeSurfaces: effectiveSurfaces(undefined),
    installedAt: 'user',
    errors
  }
}

async function validateUserMcp(agentsRoot: string, raw: unknown): Promise<McpSuiteConfig> {
  const errors = await validateAgainstSchema(MCP_SCHEMA_ID, raw)
  if (errors.length > 0) throw new Error(`invalid MCP configuration: ${errors.join('; ')}`)
  const result = await validateMcpJson(agentsRoot, raw)
  if (result.config === undefined || result.errors.length > 0) throw new Error(result.errors.join('; '))
  return result.config
}

/** Add one service atomically; reject collisions and malformed config before writing. */
export async function addUserMcpServer(agentsRoot: string, name: string, server: unknown): Promise<void> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error('invalid MCP server name')
  const suite = await loadUserMcpSuite(agentsRoot)
  if (suite.errors.length > 0) throw new Error(suite.errors.join('; '))
  if (Object.hasOwn(suite.mcp.servers, name)) throw new Error(`MCP server "${name}" already exists`)
  const document = { $schema: MCP_SCHEMA_ID, mcpServers: { ...suite.mcp.servers, [name]: server } }
  await validateUserMcp(agentsRoot, document)
  const path = userMcpPath(agentsRoot)
  await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

/** The user's hand-written MCP declaration file: `<agentsRoot>/mcp.json`. */
export function userMcpPath(agentsRoot: string): string {
  return join(agentsRoot, 'mcp.json')
}
