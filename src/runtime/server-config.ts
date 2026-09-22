import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { MCP_SCHEMA_ID, validateAgainstSchema, validateMcpJson } from '../catalog/validate.js'
import { parseLspServers } from '../catalog/lsp-spec.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import { redactMcpConfig } from './mcp-redaction.js'
import type { LspServerSpec, Suite } from '../model/types.js'

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

/** Restore only unchanged redacted leaves, rejecting invented masked values. */
export function restoreRedactedConfig(input: unknown, original: unknown, redacted = redactMcpConfig(original)): unknown {
  if (typeof input === 'string' && input.includes('[redacted]')) {
    if (input !== redacted) throw new Error('masked values must remain unchanged or be replaced')
    return original
  }
  if (Array.isArray(input))
    return input.map((value, index) => restoreRedactedConfig(value, Array.isArray(original) ? original[index] : undefined, Array.isArray(redacted) ? redacted[index] : undefined))
  if (typeof input === 'object' && input !== null) {
    const source = typeof original === 'object' && original !== null ? (original as Record<string, unknown>) : {}
    const safe = typeof redacted === 'object' && redacted !== null ? (redacted as Record<string, unknown>) : {}
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, restoreRedactedConfig(value, source[key], safe[key])]))
  }
  return input
}

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

export function validateServerLsp(key: string, config: unknown): LspServerSpec {
  const errors: string[] = []
  const server = parseLspServers({ [key]: config }, errors)[key]
  if (server === undefined || errors.length > 0) throw new Error(`invalid LSP configuration: ${errors.join('; ')}`)
  return server
}

/** Public configuration excludes the parser's derived identity. */
export function lspConfig(spec: LspServerSpec): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec).filter(([key]) => key !== 'key'))
}

export async function loadLspOverrides(root: string): Promise<Record<string, LspServerSpec>> {
  try {
    const raw = JSON.parse(await readFile(join(root, 'lsp-overrides.json'), 'utf8')) as Record<string, unknown>
    return Object.fromEntries(Object.entries(raw).map(([id, config]) => [id, validateServerLsp(id.slice(id.lastIndexOf('/') + 1), config)]))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

export async function saveLspOverride(root: string, id: string, config: LspServerSpec): Promise<void> {
  const overrides = await loadLspOverrides(root)
  overrides[id] = config
  const path = join(root, 'lsp-overrides.json')
  await writeFileAtomic(path, JSON.stringify(Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, lspConfig(value)])), null, 2), {
    mode: 0o600,
    dirMode: 0o700
  })
}

export async function applyLspOverrides(root: string, suites: Suite[]): Promise<Suite[]> {
  const overrides = await loadLspOverrides(root)
  return suites.map(suite =>
    suite.lsp === undefined
      ? suite
      : {
          ...suite,
          lsp: {
            ...suite.lsp,
            servers: Object.fromEntries(Object.entries(suite.lsp.servers).map(([key, spec]) => [key, overrides[`${qualifiedSuiteId(suite.sourceId, suite.id)}/${key}`] ?? spec]))
          }
        }
  )
}
