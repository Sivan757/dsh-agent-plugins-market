/** Resolve declared component files once; all consumers use the same contained resource paths. */
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import type { SuiteMarkdownResource } from '../model/types.js'
import { PLUGIN_ROOT_VARIABLES } from '../model/layouts.js'
import { isFile } from './fs-probes.js'
import { isWithin } from './paths.js'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `Array.isArray` narrows to `any[]`; declarations are untrusted, so the elements stay `unknown`. */
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/** True only for an array whose every element is a string. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

/** Reject both lexical and symlink escapes. Optional defaults may be absent without a diagnostic. */
export async function componentPath(root: string, value: string, errors: string[], required = true): Promise<string | undefined> {
  const clean = value.replace(/^\$\{([A-Z_]+)\}\//, (match, name: string) => (PLUGIN_ROOT_VARIABLES.has(name) ? './' : match))
  const path = resolve(root, clean)
  if (!isWithin(resolve(root), path)) {
    errors.push(`component path ${value}: escapes the suite root`)
    return undefined
  }
  try {
    const [base, target] = await Promise.all([realpath(root), realpath(path)])
    if (!isWithin(base, target)) {
      errors.push(`component path ${value}: escapes the suite root through a symlink`)
      return undefined
    }
    return path
  } catch {
    if (required) errors.push(`component path ${value}: missing or unreadable`)
    return undefined
  }
}

/** Commands and agents may declare one file, several files, or recursive directories. */
export async function discoverMarkdownResources(
  root: string,
  component: 'commands' | 'agents',
  declaration: unknown,
  manifestPath: string,
  errors: string[],
  extensions: readonly string[] = ['.md']
): Promise<SuiteMarkdownResource[]> {
  const resources: SuiteMarkdownResource[] = []
  const seen = new Set<string>()
  const add = (resource: SuiteMarkdownResource): void => {
    const identity = `${resource.file}\0${resource.name}`
    if (!seen.has(identity)) {
      seen.add(identity)
      resources.push(resource)
    }
  }
  async function visit(path: string, container: string): Promise<void> {
    const valid = await componentPath(root, relative(root, path), errors)
    if (valid === undefined) return
    const info = await stat(valid)
    if (info.isFile()) {
      if (extensions.includes(extname(path))) add({ name: relative(container, path).replace(/\\/g, '/').slice(0, -extname(path).length), file: path })
      return
    }
    if (!info.isDirectory()) return
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue
      await visit(join(path, entry.name), container)
    }
  }
  const declared = declaration === undefined ? [component] : Array.isArray(declaration) ? declaration : [declaration]
  for (const item of declared) {
    if (typeof item === 'string') {
      const path = await componentPath(root, item, errors, declaration !== undefined)
      if (path === undefined) continue
      const info = await stat(path)
      await visit(path, info.isDirectory() ? path : resolve(path, '..'))
    } else if (component === 'commands' && isRecord(item)) {
      for (const [name, spec] of Object.entries(item)) {
        if (!isRecord(spec) || (typeof spec.source !== 'string' && typeof spec.content !== 'string') || (spec.source !== undefined && spec.content !== undefined)) {
          errors.push(`commands.${name}: requires exactly one source or content`)
          continue
        }
        if (typeof spec.source === 'string') {
          const file = await componentPath(root, spec.source, errors)
          if (file !== undefined) add({ name, file })
        } else {
          const metadata = Object.fromEntries(Object.entries(spec).filter(([key]) => !['source', 'content'].includes(key)))
          // JSON is a YAML subset, preserving command metadata without string-built YAML scalars.
          add({ name, file: manifestPath, content: `---\n${JSON.stringify(metadata)}\n---\n${spec.content as string}` })
        }
      }
    } else {
      errors.push(`${component}: invalid component declaration`)
    }
  }
  return resources
}

export interface ComponentDocument {
  path?: string
  value: Record<string, unknown>
}
/** A malformed declared file invalidates that configuration surface instead of falling back. */
export async function componentDocuments(root: string, declaration: unknown, errors: string[], allowDirectory = false): Promise<ComponentDocument[] | undefined> {
  const result: ComponentDocument[] = []
  for (const item of Array.isArray(declaration) ? declaration : [declaration]) {
    if (typeof item === 'string') {
      const path = await componentPath(root, item, errors)
      if (path === undefined) return undefined
      if (allowDirectory && (await stat(path)).isDirectory()) {
        const files = (await readdir(path))
          .filter(file => file.endsWith('.json'))
          .sort()
          .map(file => relative(root, join(path, file)))
        const nested = await componentDocuments(root, files, errors)
        if (nested === undefined) return undefined
        result.push(...nested)
        continue
      }
      try {
        const value: unknown = JSON.parse(await readFile(path, 'utf8'))
        if (!isRecord(value)) {
          errors.push(`${item}: configuration must be an object`)
          return undefined
        }
        result.push({ path, value })
      } catch {
        errors.push(`${item}: invalid JSON configuration`)
        return undefined
      }
    } else if (isRecord(item)) {
      result.push({ value: item })
    } else {
      errors.push('invalid JSON component declaration')
      return undefined
    }
  }
  return result
}

export async function firstComponentFile(root: string, candidates: readonly string[]): Promise<string | undefined> {
  for (const path of candidates) if (await isFile(join(root, path))) return path
  return undefined
}

/** Legacy/native suites without catalog resource lists keep their conventional directory behavior. */
export async function defaultMarkdownResources(root: string, component: 'agents' | 'commands'): Promise<SuiteMarkdownResource[]> {
  return discoverMarkdownResources(root, component, undefined, '', [])
}

export async function resourceText(resource: SuiteMarkdownResource): Promise<string> {
  return resource.content ?? (await readFile(resource.file, 'utf8'))
}

export function resourceCommandName(name: string): string {
  return name.replaceAll('/', '-').replaceAll('\\', '-').toLowerCase()
}
