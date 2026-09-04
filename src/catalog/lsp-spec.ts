/**
 * Normalization and validation for inline `lspServers` declarations (Claude
 * Code marketplace entries and plugin manifests).
 *
 * A declaration is a named table of server specs: `command` (required),
 * `args`, and an `extensionToLanguage` map (required, non-empty). Unknown
 * keys are tolerated and listed in the returned diagnostics; known Claude
 * Code-only extensions (`startupTimeout`) are ignored silently. Parsing is
 * fail-closed per suite: a broken server spec degrades to a diagnostic, never
 * a thrown discovery.
 */
import type { LspServerSpec } from '../model/types.js'

/** Claude Code-specific keys this integration intentionally ignores. */
const CC_ONLY_KEYS = new Set(['startupTimeout'])

/** Keys accepted by the normalized spec; anything else is reported as ignored. */
const KNOWN_KEYS = new Set(['command', 'args', 'extensionToLanguage', 'env', 'initializationOptions', 'configuration', ...CC_ONLY_KEYS])

/** Parse one inline `lspServers` table into normalized specs plus diagnostics. */
export function parseLspServers(raw: unknown, errors: string[]): Record<string, LspServerSpec> {
  if (typeof raw !== 'object' || raw === null) {
    if (raw !== undefined) errors.push('lspServers: not an object')
    return {}
  }
  const specs: Record<string, LspServerSpec> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const spec = parseOneServer(key, value, errors)
    if (spec !== undefined) specs[key] = spec
  }
  return specs
}

function parseOneServer(key: string, raw: unknown, errors: string[]): LspServerSpec | undefined {
  if (typeof raw !== 'object' || raw === null) {
    errors.push(`lspServers.${key}: server entry is not an object`)
    return undefined
  }
  const record = raw as Record<string, unknown>
  for (const field of Object.keys(record)) {
    if (!KNOWN_KEYS.has(field)) errors.push(`lspServers.${key}: ignoring unknown field "${field}"`)
  }
  const command = record['command']
  if (typeof command !== 'string' || command.trim() === '') {
    errors.push(`lspServers.${key}: "command" must be a non-empty string`)
    return undefined
  }
  const args = record['args']
  if (args !== undefined && (!Array.isArray(args) || args.some(entry => typeof entry !== 'string'))) {
    errors.push(`lspServers.${key}: "args" must be an array of strings`)
    return undefined
  }
  const mapping = parseExtensionToLanguage(key, record['extensionToLanguage'], errors)
  if (mapping === undefined) return undefined
  const env = record['env']
  if (env !== undefined && (typeof env !== 'object' || env === null || Array.isArray(env) || Object.values(env).some(value => typeof value !== 'string'))) {
    errors.push(`lspServers.${key}: "env" must be an object of strings`)
    return undefined
  }
  return {
    key,
    command,
    args: Array.isArray(args) ? (args as string[]) : [],
    extensionToLanguage: mapping,
    ...(typeof env === 'object' && env !== null && !Array.isArray(env) ? { env: env as Record<string, string> } : {}),
    ...(record['initializationOptions'] !== undefined ? { initializationOptions: record['initializationOptions'] } : {}),
    ...(record['configuration'] !== undefined ? { configuration: record['configuration'] } : {})
  }
}

/** Normalize and validate `extensionToLanguage`: lowercase leading-dot keys, non-empty ids. */
function parseExtensionToLanguage(key: string, raw: unknown, errors: string[]): Record<string, string> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push(`lspServers.${key}: "extensionToLanguage" must be a non-empty object`)
    return undefined
  }
  const mapping: Record<string, string> = {}
  for (const [rawExt, languageId] of Object.entries(raw as Record<string, unknown>)) {
    const ext = rawExt.toLowerCase()
    const normalized = ext.startsWith('.') ? ext : `.${ext}`
    if (!/^\.[^.\\/]+$/.test(normalized)) {
      errors.push(`lspServers.${key}: invalid extension "${rawExt}"`)
      return undefined
    }
    if (typeof languageId !== 'string' || languageId.trim() === '') {
      errors.push(`lspServers.${key}: extension "${normalized}" maps to an empty language id`)
      return undefined
    }
    // Case-variant spellings of one extension (clangd's `.c`/`.C`) collapse
    // silently: normalization makes them the same key, and the first id wins.
    if (mapping[normalized] !== undefined) continue
    mapping[normalized] = languageId
  }
  if (Object.keys(mapping).length === 0) {
    errors.push(`lspServers.${key}: "extensionToLanguage" must not be empty`)
    return undefined
  }
  return mapping
}
