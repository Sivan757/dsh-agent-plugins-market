/** Resolve all plugin component declarations into the same normalized resources used by runtime consumers. */
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import type { ProjectHooks, SuiteManifest, LspSuiteConfig } from '../model/types.js'
import { componentDocuments, componentPath, firstComponentFile, isRecord } from './component-files.js'
import { parseLspServers } from './lsp-spec.js'
import { normalizeHookDocuments } from './project-hooks.js'
import { PLUGIN_ROOT_VARIABLES } from '../model/layouts.js'

export async function discoverSuiteLsp(root: string, manifest: SuiteManifest, errors: string[]): Promise<LspSuiteConfig | undefined> {
  const declaration = manifest.components?.lspServers
  const fallback = await firstComponentFile(
    root,
    manifest.layout === 'github-copilot' || manifest.layout === 'universal' ? ['lsp.json', '.github/lsp.json', 'lsp-config/servers.json', '.lsp.json'] : ['.lsp.json', 'lsp.json']
  )
  if (declaration === undefined && fallback === undefined) return undefined
  const documents = await componentDocuments(root, declaration ?? fallback, errors)
  if (documents === undefined) return undefined
  const servers: LspSuiteConfig['servers'] = Object.create(null) as LspSuiteConfig['servers']
  for (const { value } of documents) Object.assign(servers, parseLspServers(value.lspServers ?? value, errors))
  return Object.keys(servers).length > 0 ? { servers } : undefined
}

function quote(argument: string): string {
  return `'${argument.replaceAll("'", "'\\''")}'`
}
function rootVariables(text: string, root: string): string {
  return text.replace(/\$\{([A-Z_]+)\}/g, (match, name: string) => (PLUGIN_ROOT_VARIABLES.has(name) ? root : match))
}

const EVENT_ALIASES: Record<string, string> = {
  sessionStart: 'SessionStart',
  userPromptSubmitted: 'UserPromptSubmit',
  beforeSubmitPrompt: 'UserPromptSubmit',
  preToolUse: 'PreToolUse',
  postToolUse: 'PostToolUse',
  stop: 'Stop',
  subagentStart: 'SubagentStart',
  subagentStop: 'SubagentStop'
}

/** File configs and Kimi's inline array converge on the established command-hook bridge shape. */
export async function discoverSuiteHooks(root: string, manifest: SuiteManifest, errors: string[]): Promise<ProjectHooks | undefined> {
  let declaration = manifest.components?.hooks
  if (manifest.layout === 'kimi' && Array.isArray(declaration)) {
    const events: Record<string, unknown[]> = Object.create(null) as Record<string, unknown[]>
    for (const hook of declaration) {
      if (!isRecord(hook) || typeof hook.event !== 'string' || typeof hook.command !== 'string') {
        errors.push('invalid Kimi inline hook')
        return undefined
      }
      ;(events[hook.event] ??= []).push({
        ...(hook.matcher === undefined ? {} : { matcher: hook.matcher }),
        hooks: [{ type: 'command', command: hook.command, ...(hook.timeout === undefined ? {} : { timeout: hook.timeout }) }]
      })
    }
    declaration = { hooks: events }
  }
  const fallback = manifest.layout === 'kimi' ? undefined : await firstComponentFile(root, ['hooks/hooks.json', 'hooks.json'])
  if (declaration === undefined && fallback === undefined) return undefined
  const documents = await componentDocuments(root, declaration ?? fallback, errors, true)
  if (documents === undefined) return undefined
  const normalized: Array<{ file: string; settings: Record<string, unknown> }> = []
  for (const { path, value } of documents) {
    const events = value.hooks ?? value
    if (!isRecord(events)) {
      errors.push('hooks must contain an event table')
      return undefined
    }
    const output: Record<string, unknown> = {}
    for (const [event, groups] of Object.entries(events)) {
      const canonicalEvent = EVENT_ALIASES[event] ?? event
      if (!Array.isArray(groups)) {
        output[canonicalEvent] = groups
        continue
      }
      output[canonicalEvent] = groups.map(rawGroup => {
        const group =
          isRecord(rawGroup) && !Array.isArray(rawGroup.hooks) && (typeof rawGroup.command === 'string' || typeof rawGroup.bash === 'string')
            ? {
                matcher: rawGroup.matcher,
                hooks: [{ ...rawGroup, type: rawGroup.type ?? 'command', command: rawGroup.command ?? rawGroup.bash, timeout: rawGroup.timeout ?? rawGroup.timeoutSec }]
              }
            : rawGroup
        if (!isRecord(group) || !Array.isArray(group.hooks)) return group
        return {
          ...group,
          hooks: group.hooks.map(hook => {
            if (!isRecord(hook)) return hook
            if (hook.type !== 'process') return typeof hook.command === 'string' ? { ...hook, command: rootVariables(hook.command, root) } : hook
            if (typeof hook.command !== 'string' || (hook.args !== undefined && (!Array.isArray(hook.args) || !hook.args.every(arg => typeof arg === 'string'))))
              return { ...hook, type: 'command', command: undefined }
            const argv = [hook.command, ...((hook.args ?? []) as string[])].map(arg => quote(rootVariables(arg, root)))
            return { ...hook, type: 'command', command: argv.join(' '), ...(typeof hook.timeoutMs === 'number' ? { timeout: hook.timeoutMs / 1000 } : {}) }
          })
        }
      })
    }
    normalized.push({ file: path === undefined ? manifest.path : relative(root, path), settings: { hooks: output } })
  }
  return normalizeHookDocuments(root, normalized, errors)
}

export async function discoverSystemPrompt(root: string, manifest: SuiteManifest, errors: string[]): Promise<string | undefined> {
  const parts: string[] = []
  if (manifest.systemPrompt !== undefined) parts.push(manifest.systemPrompt)
  if (manifest.systemPromptPath !== undefined) {
    const path = await componentPath(root, manifest.systemPromptPath, errors)
    if (path === undefined) return undefined
    try {
      parts.push(await readFile(path, 'utf8'))
    } catch {
      errors.push('systemPromptPath is unreadable')
      return undefined
    }
  }
  const content = parts.join('\n\n')
  if (Buffer.byteLength(content) > 32768) {
    errors.push('system prompt exceeds 32 KiB')
    return undefined
  }
  return content === '' ? undefined : content
}
