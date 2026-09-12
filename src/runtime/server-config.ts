import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { MCP_SCHEMA_ID, validateAgainstSchema, validateMcpJson } from '../catalog/validate.js'
import { parseLspServers } from '../catalog/lsp-spec.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import { redactMcpConfig } from './mcp-redaction.js'
import type { LspServerSpec, Suite } from '../model/types.js'

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

export async function validateServerMcp(root: string, key: string, config: unknown) {
  const document = { $schema: MCP_SCHEMA_ID, mcpServers: { [key]: config } }
  const errors = await validateAgainstSchema(MCP_SCHEMA_ID, document)
  if (errors.length > 0) throw new Error(`invalid MCP configuration: ${errors.join('; ')}`)
  const result = await validateMcpJson(root, document)
  const server = result.config?.servers[key]
  if (server === undefined || result.errors.length > 0) throw new Error(`invalid MCP configuration: ${result.errors.join('; ')}`)
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
