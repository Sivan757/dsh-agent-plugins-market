import { join } from 'node:path'
import { readJsonFile, writeJsonDocument } from '../../../../market-catalog/src/index.js'
import { MCP_SCHEMA_ID, validateMcpJson } from '../../../../market-catalog/src/index.js'
import { effectiveSurfaces, type McpSuiteConfig, type Suite } from '../../../../market-contracts/src/model/types.js'

export const USER_MCP_SOURCE = '@user-mcp'
export const USER_MCP_SUITE = 'user-mcp'

/**
 * Whether one suite is the user's own declaration file rather than a package.
 *
 * These servers are local data the user authored, so they are also the one
 * suite whose servers own the top-level MCP namespace: they mount under their
 * own server key instead of a suite-namespaced one (see `deriveServerName` in
 * `mcp-config.ts`).
 */
export function isUserMcpSuite(suite: Pick<Suite, 'sourceId' | 'id'>): boolean {
  return suite.sourceId === USER_MCP_SOURCE && suite.id === USER_MCP_SUITE
}

/**
 * Load the user's own MCP declaration file.
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
    const raw = await readJsonFile(path)
    if (raw !== undefined) mcp = await validateUserMcp(agentsRoot, raw)
  } catch (error) {
    errors.push(`mcp.json: ${error instanceof Error ? error.message : String(error)}`)
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
    // The suite declares MCP only: the other surfaces would otherwise make the
    // command registry read this root a second time beside the user-command
    // panel registry.
    activeSurfaces: effectiveSurfaces({ skills: false, hooks: false, commands: false, agents: false, lsp: false }),
    installedAt: 'user',
    errors
  }
}

/**
 * The user's own declaration file is local data, not a distributable package:
 * keys this client does not know ride along untouched rather than failing the
 * whole file, and the closed-set rule the package schema applies to suites
 * does not apply here.
 *
 * A hand-written file may omit `$schema` entirely, so the baseline identifier
 * is filled in before validation: the document then reads as the baseline
 * release while every shape and required field the client does know is still
 * validated. A rejected document keeps the file's own declarations out of the
 * mount and reports the reason, the same fail-closed rule the write paths
 * apply.
 */
async function validateUserMcp(agentsRoot: string, raw: unknown): Promise<McpSuiteConfig> {
  const document = isRecord(raw) && raw['$schema'] === undefined ? { ...raw, $schema: MCP_SCHEMA_ID } : raw
  const result = await validateMcpJson(agentsRoot, document, { packageRules: false })
  if (result.config === undefined || result.errors.length > 0) throw new Error(`invalid MCP configuration: ${result.errors.join('; ')}`)
  return result.config
}

/** Whether a parsed user document is the JSON object the MCP validator reads. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Add one service atomically; reject collisions and malformed config before writing. */
export async function addUserMcpServer(agentsRoot: string, name: string, server: unknown): Promise<void> {
  const publish = await prepareUserMcpServer(agentsRoot, name, server)
  await publish()
}

/**
 * Validate an addition without publishing it. Call the returned atomic write
 * once, within the same serialized mutation, after any policy has been saved.
 */
export async function prepareUserMcpServer(agentsRoot: string, name: string, server: unknown): Promise<() => Promise<void>> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error('invalid MCP server name')
  const suite = await loadUserMcpSuite(agentsRoot)
  if (suite.errors.length > 0) throw new Error(suite.errors.join('; '))
  if (Object.hasOwn(suite.mcp.servers, name)) throw new Error(`MCP server "${name}" already exists`)
  const document = { $schema: MCP_SCHEMA_ID, mcpServers: { ...suite.mcp.servers, [name]: server } }
  await validateUserMcp(agentsRoot, document)
  return () => writeJsonDocument(userMcpPath(agentsRoot), document)
}

/**
 * Validate a removal without publishing it. Call the returned atomic write once,
 * within the same serialized mutation, after the plan is settled.
 *
 * The file is re-read rather than rebuilt from the parsed suite: rebuilding
 * would drop top-level keys this client does not model and rewrite the other
 * declarations into the parsed shape, while a removal must change exactly one
 * key. A file the loader rejected is refused here for the same reason creation
 * refuses it — the write would otherwise discard a declaration nothing could
 * read.
 */
export async function prepareUserMcpServerRemoval(agentsRoot: string, name: string): Promise<() => Promise<void>> {
  const suite = await loadUserMcpSuite(agentsRoot)
  if (suite.errors.length > 0) throw new Error(suite.errors.join('; '))
  if (!Object.hasOwn(suite.mcp.servers, name)) throw new Error(`MCP server "${name}" is not declared`)
  const raw = await readJsonFile(userMcpPath(agentsRoot))
  if (!isRecord(raw) || !isRecord(raw['mcpServers'])) throw new Error('mcp.json is not a JSON object')
  const servers = { ...raw['mcpServers'] }
  delete servers[name]
  const document = { ...raw, mcpServers: servers }
  // The remaining document is validated before the write: a removal must not
  // publish a file the next scan would reject and disable wholesale.
  await validateUserMcp(agentsRoot, document)
  return () => writeJsonDocument(userMcpPath(agentsRoot), document)
}

/** The user's hand-written MCP declaration file: `<agentsRoot>/mcp.json`. */
export function userMcpPath(agentsRoot: string): string {
  return join(agentsRoot, 'mcp.json')
}
