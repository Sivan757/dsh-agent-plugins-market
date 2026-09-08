import { isMap, parseDocument } from 'yaml'

/** Parse an editable document without flattening nested YAML or discarding comments. */
function frontmatter(text: string) {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (/^(?:\uFEFF)?---\r?\n/.test(text) && match === null) throw new Error('Unclosed YAML frontmatter')
  const document = parseDocument(match?.[1] ?? '')
  if (document.errors.length > 0) throw new Error(document.errors[0]!.message)
  if (document.contents !== null && !isMap(document.contents)) throw new Error('Frontmatter must be a YAML mapping')
  return { document, body: match === null ? text : text.slice(match[0].length), matched: match !== null }
}

export function readRoleFields(text: string): { model: string; provider: string; tools: string } {
  const { document } = frontmatter(text)
  const fields = (document.toJS() ?? {}) as Record<string, unknown>
  return {
    model: typeof fields.model === 'string' ? fields.model : '',
    provider: typeof fields.provider === 'string' ? fields.provider : '',
    tools: Array.isArray(fields.tools) ? fields.tools.join(', ') : typeof fields.tools === 'string' ? fields.tools : ''
  }
}

/** Change only the selected key; retain unknown keys, comments, scalar types and Markdown body. */
export function updateFrontmatter(text: string, key: string, value: unknown): string {
  const { document, body, matched } = frontmatter(text)
  if (value === undefined || value === '') {
    if (!matched) return text
    document.delete(key)
  } else {
    document.set(key, value)
  }
  return `---\n${document.toString()}---\n${body}`
}
