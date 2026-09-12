/**
 * Direct user configuration for LSP servers: a named table of `lspServers`
 * entries stored in the shared Agent layout root, merged at runtime alongside
 * the suites' inline declarations.
 *
 * The file lives at `~/.agents/lsp.json` and is the single source for the
 * `direct` kind on the LSP status surface. Parsing reuses the same fail-closed
 * `lsp-spec` rules as suite declarations; a broken file degrades to no direct
 * servers plus a diagnostic, never a thrown discovery.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseLspServers } from '../catalog/lsp-spec.js'
import type { LspServerSpec } from '../model/types.js'

/** The direct LSP server configuration file path. */
export function lspServersPath(agentsRoot: string): string {
  return join(agentsRoot, 'lsp.json')
}

/** Load the user-configured LSP servers; unreadable or invalid files yield an empty table. */
export async function loadLspServers(agentsRoot: string): Promise<{ servers: Record<string, LspServerSpec>; errors: string[] }> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(lspServersPath(agentsRoot), 'utf8'))
  } catch (error) {
    return { servers: {}, errors: (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : [`lsp.json: ${error instanceof Error ? error.message : String(error)}`] }
  }
  const errors: string[] = []
  const table = (raw as Record<string, unknown> | null)?.['lspServers']
  if (table === undefined || table === null || Array.isArray(table) || typeof table !== 'object') return { servers: {}, errors: ['lsp.json: lspServers must be an object'] }
  const servers = parseLspServers(table, errors)
  return { servers, errors: errors.map(error => `lsp.json: ${error}`) }
}

/** Validate and persist the user-configured LSP servers; returns normalized specs. */
export async function saveLspServers(agentsRoot: string, raw: unknown): Promise<{ servers: Record<string, LspServerSpec> }> {
  const errors: string[] = []
  const table = (raw as Record<string, unknown> | null)?.['lspServers']
  const servers = parseLspServers(table, errors)
  if (errors.length > 0) {
    throw new Error(`invalid lspServers: ${errors[0]}`)
  }
  const path = lspServersPath(agentsRoot)
  await mkdir(dirname(path), { recursive: true })
  const persisted = Object.fromEntries(Object.entries(servers).map(([name, { key: _key, ...config }]) => [name, config]))
  await writeFile(path, `${JSON.stringify({ lspServers: persisted }, null, 2)}\n`, { mode: 0o600 })
  return { servers }
}
