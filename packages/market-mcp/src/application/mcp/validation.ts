/**
 * MCP configuration validation: the schema checks and the redaction-restore
 * step the save path runs before anything is persisted.
 *
 * A service the user declared themselves is local data rather than a
 * distributable package: keys this client does not know are kept as written
 * instead of being rejected by the closed-set package schema, and the
 * package-only rules (bare command names, plugin-relative paths) stay off.
 */
import { MCP_SCHEMA_ID, validateAgainstSchema, validateMcpJson } from '../../../../market-catalog/src/index.js'

/** One rejected value, with the field it belongs to when the schema knows it. */
export interface McpFieldError {
  /** Dotted path inside the server object; empty for a problem with the document itself. */
  field: string
  message: string
}

/**
 * The errors the closed-set package shape produces. A user-owned service does
 * not obey that shape, and the per-transport checks still require what it needs.
 */
const PACKAGE_SHAPE_KEYWORDS = new Set(['additionalProperties', 'oneOf', 'required', 'const'])

/**
 * A rejected MCP configuration. The message keeps the flat form the API has
 * always returned, and `fields` carries the same reasons keyed by field so the
 * editor can put each one beside its input.
 */
export class McpConfigError extends Error {
  constructor(readonly fields: McpFieldError[]) {
    super(`invalid MCP configuration: ${fields.map(entry => (entry.field === '' ? entry.message : `${entry.field} ${entry.message}`)).join('; ')}`)
    this.name = 'McpConfigError'
  }
}

export { restoreRedactedConfig } from '../../../../market-contracts/src/redaction.js'

/**
 * Validate one service definition before it is stored.
 *
 * A service the user declared themselves is local data rather than a
 * distributable package: keys this client does not know are kept as written
 * instead of being rejected by the closed-set package schema, and the
 * package-only rules (bare command names, plugin-relative paths) stay off.
 */
export async function validateServerMcp(root: string, key: string, config: unknown, options?: { userOwned?: boolean }) {
  const userOwned = options?.userOwned === true
  const document = { $schema: MCP_SCHEMA_ID, mcpServers: { [key]: config } }
  // A JSON pointer needs its own escapes so a server key containing `/` or `~`
  // still yields the right prefix for the field paths below.
  const pointer = `/mcpServers/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
  const structural = (await validateAgainstSchema(MCP_SCHEMA_ID, document))
    .filter(error => error.instancePath === pointer || error.instancePath.startsWith(`${pointer}/`))
    // The closed-set package shape reports `additionalProperties` plus the
    // `oneOf`/`required` pair its failure produces; user-owned data does not
    // obey it, and the per-transport checks below still require what it needs.
    .filter(error => !(userOwned && PACKAGE_SHAPE_KEYWORDS.has(error.keyword)))
    .map(error => ({
      field: error.instancePath.slice(pointer.length).replace(/^\//, '').replaceAll('/', '.'),
      message: error.message
    }))
  if (structural.length > 0) throw new McpConfigError(structural)
  const result = await validateMcpJson(root, document, userOwned ? { packageRules: false } : undefined)
  if (result.config === undefined || result.errors.length > 0) throw new McpConfigError(result.errors.map(message => ({ field: '', message })))
  const server = result.config.servers[key]
  if (server === undefined) throw new McpConfigError([{ field: '', message: `server "${key}" was rejected` }])
  return server
}
