/** Redact secret-shaped MCP configuration before it crosses a status/detail boundary. */

/**
 * Secret-shaped key matcher. This is a heuristic, not a security boundary: it
 * exists so a token cannot leak into a status response, a detail preview, or a
 * log line. Placeholder-bearing values (`${NAME}`) are always preserved because
 * they name a credential reference rather than carry one.
 */
const SENSITIVE_KEY =
  /(authorization|auth|bearer|token|secret|password|passwd|credential|api[-_]?key|access[-_]?key|private[-_]?key|session|cookie|signature|sig\b|^key$|[-_]key$)/i

/**
 * Structure keys that merely *name* an auth block (`auth`, and containers like
 * `headers` handled below) rather than carry a secret: redacting the whole
 * block would erase the OAuth opt-in flag before it reaches the mount, so the
 * walk descends into it and the per-value checks apply instead.
 */
const STRUCTURE_KEY = /^auth$/i

const PLACEHOLDER = /\$\{[^}]+\}/g

export function redactMcpConfig(value: unknown): unknown {
  return redactValue(value)
}

export function redactMcpOverrides(value: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  return redactValue(value) as Record<string, Record<string, unknown>>
}

/** Whether one map key is treated as secret-shaped. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

/** Redact credential-bearing query values from an endpoint URL. */
export function redactUrl(raw: string): string {
  const text = raw.trim()
  if (text === '') return text
  const [base, query = ''] = splitOnce(text, '?')
  if (query === '') return text
  const safeQuery = query
    .split('&')
    .filter(part => part !== '')
    .map(part => {
      const [name = '', value = ''] = splitOnce(part, '=')
      if (PLACEHOLDER.test(value)) return `${name}=${value}`
      return isSensitiveKey(name) ? `${name}=[redacted]` : `${name}=${value}`
    })
    .join('&')
  return safeQuery === '' ? base : `${base}?${safeQuery}`
}

function splitOnce(value: string, separator: string): [string, string] {
  const index = value.indexOf(separator)
  if (index === -1) return [value, '']
  return [value.slice(0, index), value.slice(index + 1)]
}

function redactArgs(values: unknown[]): unknown[] {
  let redactNext = false
  return values.map(value => {
    if (redactNext) {
      redactNext = false
      return '[redacted]'
    }
    if (typeof value !== 'string') return value
    const equals = value.indexOf('=')
    const flag = (equals === -1 ? value : value.slice(0, equals)).replace(/^-+/, '')
    if (!isSensitiveKey(flag)) return value
    if (equals === -1) {
      redactNext = true
      return value
    }
    return `${value.slice(0, equals + 1)}[redacted]`
  })
}

function redactValue(value: unknown, key = ''): unknown {
  if (STRUCTURE_KEY.test(key) && typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey)]))
  }
  if (isSensitiveKey(key)) {
    if (typeof value === 'string' && PLACEHOLDER.test(value)) return value.replace(PLACEHOLDER, match => match)
    return '[redacted]'
  }
  if (key === 'url' && typeof value === 'string') return redactUrl(value)
  if (key === 'args' && Array.isArray(value)) return redactArgs(value)
  if (Array.isArray(value)) return value.map(item => redactValue(item))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey)]))
  }
  return value
}
