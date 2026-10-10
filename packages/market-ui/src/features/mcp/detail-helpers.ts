/** Shared builders for the MCP detail dialogs: the tool parameter rows. */
import { createElement as h, type ReactNode } from 'react'
import type { Translate } from '../../i18n.js'
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
