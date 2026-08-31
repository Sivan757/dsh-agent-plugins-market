/**
 * Direct user configuration for LSP servers: a named table of `lspServers`
 * entries stored under the plugin data root, merged at runtime alongside the
 * suites' inline declarations.
 *
 * The file lives at `${dataRoot}/lsp-servers.json` and is the single source
 * for the `direct` kind on the LSP status surface. Parsing reuses the same
 * fail-closed `lsp-spec` rules as suite declarations; a broken file degrades
 * to no direct servers plus a diagnostic, never a thrown discovery.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseLspServers } from '../catalog/lsp-spec.js'
import type { LspServerSpec } from '../model/types.js'

/** The direct LSP server configuration file path. */
export function lspServersPath(dataRoot: string): string {
  return join(dataRoot, 'lsp-servers.json')
}

/** Load the user-configured LSP servers; unreadable or invalid files yield an empty table. */
export async function loadLspServers(dataRoot: string): Promise<{ servers: Record<string, LspServerSpec>; errors: string[] }> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(lspServersPath(dataRoot), 'utf8'))
  } catch {
    return { servers: {}, errors: [] }
  }
  const errors: string[] = []
  const table = (raw as Record<string, unknown> | null)?.['lspServers']
  const servers = parseLspServers(table, errors)
  return { servers, errors: errors.map(error => `lsp-servers.json: ${error}`) }
}

/** Validate and persist the user-configured LSP servers; returns normalized specs. */
export async function saveLspServers(dataRoot: string, raw: unknown): Promise<{ servers: Record<string, LspServerSpec> }> {
  const errors: string[] = []
  const table = (raw as Record<string, unknown> | null)?.['lspServers']
  const servers = parseLspServers(table, errors)
  if (errors.length > 0) {
    throw new Error(`invalid lspServers: ${errors[0]}`)
  }
  const path = lspServersPath(dataRoot)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({ lspServers: servers }, null, 2)}\n`, 'utf8')
  return { servers }
}
