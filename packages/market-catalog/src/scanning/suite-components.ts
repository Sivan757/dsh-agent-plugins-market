/** Resolve all plugin component declarations into the same normalized resources used by runtime consumers. */
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ProjectHooks, SuiteManifest, LspSuiteConfig, SuiteStyleFile } from '../../../market-contracts/src/model/types.js'
import { componentDocuments, componentPath, firstComponentFile, isRecord, isStringArray, isUnknownArray } from './component-files.js'
import { parseLspServers } from './lsp-spec.js'
import { normalizeHookDocuments } from './project-hooks.js'
import { expandPluginPaths } from './plugin-variables.js'

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
  return expandPluginPaths(text, { root })
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
      if (!isUnknownArray(groups)) {
        output[canonicalEvent] = groups
        continue
      }
      output[canonicalEvent] = groups.map(rawGroup => {
        const group =
          isRecord(rawGroup) && !isUnknownArray(rawGroup.hooks) && (typeof rawGroup.command === 'string' || typeof rawGroup.bash === 'string')
            ? {
                matcher: rawGroup.matcher,
                hooks: [{ ...rawGroup, type: rawGroup.type ?? 'command', command: rawGroup.command ?? rawGroup.bash, timeout: rawGroup.timeout ?? rawGroup.timeoutSec }]
              }
            : rawGroup
        if (!isRecord(group) || !isUnknownArray(group.hooks)) return group
        return {
          ...group,
          hooks: group.hooks.map(hook => {
            if (!isRecord(hook)) return hook
            if (hook.type !== 'process') return typeof hook.command === 'string' ? { ...hook, command: rootVariables(hook.command, root) } : hook
            if (typeof hook.command !== 'string' || (hook.args !== undefined && !isStringArray(hook.args))) return { ...hook, type: 'command', command: undefined }
            const argv = [hook.command, ...(hook.args ?? [])].map(arg => quote(rootVariables(arg, root)))
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

/** Split one style file into its frontmatter object and its body. */
function splitStyleSource(text: string): { meta: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (match === null) return { meta: {}, body: text.trim() }
  let meta: Record<string, unknown> = {}
  try {
    const parsed: unknown = parseYaml(match[1] ?? '')
    if (isRecord(parsed)) meta = parsed
  } catch {
    // A broken block still yields the body: the file's instructions are the style.
  }
  return { meta, body: text.slice(match[0].length).trim() }
}

/**
 * Read the Markdown output styles a suite ships.
 *
 * The declaration follows the same shapes the other markdown components take: a
 * directory, a file, a list of either, or a name-keyed table with `source` or
 * `content`. Without a declaration the conventional `output-styles/` directory is
 * read, which is what a Claude Code plugin ships by default.
 * @param root - the suite root.
 * @param manifest - the suite manifest, for its component declaration.
 * @param errors - the rejection list the caller reports.
 * @returns the styles, in name order; empty when the suite ships none.
 */
export async function discoverSuiteStyles(root: string, manifest: SuiteManifest, errors: string[]): Promise<SuiteStyleFile[]> {
  const styles: SuiteStyleFile[] = []
  const seen = new Set<string>()
  const add = (file: string, body: string, fallbackName: string): void => {
    const { meta, body: instructions } = splitStyleSource(body)
    const declaredName = typeof meta['name'] === 'string' && meta['name'].trim() !== '' ? meta['name'].trim() : fallbackName
    if (instructions === '') {
      errors.push(`output style "${declaredName}" has no instructions`)
      return
    }
    if (seen.has(declaredName)) return
    seen.add(declaredName)
    styles.push({
      name: declaredName,
      description: typeof meta['description'] === 'string' ? meta['description'] : '',
      keepCodingInstructions: meta['keep-coding-instructions'] === true,
      file,
      body: instructions
    })
  }
  async function visit(path: string, container: string): Promise<void> {
    const valid = await componentPath(root, relative(root, path), errors)
    if (valid === undefined) return
    const info = await stat(valid)
    if (info.isFile()) {
      if (extname(valid) === '.md') add(valid, await readFile(valid, 'utf8'), relative(container, valid).replace(/\.md$/u, '').replace(/\\/g, '/'))
      return
    }
    if (!info.isDirectory()) return
    for (const entry of (await readdir(valid, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue
      await visit(join(valid, entry.name), container)
    }
  }
  const declaration = manifest.components?.outputStyles
  if (declaration === undefined) {
    // The conventional directory is optional: a suite that ships no styles says so by
    // having no directory, and that is not a rejection to report.
    const conventional = join(root, 'output-styles')
    const present = await stat(conventional).then(
      info => info.isDirectory(),
      () => false
    )
    if (!present) return []
  }
  const items = declaration === undefined ? ['output-styles'] : Array.isArray(declaration) ? declaration : [declaration]
  for (const item of items) {
    if (typeof item === 'string') {
      const path = await componentPath(root, item, errors, declaration !== undefined)
      if (path === undefined) continue
      const info = await stat(path)
      if (info.isDirectory()) await visit(path, path)
      else await visit(path, resolve(path, '..'))
      continue
    }
    if (!isRecord(item)) {
      errors.push('outputStyles: invalid component declaration')
      continue
    }
    for (const [name, spec] of Object.entries(item)) {
      if (!isRecord(spec)) {
        errors.push(`outputStyles.${name}: invalid entry`)
        continue
      }
      if (typeof spec.source === 'string') {
        const file = await componentPath(root, spec.source, errors)
        if (file !== undefined) add(file, await readFile(file, 'utf8'), name)
      } else if (typeof spec.content === 'string') {
        const metadata = Object.fromEntries(Object.entries(spec).filter(([key]) => key !== 'content' && key !== 'source'))
        add(`${manifest.id}:${name}`, `---\n${JSON.stringify({ name, ...metadata })}\n---\n${spec.content}`, name)
      } else {
        errors.push(`outputStyles.${name}: requires a source or content`)
      }
    }
  }
  return styles.sort((a, b) => a.name.localeCompare(b.name))
}
