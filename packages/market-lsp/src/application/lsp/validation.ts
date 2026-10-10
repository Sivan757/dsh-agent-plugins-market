/**
 * LSP configuration validation and the persisted per-server override layer.
 *
 * A suite's own `lspServers` declaration stays source-owned and is never
 * rewritten; the user's replacements live in `lsp-overrides.json` under the
 * plugin data root and are applied on read.
 */
import { join } from 'node:path'
import { readJsonFile, writeJsonDocument } from '../../../../market-catalog/src/index.js'
import { parseLspServers } from '../../../../market-catalog/src/index.js'
import { qualifiedSuiteId } from '../../../../market-catalog/src/index.js'
import type { LspServerSpec, Suite } from '../../../../market-contracts/src/model/types.js'

/** Validate one language-server declaration before it is stored. */
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
  const raw = await readJsonFile(join(root, 'lsp-overrides.json'))
  if (typeof raw !== 'object' || raw === null) return {}
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([id, config]) => [id, validateServerLsp(id.slice(id.lastIndexOf('/') + 1), config)]))
}

export async function saveLspOverride(root: string, id: string, config: LspServerSpec): Promise<void> {
  const overrides = await loadLspOverrides(root)
  overrides[id] = config
  await writeJsonDocument(join(root, 'lsp-overrides.json'), Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, lspConfig(value)])))
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
