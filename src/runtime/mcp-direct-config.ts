import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { MCP_SCHEMA_ID, validateMcpJson } from '../catalog/validate.js'
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

/**
 * The user's own declaration file is local data, not a distributable package:
 * keys this client does not know ride along untouched rather than failing the
 * whole file, and the closed-set rule the package schema applies to suites
 * does not apply here.
 */
async function validateUserMcp(agentsRoot: string, raw: unknown): Promise<McpSuiteConfig> {
  const result = await validateMcpJson(agentsRoot, raw, { packageRules: false })
  if (result.config === undefined || result.errors.length > 0) throw new Error(`invalid MCP configuration: ${result.errors.join('; ')}`)
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

/** One pasted entry: the key it lands under and the server definition it carries. */
export interface McpImportEntry {
  name: string
  server: unknown
}

/** What one pasted import wrote, and what it left out with a reason each. */
export interface McpImportResult {
  imported: string[]
  skipped: Array<{ name: string; reason: string }>
}

const SERVER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

/**
 * Import several pasted servers in one write.
 *
 * Every entry is judged on its own so one bad definition cannot take the rest
 * of the paste with it, and an existing name is kept unless the caller asked to
 * overwrite. The file is written once, after every entry has been checked, so a
 * rejected entry never lands half-written beside the accepted ones.
 */
export async function importUserMcpServers(agentsRoot: string, entries: readonly McpImportEntry[], overwrite = false): Promise<McpImportResult> {
  const suite = await loadUserMcpSuite(agentsRoot)
  if (suite.errors.length > 0) throw new Error(suite.errors.join('; '))
  const servers: Record<string, unknown> = { ...suite.mcp.servers }
  const imported: string[] = []
  const skipped: Array<{ name: string; reason: string }> = []
  for (const entry of entries) {
    if (!SERVER_NAME_PATTERN.test(entry.name)) {
      skipped.push({ name: entry.name, reason: 'invalid name' })
      continue
    }
    if (Object.hasOwn(servers, entry.name) && !overwrite) {
      skipped.push({ name: entry.name, reason: 'already exists' })
      continue
    }
    try {
      await validateUserMcp(agentsRoot, { $schema: MCP_SCHEMA_ID, mcpServers: { ...servers, [entry.name]: entry.server } })
    } catch (reason) {
      skipped.push({ name: entry.name, reason: reason instanceof Error ? reason.message : String(reason) })
      continue
    }
    servers[entry.name] = entry.server
    imported.push(entry.name)
  }
  if (imported.length > 0) {
    await writeFileAtomic(userMcpPath(agentsRoot), `${JSON.stringify({ $schema: MCP_SCHEMA_ID, mcpServers: servers }, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  }
  return { imported, skipped }
}
