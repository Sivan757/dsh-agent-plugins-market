/**
 * Local port of the harness's enforced JSON Schema subset validator
 * (`@deepseek-ai/dsh-tools` `json-schema.ts`, rc.2) — narrowed to the one use
 * the MCP bridge has: deciding whether an MCP server's advertised
 * `outputSchema` may ride a tool registration as a structured-output schema.
 *
 * The upstream validator is 656 lines with realm-safe JSON intrinsics; this
 * port keeps the *contract* — a closed keyword table, one scalar `type`,
 * nested structure, and "unsupported keywords reject rather than pass
 * unenforced" — with a conservative structural check. A schema this check
 * wrongly rejects only loses structured typing (the bridge falls back to
 * untyped JSON, exactly the upstream failure mode); one it wrongly accepts
 * would flow into the host registry, so every branch here fails closed.
 *
 * @module runtime/mcp-client/json-schema-subset
 */

/** Scalar JSON values supported by `enum` and `const`. */
export type JsonSchemaScalar = string | number | boolean | null

/** Single-type keywords accepted by the enforced subset. */
export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'

/**
 * One raw JSON Schema node in the enforced subset. The optional fields express
 * the external wire schema; {@link assertSupportedJsonSchema} rejects invalid
 * combinations before a caller treats the node as trusted.
 */
export interface JsonSchemaNode {
  /** Omit with no constraints for any JSON value, or use `oneOf`. */
  type?: JsonSchemaType
  /** Exactly one branch must validate; at least two branches are required. */
  oneOf?: JsonSchemaNode[]
  /** Nested property schemas (`type: 'object'` only). */
  properties?: Record<string, JsonSchemaNode>
  /** Required property names; each must appear in `properties`. */
  required?: string[]
  /** `false` rejects undeclared keys; absent/`true` follows JSON Schema's open default. */
  additionalProperties?: boolean
  /** Item schema (`type: 'array'` only); absent accepts any JSON item. */
  items?: JsonSchemaNode
  /** Allowed values for a scalar node. */
  enum?: JsonSchemaScalar[]
  /** The single allowed value for a scalar node. */
  const?: JsonSchemaScalar
  /** Annotation, ignored for validation. */
  description?: string
  /** Annotation, ignored for validation. */
  title?: string
  /** Annotation, ignored for validation but required to be lossless JSON. */
  default?: JsonSchemaScalar | Record<string, unknown> | unknown[]
  /** Annotation, ignored for validation but required to be lossless JSON. */
  examples?: JsonSchemaScalar | Record<string, unknown> | unknown[]
}

/** Constraint keywords the subset enforces; anything else rejects. */
const CONSTRAINT_KEYWORDS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const'])
/** Annotation keywords accepted but never enforced. */
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples'])
const SCHEMA_TYPES: readonly JsonSchemaType[] = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']

/** Narrow a raw value to a plain string-keyed record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a value is a JSON scalar (the only `enum`/`const` vocabulary). */
function isJsonScalar(value: unknown): value is JsonSchemaScalar {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/** Whether a value is a lossless JSON composite (round-trip checked). */
function isLosslessJson(value: unknown): boolean {
  if (!isRecord(value) && !Array.isArray(value)) return isJsonScalar(value)
  try {
    return JSON.parse(JSON.stringify(value)) !== undefined || value !== undefined
  } catch {
    return false
  }
}

/** Whether one scalar satisfies a declared schema type (integers include whole numbers). */
function scalarMatches(schemaType: JsonSchemaType | undefined, value: JsonSchemaScalar): boolean {
  if (schemaType === undefined) return true
  switch (schemaType) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    /* v8 ignore next -- scalar values never satisfy the container types */
    case 'object':
    case 'array':
      return false
  }
}

/**
 * Assert that a raw schema uses only the enforced subset. Annotation-only
 * schemas are accepted as the standard unconstrained-JSON form.
 * @param schema - untrusted raw JSON Schema.
 * @throws Error listing every violation when the schema leaves the subset.
 */
export function assertSupportedJsonSchema(schema: unknown): asserts schema is JsonSchemaNode {
  const violations: string[] = []
  checkSchemaNode(schema, 'schema', violations, new Set())
  if (violations.length > 0) {
    throw new Error(`unsupported JSON schema: ${violations.join('; ')}`)
  }
}

/** Depth-first walk of one schema node; violations accumulate in walk order. */
function checkSchemaNode(node: unknown, path: string, violations: string[], seen: Set<unknown>): void {
  if (seen.has(node)) {
    violations.push(`${path} is recursive; the subset does not accept recursive schemas`)
    return
  }
  if (!isRecord(node)) {
    violations.push(`${path} must be an object`)
    return
  }
  seen.add(node)
  try {
    for (const key of Object.keys(node)) {
      if (!CONSTRAINT_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
        violations.push(`${path}.${key} is not part of the enforced subset`)
      }
    }
    const hasType = Object.hasOwn(node, 'type')
    const hasOneOf = Object.hasOwn(node, 'oneOf')
    const type = hasType ? node.type : undefined
    if (hasType && !SCHEMA_TYPES.includes(type as JsonSchemaType)) {
      violations.push(`${path}.type must be one of ${SCHEMA_TYPES.join(', ')}`)
    }
    if (hasOneOf) {
      if (hasType) violations.push(`${path} must not declare both type and oneOf`)
      const branches = node.oneOf
      if (!Array.isArray(branches) || branches.length < 2) {
        violations.push(`${path}.oneOf requires at least two branches`)
      } else {
        for (const [index, branch] of branches.entries()) {
          checkSchemaNode(branch, `${path}.oneOf[${index}]`, violations, seen)
        }
      }
    }
    if (Object.hasOwn(node, 'properties')) {
      if (type !== 'object') violations.push(`${path}.properties is only valid on an object schema`)
      const properties = node.properties
      if (!isRecord(properties)) {
        violations.push(`${path}.properties must be an object of schemas`)
      } else {
        for (const [name, property] of Object.entries(properties)) {
          checkSchemaNode(property, `${path}.properties.${name}`, violations, seen)
        }
      }
    }
    if (Object.hasOwn(node, 'required')) {
      if (type !== 'object') violations.push(`${path}.required is only valid on an object schema`)
      const required = node.required
      if (!Array.isArray(required) || !required.every(entry => typeof entry === 'string')) {
        violations.push(`${path}.required must be an array of property names`)
      } else {
        const properties = isRecord(node.properties) ? node.properties : undefined
        for (const name of required as string[]) {
          if (properties === undefined || !Object.hasOwn(properties, name)) {
            violations.push(`${path}.required lists "${name}" which has no declared property`)
          }
        }
      }
    }
    if (Object.hasOwn(node, 'additionalProperties')) {
      if (type !== 'object') violations.push(`${path}.additionalProperties is only valid on an object schema`)
      if (typeof node.additionalProperties !== 'boolean') {
        violations.push(`${path}.additionalProperties must be a boolean`)
      }
    }
    if (Object.hasOwn(node, 'items')) {
      if (type !== 'array') violations.push(`${path}.items is only valid on an array schema`)
      checkSchemaNode(node.items, `${path}.items`, violations, seen)
    }
    if (Object.hasOwn(node, 'enum')) {
      const values = node.enum
      if (!Array.isArray(values) || values.length === 0 || !values.every(isJsonScalar)) {
        violations.push(`${path}.enum must be a non-empty array of JSON scalars`)
      } else {
        for (const value of values) {
          if (!scalarMatches(type as JsonSchemaType | undefined, value)) {
            violations.push(`${path}.enum values must match the declared ${String(type)} type`)
            break
          }
        }
      }
    }
    if (Object.hasOwn(node, 'const')) {
      const value = node.const
      if (!isJsonScalar(value) || !scalarMatches(type as JsonSchemaType | undefined, value)) {
        violations.push(`${path}.const must be a scalar matching the declared schema type`)
      }
    }
    for (const annotation of ['default', 'examples'] as const) {
      if (Object.hasOwn(node, annotation) && !isLosslessJson(node[annotation])) {
        violations.push(`${path}.${annotation} must be lossless JSON`)
      }
    }
  } finally {
    seen.delete(node)
  }
}
