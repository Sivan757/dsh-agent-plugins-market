/** Read native project configuration without treating unrelated settings as server definitions. */
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { McpSuiteConfig } from '../model/types.js'
import { validateMcpJson } from './validate.js'
import { parse as parseToml } from 'smol-toml'
import { normalizeCodexMcp } from './codex-mcp.js'
import type { ProjectMcpFormat } from '../model/layouts.js'

/** Later files override earlier keys; a malformed layer invalidates the whole layout's table. */
export async function discoverProjectMcp(
  projectRoot: string,
  files: readonly string[],
  errors: string[],
  format: ProjectMcpFormat = 'mcpServers'
): Promise<McpSuiteConfig | undefined> {
  const servers: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  let found = false
  for (const file of files) {
    const raw = await readProjectDocument(projectRoot, file, errors, format === 'codex' ? 'TOML' : 'JSON')
    if (raw === null) return undefined
    if (raw === undefined) continue
    if (format === 'codex') {
      if (raw.mcp_servers === undefined) continue
      if (typeof raw.mcp_servers !== 'object' || raw.mcp_servers === null || Array.isArray(raw.mcp_servers)) {
        errors.push(`${file}: mcp_servers must be a table`)
        return undefined
      }
      found = true
      Object.assign(servers, normalizeCodexMcp(raw.mcp_servers as Record<string, unknown>, errors))
      continue
    }
    const mcp = raw.mcp
    if (format === 'zcode' && mcp === undefined) continue
    if (format === 'zcode' && (typeof mcp !== 'object' || mcp === null || Array.isArray(mcp))) {
      errors.push(`${file}: mcp must be an object`)
      return undefined
    }
    if (format === 'zcode' && (mcp as Record<string, unknown>).enabled === false) return undefined
    const table = format === 'zcode' ? (mcp as Record<string, unknown>).servers : raw.mcpServers
    if (format === 'zcode' && table === undefined) continue
    if (table === undefined && /settings(?:\.local)?\.json$/.test(file)) continue
    if (typeof table !== 'object' || table === null || Array.isArray(table)) {
      errors.push(`${file}: mcpServers must be an object`)
      return undefined
    }
    found = true
    Object.assign(servers, table)
  }
  if (format === 'zcode' && Object.keys(servers).length === 0) return discoverProjectMcp(projectRoot, ['.agents/mcp.json'], errors)
  if (!found) return undefined
  for (const [key, server] of Object.entries(servers)) {
    if (typeof server === 'object' && server !== null && (server as Record<string, unknown>).enabled === false) delete servers[key]
  }
  const result = await validateMcpJson(projectRoot, { mcpServers: servers }, { strict: false, pathMode: 'project' })
  errors.push(...result.errors.map(error => `project MCP: ${error}`))
  return result.config === undefined ? undefined : { ...result.config, root: projectRoot }
}

/** Missing is undefined; malformed/unreadable is null and carries a diagnostic. */
export async function readProjectDocument(
  projectRoot: string,
  file: string,
  errors: string[],
  format: 'JSON' | 'TOML' = 'JSON'
): Promise<Record<string, unknown> | undefined | null> {
  const path = join(projectRoot, file)
  let text: string
  try {
    const [base, target] = await Promise.all([realpath(projectRoot), realpath(path)])
    if (!target.startsWith(`${base}/`)) {
      errors.push(`${file}: project configuration escapes the project root`)
      return null
    }
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    errors.push(`${file}: project configuration is unreadable`)
    return null
  }
  let raw: unknown
  try {
    raw = format === 'TOML' ? parseToml(text) : JSON.parse(text)
  } catch {
    errors.push(`${file}: project configuration is invalid ${format}`)
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push(`${file}: project configuration must be an object`)
    return null
  }
  const record = raw as Record<string, unknown>
  if (record.lspServers !== undefined || record.lsp_servers !== undefined) {
    errors.push(`${file}: project LSP declarations are not mounted; the host LSP registry does not isolate projects`)
  }
  return record
}
