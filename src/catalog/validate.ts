/**
 * agent-plugins.org v1 validation: vendored JSON Schemas per supported
 * specification version plus the specification's semantic rules.
 *
 * The schemas live under `schemas/<version>/` and are bundled into the
 * package — the spec forbids retrieving a schema while loading a plugin
 * (§5.2, §7.2.1). Validation follows the specification's failure boundaries:
 * manifest unknown top-level fields and the whole `extensions` subtree are
 * reported and ignored (§5.2, §8.1) while any other manifest violation is
 * fatal; `mcp.json` file-level violations disable MCP for the plugin (§7.2.2
 * rule 2) and per-server violations skip only their server (§7.2.2 rule 3).
 * The semantic pass then enforces §4 path containment, §7.2.1 remote URL and
 * header rules, §9.2 placeholder discipline, and the `${PLUGIN_ROOT}` /
 * `${PLUGIN_DATA}` expansion the spec makes mandatory.
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

/** One vendored Agent Plugins release: the canonical manifest and MCP schema ids. */
export interface SpecVersion {
  version: string
  pluginSchemaId: string
  mcpSchemaId: string
}

const SUPPORTED_VERSIONS: readonly SpecVersion[] = [
  { version: '1.0.0', pluginSchemaId: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', mcpSchemaId: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json' },
  // 1.1.0 is explicitly recognized as compatible: its two published schemas
  // differ from 1.0.0 only in the version string (§5.2 allows mapping
  // explicitly recognized compatible versions onto one implementation).
  { version: '1.1.0', pluginSchemaId: 'https://agent-plugins.org/schemas/1.1.0/plugin.schema.json', mcpSchemaId: 'https://agent-plugins.org/schemas/1.1.0/mcp.schema.json' }
]

const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas')

/** Structural slice of the Ajv 2020 instance this module uses. */
interface AjvErrorLike {
  keyword?: string
  instancePath?: string
  message?: string
  params?: Record<string, unknown>
}

interface Ajv2020Like {
  addSchema(schema: unknown): unknown
  getSchema(id: string): { (document: unknown): unknown; errors?: AjvErrorLike[] } | undefined
}

const Ajv2020Class = Ajv2020Default as unknown as { new (options?: Record<string, unknown>): Ajv2020Like }

const BASELINE = SUPPORTED_VERSIONS[0] as SpecVersion

/** The canonical plugin manifest schema identifier of the baseline release. */
export const PLUGIN_SCHEMA_ID: string = BASELINE.pluginSchemaId
/** The canonical MCP configuration schema identifier of the baseline release. */
export const MCP_SCHEMA_ID: string = BASELINE.mcpSchemaId

/** The spec version a recognized `$schema` id selects, or undefined when unrecognized. */
export function recognizedSpecVersion(schemaId: unknown): SpecVersion | undefined {
  if (typeof schemaId !== 'string') return undefined
  return SUPPORTED_VERSIONS.find(version => version.pluginSchemaId === schemaId || version.mcpSchemaId === schemaId)
}

/** Whether a `$schema` value selects a locally supported ruleset. */
export function isRecognizedSchema(value: unknown): boolean {
  return recognizedSpecVersion(value) !== undefined
}

/**
 * One structured schema violation. Structured instead of pre-formatted so
 * callers can classify by location and keyword before rendering text.
 */
export interface SchemaError {
  keyword: string
  instancePath: string
  message: string
  params?: Record<string, unknown>
}

let ajvPromise: Promise<Ajv2020Like> | undefined

/** Lazily build one Ajv instance holding every vendored schema. */
async function ajv(): Promise<Ajv2020Like> {
  ajvPromise ??= (async () => {
    const instance = new Ajv2020Class({ strict: false, allErrors: true })
    for (const version of SUPPORTED_VERSIONS) {
      for (const name of ['plugin.schema.json', 'mcp.schema.json'] as const) {
        const schemaText = await readFile(join(SCHEMAS_DIR, version.version, name), 'utf8')
        instance.addSchema(JSON.parse(schemaText))
      }
    }
    return instance
  })()
  return ajvPromise
}

/** Validate one JSON document against a vendored schema; structured errors. */
export async function validateAgainstSchema(schemaId: string, document: unknown): Promise<SchemaError[]> {
  const instance = await ajv()
  const validate = instance.getSchema(schemaId)
  if (validate === undefined) return [{ keyword: 'schema', instancePath: '', message: `no bundled validator for ${schemaId}` }]
  validate(document)
  return (validate.errors ?? []).map(error => ({
    keyword: error.keyword ?? 'schema',
    instancePath: error.instancePath ?? '',
    message: error.message ?? 'invalid',
    ...(error.params === undefined ? {} : { params: error.params })
  }))
}

/** Render structured errors as one diagnostic string per error for surfacing. */
export function formatSchemaErrors(errors: SchemaError[]): string[] {
  return errors.map(error => `${error.instancePath === '' ? 'root' : error.instancePath} ${error.message}`)
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

/**
 * Classification of one plugin manifest against the vendored schema:
 * `fatal` violations reject the manifest (§5.2), `ignored` violations are
 * reported and loading continues (unknown top-level fields per §5.2, the
 * whole `extensions` subtree per §8.1).
 */
export interface ManifestVerdict {
  fatal: SchemaError[]
  ignored: SchemaError[]
}

const EXTENSIONS_PATH = '/extensions'

function isExtensionPath(instancePath: string): boolean {
  return instancePath === EXTENSIONS_PATH || instancePath.startsWith(`${EXTENSIONS_PATH}/`)
}

/** Validate a plugin manifest against its declared spec version's schema and split the verdict. */
export async function validatePluginManifest(raw: unknown): Promise<ManifestVerdict> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { fatal: [{ keyword: 'type', instancePath: '', message: 'manifest is not a JSON object' }], ignored: [] }
  }
  const record = raw as Record<string, unknown>
  const version = recognizedSpecVersion(record['$schema'])
  if (version === undefined) {
    return {
      fatal: [{ keyword: 'const', instancePath: '', message: `unrecognized $schema ${JSON.stringify(record['$schema'])}; supported: agent-plugins 1.0.0, 1.1.0` }],
      ignored: []
    }
  }
  const errors = await validateAgainstSchema(version.pluginSchemaId, raw)
  const fatal: SchemaError[] = []
  const ignored: SchemaError[] = []
  for (const error of errors) {
    if (isExtensionPath(error.instancePath)) ignored.push(error)
    else if (error.keyword === 'additionalProperties' && error.instancePath === '') {
      const name = typeof error.params?.additionalProperty === 'string' ? error.params.additionalProperty : 'unknown field'
      ignored.push({ ...error, message: `unknown top-level field "${name}" is not part of the portable manifest; ignored` })
    } else fatal.push(error)
  }
  return { fatal, ignored }
}

const KNOWN_MCP_TRANSPORTS = new Set(['stdio', 'streamable-http', 'sse'])

export interface McpValidateOptions {
  /** Project-owned config may name external executables and working directories. */
  pathMode?: 'plugin' | 'project'
  /** Strict portable mode (`mcp.json`): `$schema` required and schema-validated.
   *  Lenient mode (`.mcp.json`, native client file): no `$schema` requirement,
   *  unknown transports skipped per server, known transports still validated. */
  strict?: boolean
  /** The spec version the suite's `plugin.json` declared; mismatched `mcp.json`
   *  versions disable MCP for the plugin (§7.2.2 rule 2, §10.1). */
  manifestVersion?: string
}

/**
 * §7.2.1 remote URL rules: absolute http/https, no user information, no
 * fragment, HTTPS everywhere except loopback hosts.
 */
export function remoteUrlError(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return `url "${value}" is not an absolute URL`
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `url "${value}" must use http or https`
  if (url.username !== '' || url.password !== '') return `url "${value}" must not contain user information`
  if (url.hash !== '') return `url "${value}" must not contain a fragment`
  if (url.protocol === 'http:') {
    const host = url.hostname
    const loopback = host === 'localhost' || host === '::1' || host === '[::1]' || host.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(host)
    if (!loopback) return `url "${value}" must use https (http is allowed only for loopback)`
  }
  return undefined
}

/**
 * §7.2.1 header rules: valid field names, and a duplicate name under
 * different casing makes the entry invalid.
 */
export function headersError(headers: Record<string, string>): string | undefined {
  const seen = new Set<string>()
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) return `header name ${JSON.stringify(name)} is not a valid HTTP header field name`
    if (typeof value !== 'string') return `header ${JSON.stringify(name)} must have a string value`
    const lower = name.toLowerCase()
    if (seen.has(lower)) return `header "${name}" is declared more than once under different casing`
    seen.add(lower)
  }
  return undefined
}

/**
 * Parse and validate an `mcp.json` document.
 *
 * Strict mode applies the two-level failure boundary of §7.2.2: a file-level
 * violation (bad `$schema`, version mismatch with the manifest, non-object
 * `mcpServers`) disables MCP for the whole plugin, while a per-server
 * violation skips only that server. Lenient mode keeps the native-client
 * behavior: no `$schema` requirement, unknown transports skipped per server.
 *
 * @returns the validated config plus per-problem strings; `config` stays
 *   defined whenever at least the file shell was valid, even when some
 *   servers were skipped.
 */
export async function validateMcpJson(pluginRoot: string, raw: unknown, options?: McpValidateOptions): Promise<{ config?: McpSuiteConfig; errors: string[] }> {
  if (typeof raw !== 'object' || raw === null) return { errors: ['mcp.json is not a JSON object'] }
  const record = raw as Record<string, unknown>
  const errors: string[] = []
  const strict = options?.strict !== false
  let version: SpecVersion | undefined
  if (strict) {
    version = recognizedSpecVersion(record['$schema'])
    if (version === undefined) {
      return { errors: [`unrecognized mcp.json $schema ${JSON.stringify(record['$schema'])}; supported: agent-plugins 1.0.0, 1.1.0`] }
    }
    if (options?.manifestVersion !== undefined && options.manifestVersion !== version.version) {
      return {
        errors: [
          `mcp.json declares agent-plugins ${version.version} while plugin.json declares ${options.manifestVersion}; the versions must match (§10.1) and MCP is disabled for this plugin`
        ]
      }
    }
    // File-level shape only: `$schema`, `mcpServers`, unknown top-level
    // fields. Server entries are validated per server below (§7.2.2 rule 3).
    const shellErrors = (await validateAgainstSchema(version.mcpSchemaId, raw)).filter(error => !error.instancePath.startsWith('/mcpServers/'))
    if (shellErrors.length > 0) return { errors: formatSchemaErrors(shellErrors) }
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
    if (strict) {
      // §7.2.1 exposes `#/$defs/server` so each entry can be validated
      // independently, preserving §7.2.2 rule 3: a violation skips only its
      // own server. Validate the bare entry against that ref directly —
      // errors are then rooted at the entry itself (`/env`, `` for required).
      const serverErrors = await validateAgainstSchema(`${(version as SpecVersion).mcpSchemaId}#/$defs/server`, value)
      if (serverErrors.length > 0) {
        const rendered = new Set<string>()
        for (const error of serverErrors) {
          if (error.keyword === 'oneOf' || error.keyword === 'required') continue
          rendered.add(`${error.instancePath === '' ? '' : `${error.instancePath} `}${error.message}`)
        }
        if (rendered.size === 0) rendered.add('does not match any supported server variant')
        errors.push(...[...rendered].map(problem => `server "${name}": ${problem || 'invalid server entry'}`))
        continue
      }
    }
    const server = value as { type?: unknown; command?: unknown; cwd?: unknown; url?: unknown; headers?: unknown }
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
      if (strict) {
        if (typeof server.url !== 'string') {
          errors.push(`server "${name}": remote servers require a url`)
          continue
        }
        const urlProblem = remoteUrlError(server.url)
        if (urlProblem !== undefined) {
          errors.push(`server "${name}": ${urlProblem}`)
          continue
        }
        if (server.headers !== undefined) {
          if (typeof server.headers !== 'object' || server.headers === null) {
            errors.push(`server "${name}": headers must be an object`)
            continue
          }
          const headerProblem = headersError(server.headers as Record<string, string>)
          if (headerProblem !== undefined) {
            errors.push(`server "${name}": ${headerProblem}`)
            continue
          }
        }
      }
      valid[name] = { ...server, type } as McpServer
      continue
    }
    const stdioServer = server as { command: string; cwd?: string }
    const problems: string[] = []
    if (typeof stdioServer.command !== 'string') {
      errors.push(`server "${name}": stdio servers require a command`)
      continue
    }
    if (strict && /\$\{/.test(stdioServer.command)) {
      problems.push(`command ${JSON.stringify(stdioServer.command)} must not contain placeholders (§9.2: command is resolved as one token, not expanded)`)
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
    const declaredCwd = stdioServer.cwd
    if (declaredCwd !== undefined && typeof declaredCwd !== 'string') {
      problems.push('cwd must be a string')
    } else if (options?.pathMode !== 'project' && declaredCwd !== undefined && ![...PLUGIN_DATA_VARIABLES].some(name => declaredCwd.startsWith(`\${${name}}`))) {
      // `.` is the Codex dialect spelling for the plugin root.
      const cwd = declaredCwd === '.' ? './' : declaredCwd
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

/** Resolve an expanded plugin-relative cwd to an absolute path. */
export function resolveCwd(value: string, pluginRoot: string, pluginData: string): string {
  if (value.startsWith('${PLUGIN_DATA}')) return resolve(pluginData, value.slice('${PLUGIN_DATA}'.length).replace(/^\/+/, ''))
  if (value.startsWith('${PLUGIN_ROOT}')) return resolve(pluginRoot, value.slice('${PLUGIN_ROOT}'.length).replace(/^\/+/, ''))
  return resolve(pluginRoot, value.replace(/^\.\//, ''))
}
