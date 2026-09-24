/** Shared builders for the MCP detail dialogs: tool parameter rows and credential usage. */
import { createElement as h, type ReactNode } from 'react'
import { parsePastedServers, type ServerConfig } from '../../ui/server-form.js'
import type { Translate } from '../../index.js'
import css from './mcp-status.module.css'

/** How many tool rows a collapsed capability list shows before its expand row. */
export const TOOL_PAGE_SIZE = 8

export function toolParameterRows(parameters: unknown, t: Translate): ReactNode {
  const schema = (parameters ?? {}) as { properties?: unknown; required?: unknown }
  const properties = schema.properties
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties) || Object.keys(properties).length === 0) {
    return h('p', { className: css.toolParamsEmpty }, t('mcpToolNoParameters'))
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === 'string') : [])
  return h(
    'div',
    { className: css.toolParamsGrid },
    ...Object.entries(properties as Record<string, unknown>).map(([name, raw]) => {
      const node = (raw ?? {}) as Record<string, unknown>
      const type = typeof node.type === 'string' ? node.type : Array.isArray(node.enum) ? 'enum' : 'any'
      return h(
        'div',
        { key: name, className: css.toolParam },
        h('span', { className: css.toolParamName }, name),
        h('span', { className: css.toolParamType }, type),
        h('span', { className: css.toolParamRequired }, required.has(name) ? t('mcpToolParamRequired') : ''),
        h('span', { className: css.toolParamDesc }, typeof node.description === 'string' ? node.description : '')
      )
    })
  )
}

/** Parse a pasted document, or nothing while it is still half-typed. */
export function parsePastedServersOrUndefined(text: string): Array<{ name?: string; config: ServerConfig }> | undefined {
  try {
    return parsePastedServers(text)
  } catch {
    return undefined
  }
}

export function credentialUsage(t: Translate, config: Record<string, unknown> | undefined): Record<string, string[]> {
  const usage: Record<string, string[]> = {}
  if (config === undefined) return usage
  for (const [field, label] of [
    ['headers', t('detailHeaders')],
    ['env', t('detailEnv')]
  ] as const) {
    const values = config[field]
    if (typeof values !== 'object' || values === null) continue
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g)) {
        const name = match[1]
        if (name === undefined) continue
        const entries = usage[name] ?? []
        entries.push(`${label} ${key}`)
        usage[name] = entries
      }
    }
  }
  return usage
}
