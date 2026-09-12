/**
 * agent-plugins.org v1.0.0 validation: vendored JSON Schemas plus the
 * specification's semantic filesystem rules.
 *
 * The schemas live under `schemas/1.0.0/` and are bundled into the package —
 * the spec forbids retrieving a schema while loading a plugin. Schema
 * validation is one failure boundary (per server / per manifest); the
 * semantic pass then enforces §4 path containment, `$schema` recognition, and
 * the `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` expansion the spec makes mandatory.
 */
import { readFile, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// The 2020-12 dist build's d.ts resolves to a CJS namespace under NodeNext;
// the runtime default export is the class itself (module.exports = Ajv2020).
import Ajv2020Default from 'ajv/dist/2020.js'
import type { McpServer, McpSuiteConfig } from '../model/types.js'
import { PLUGIN_ROOT_VARIABLES, PLUGIN_DATA_VARIABLES } from '../model/layouts.js'
import { isWithin } from './paths.js'

const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas', '1.0.0')

/** Structural slice of the Ajv 2020 instance this module uses. */
interface Ajv2020Like {
  addSchema(schema: unknown): unknown
  getSchema(id: string): { (document: unknown): unknown; errors?: Array<{ instancePath?: string; message?: string }> } | undefined
}

const Ajv2020Class = Ajv2020Default as unknown as { new (options?: Record<string, unknown>): Ajv2020Like }

export const PLUGIN_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
export const MCP_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'

let ajvPromise: Promise<Ajv2020Like> | undefined

/** Lazily build one Ajv instance holding the two vendored schemas. */
async function ajv(): Promise<Ajv2020Like> {
  ajvPromise ??= (async () => {
    const instance = new Ajv2020Class({ strict: false })
    for (const name of ['plugin.schema.json', 'mcp.schema.json'] as const) {
      const schemaText = await readFile(join(SCHEMAS_DIR, name), 'utf8')
      instance.addSchema(JSON.parse(schemaText))
    }
    return instance
  })()
  return ajvPromise
}

/** Validate one JSON document against a vendored schema; errors joined for surfacing. */
export async function validateAgainstSchema(schemaId: string, document: unknown): Promise<string[]> {
  const instance = await ajv()
  const validate = instance.getSchema(schemaId)
  if (validate === undefined) return [`no bundled validator for ${schemaId}`]
  validate(document)
  return (validate.errors ?? []).map(error => `${error.instancePath === '' ? 'root' : error.instancePath} ${error.message ?? 'invalid'}`)
}

/** Whether a `$schema` value selects the local v1.0.0 ruleset. */
export function isRecognizedSchema(value: unknown): boolean {
  return value === PLUGIN_SCHEMA_ID || value === MCP_SCHEMA_ID
}

/**
 * Spec §4 containment: a plugin-relative path must begin with `./` and, after
 * resolution against the plugin root, stay inside the filesystem-resolved
 * plugin root. Symlinks resolving outside the root are rejected.
 * @returns `undefined` when contained, or the rejection reason.
 */
export async function pathContainmentError(pluginRoot: string, value: string): Promise<string | undefined> {
  const raw = value.replace(/^\$\{([A-Z_]+)\}(\/|$)/, (match, name: string) => (PLUGIN_ROOT_VARIABLES.has(name) ? './' : match))
  if (!raw.startsWith('./')) return `path "${value}" must begin with "./" (or ${'${PLUGIN_ROOT}'})`
  const candidate = resolve(pluginRoot, raw.slice(2))
  let rootResolved: string
  try {
    rootResolved = await realpath(pluginRoot)
  } catch {
    rootResolved = resolve(pluginRoot)
  }
  let candidateResolved: string
  try {
    candidateResolved = await realpath(candidate)
  } catch {
    candidateResolved = candidate
  }
  if (!isWithin(rootResolved, candidateResolved)) {
    return `path "${value}" resolves outside the plugin root`
  }
  return undefined
}

/** Validate a plugin manifest per the vendored schema plus `$schema` recognition. */
export async function validatePluginManifest(raw: unknown): Promise<string[]> {
  const errors: string[] = []
  if (typeof raw !== 'object' || raw === null) return ['manifest is not a JSON object']
  const record = raw as Record<string, unknown>
  if (!isRecognizedSchema(record['$schema'])) {
    errors.push(`unrecognized $schema ${JSON.stringify(record['$schema'])}; this manager supports agent-plugins 1.0.0 only`)
  }
  errors.push(...(await validateAgainstSchema(PLUGIN_SCHEMA_ID, raw)))
  return errors
}

/**
 * Parse and validate an `mcp.json` document: schema first, then §4 path
 * containment for `command` and `cwd` of every stdio server.
 * @returns the validated config plus per-problem strings; a failed `$schema`
 *   or schema body drops the whole file, while per-server path problems
 *   invalidate only their server.
 */
const KNOWN_MCP_TRANSPORTS = new Set(['stdio', 'streamable-http', 'sse'])

export interface McpValidateOptions {
  /** Project-owned config may name external executables and working directories. */
  pathMode?: 'plugin' | 'project'
  /** Strict portable mode (`mcp.json`): `$schema` required and schema-validated.
   *  Lenient mode (`.mcp.json`, native client file): no `$schema` requirement,
   *  unknown transports skipped per server, known transports still validated. */
  strict?: boolean
}

export async function validateMcpJson(pluginRoot: string, raw: unknown, options?: McpValidateOptions): Promise<{ config?: McpSuiteConfig; errors: string[] }> {
  if (typeof raw !== 'object' || raw === null) return { errors: ['mcp.json is not a JSON object'] }
  const record = raw as Record<string, unknown>
  const errors: string[] = []
  const strict = options?.strict !== false
  if (strict) {
    if (!isRecognizedSchema(record['$schema'])) {
      return { errors: [`unrecognized mcp.json $schema ${JSON.stringify(record['$schema'])}; this manager supports agent-plugins 1.0.0 only`] }
    }
    const schemaErrors = await validateAgainstSchema(MCP_SCHEMA_ID, raw)
    if (schemaErrors.length > 0) return { errors: schemaErrors }
  }

  // Lenient native-client files may omit the `mcpServers` wrapper and put the
  // server map at the top level (Claude Code `.mcp.json` shorthand).
  let servers = record['mcpServers']
  if (typeof servers !== 'object' || servers === null) {
    if (strict || record['$schema'] !== undefined || !Object.values(record).every(value => typeof value === 'object' && value !== null)) {
      return { errors: ['mcp.json is missing mcpServers'] }
    }
    servers = record
  }
  const valid: Record<string, McpServer> = Object.create(null) as Record<string, McpServer>
  for (const [name, value] of Object.entries(servers as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) {
      errors.push(`server "${name}": not an object`)
      continue
    }
    const server = value as { type?: unknown; command?: unknown; cwd?: unknown }
    // Claude Code dialects: `http`/`streamable-http` are the same remote
    // transport, and `local` or a missing `type` (with `command`) mean stdio.
    let type = typeof server.type === 'string' ? server.type : server.command !== undefined ? 'stdio' : !strict && 'url' in server ? 'streamable-http' : undefined
    if (type === 'local') type = 'stdio'
    if (type === 'http') type = 'streamable-http'
    if (type === undefined || !KNOWN_MCP_TRANSPORTS.has(type)) {
      errors.push(`server "${name}": unsupported transport ${JSON.stringify(server.type)} (supported: stdio, streamable-http, sse)`)
      continue
    }
    if (type !== 'stdio') {
      valid[name] = { ...server, type } as McpServer
      continue
    }
    const stdioServer = server as { command: string; cwd?: string }
    const problems: string[] = []
    if (typeof stdioServer.command !== 'string') {
      errors.push(`server "${name}": stdio servers require a command`)
      continue
    }
    const command = stdioServer.command.replace(/^\$\{([A-Z_]+)\}\//, (match, name: string) => (PLUGIN_ROOT_VARIABLES.has(name) ? './' : match))
    if (options?.pathMode !== 'project' && command.includes('/')) {
      if (!command.startsWith('./')) {
        problems.push(`command "${command}" must be a bare executable name or a plugin-relative path beginning with "./"`)
      } else {
        const reason = await pathContainmentError(pluginRoot, command)
        if (reason !== undefined) problems.push(reason)
      }
    }
    if (stdioServer.cwd !== undefined && typeof stdioServer.cwd !== 'string') {
      problems.push('cwd must be a string')
    } else if (options?.pathMode !== 'project' && stdioServer.cwd !== undefined && ![...PLUGIN_DATA_VARIABLES].some(name => stdioServer.cwd!.startsWith(`\${${name}}`))) {
      // `.` is the Codex dialect spelling for the plugin root.
      const cwd = stdioServer.cwd === '.' ? './' : stdioServer.cwd
      const reason = await pathContainmentError(pluginRoot, cwd)
      if (reason !== undefined) problems.push(reason)
    }
    if (problems.length > 0) {
      errors.push(...problems.map(problem => `server "${name}": ${problem}`))
    } else {
      valid[name] = { ...server, command, type: 'stdio' } as McpServer
    }
  }
  return { config: { schema: typeof record['$schema'] === 'string' ? record['$schema'] : 'native-client', servers: valid }, errors }
}

/** Expand `${PLUGIN_ROOT}`, `${PLUGIN_DATA}`, and `${NAME}` (process env) in one string.
 *  Claude Code aliases `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` and
 *  `${NAME:-default}` fallbacks are honored for unset/empty env vars. */
export function expandPlaceholders(value: string, pluginRoot: string, pluginData: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (match, name: string, fallback?: string) => {
    if (PLUGIN_ROOT_VARIABLES.has(name)) return pluginRoot
    if (PLUGIN_DATA_VARIABLES.has(name)) return pluginData
    return env[name] || fallback || ''
  })
}

/** Resolve an expanded plugin-relative cwd to an absolute path. */
export function resolveCwd(value: string, pluginRoot: string, pluginData: string): string {
  if (value.startsWith('${PLUGIN_DATA}')) return resolve(pluginData, value.slice('${PLUGIN_DATA}'.length).replace(/^\/+/, ''))
  if (value.startsWith('${PLUGIN_ROOT}')) return resolve(pluginRoot, value.slice('${PLUGIN_ROOT}'.length).replace(/^\/+/, ''))
  return resolve(pluginRoot, value.replace(/^\.\//, ''))
}
