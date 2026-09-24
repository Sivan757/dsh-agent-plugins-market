import { describe, expect, it } from 'vitest'
import { assertSupportedJsonSchema, type JsonSchemaNode } from '../src/runtime/mcp/bridge/json-schema-subset.js'

/** Assert passthrough: returns the node typed, throwing the validator's own error. */
function accept(schema: unknown): JsonSchemaNode {
  assertSupportedJsonSchema(schema)
  return schema
}

describe('the enforced JSON Schema subset for MCP outputSchema', () => {
  it('accepts annotation-only schemas as unconstrained JSON', () => {
    expect(accept({})).toEqual({})
    expect(accept({ description: 'anything', title: 'T', default: { a: [1, 'x', null, true] }, examples: [1, { b: 2 }] })).toEqual({
      description: 'anything',
      title: 'T',
      default: { a: [1, 'x', null, true] },
      examples: [1, { b: 2 }]
    })
  })

  it('accepts the full enforced vocabulary, including nesting', () => {
    const schema = {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'search text' },
        limit: { type: 'integer', enum: [1, 5, 10] },
        exact: { const: 'fixed' },
        flag: { type: 'boolean' },
        nothing: { type: 'null' },
        tags: { type: 'array', items: { type: 'string' } },
        nested: {
          type: 'object',
          properties: { deep: { type: 'number' } },
          required: ['deep'],
          additionalProperties: false
        }
      },
      required: ['query'],
      additionalProperties: true
    }
    expect(accept(schema)).toEqual(schema)
  })

  it('accepts a oneOf over disjoint shapes and any scalar enum with a matching type', () => {
    expect(
      accept({
        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }]
      })
    ).toBeDefined()
    expect(accept({ type: 'string', enum: ['a', 'b'] })).toBeDefined()
    expect(accept({ type: 'integer', enum: [1, 2, 3] })).toBeDefined()
    expect(accept({ type: 'boolean', enum: [true] })).toBeDefined()
    expect(accept({ type: 'null', const: null })).toBeDefined()
  })

  it('rejects unknown keywords instead of passing them unenforced', () => {
    expect(() => accept({ type: 'string', pattern: '^a' })).toThrow('unsupported JSON schema: schema.pattern is not part of the enforced subset')
    expect(() => accept({ type: 'object', properties: { a: { type: 'string', minLength: 1 } } })).toThrow('minLength is not part of the enforced subset')
  })

  it('rejects a schema that is not an object, and unknown type values', () => {
    expect(() => accept('string')).toThrow('schema must be an object')
    expect(() => accept([])).toThrow('schema must be an object')
    expect(() => accept(null)).toThrow('schema must be an object')
    expect(() => accept({ type: 'map' })).toThrow('schema.type must be one of')
    expect(() => accept({ type: ['string', 'null'] })).toThrow('schema.type must be one of')
  })

  it('rejects a type combined with oneOf, and a too-small oneOf', () => {
    expect(() => accept({ type: 'string', oneOf: [{ type: 'string' }, { type: 'number' }] })).toThrow('must not declare both type and oneOf')
    expect(() => accept({ oneOf: [{ type: 'string' }] })).toThrow('oneOf requires at least two branches')
    expect(() => accept({ oneOf: 'nope' })).toThrow('oneOf requires at least two branches')
    // A bad branch is reported at its own path.
    expect(() => accept({ oneOf: [{ type: 'string' }, { type: 'string', maximum: 3 }] })).toThrow('schema.oneOf[1].maximum is not part of the enforced subset')
  })

  it('rejects properties, required, and additionalProperties off an object schema', () => {
    expect(() => accept({ type: 'string', properties: { a: { type: 'string' } } })).toThrow('properties is only valid on an object schema')
    expect(() => accept({ properties: { a: { type: 'string' } } })).toThrow('properties is only valid on an object schema')
    expect(() => accept({ type: 'string', required: ['a'] })).toThrow('required is only valid on an object schema')
    expect(() => accept({ type: 'array', additionalProperties: false })).toThrow('additionalProperties is only valid on an object schema')
    expect(() => accept({ type: 'object', properties: 'nope' })).toThrow('properties must be an object of schemas')
    expect(() => accept({ type: 'object', required: ['a', 42] })).toThrow('required must be an array of property names')
    expect(() => accept({ type: 'object', required: ['ghost'] })).toThrow('required lists "ghost" which has no declared property')
    expect(() => accept({ type: 'object', additionalProperties: 'yes' })).toThrow('additionalProperties must be a boolean')
  })

  it('rejects items off an array schema, and a malformed item schema', () => {
    expect(() => accept({ type: 'string', items: { type: 'string' } })).toThrow('items is only valid on an array schema')
    expect(() => accept({ type: 'array', items: { type: 'string', maxLength: 3 } })).toThrow('items.maxLength is not part of the enforced subset')
    expect(() => accept({ type: 'array', items: 'string' })).toThrow('schema.items must be an object')
  })

  it('rejects enum and const values that do not fit the declared type or the scalar vocabulary', () => {
    expect(() => accept({ type: 'string', enum: ['a', 1] })).toThrow('enum values must match the declared string type')
    expect(() => accept({ type: 'integer', enum: [1, 1.5] })).toThrow('enum values must match the declared integer type')
    expect(() => accept({ type: 'number', enum: [] })).toThrow('enum must be a non-empty array of JSON scalars')
    expect(() => accept({ enum: [[1]] })).toThrow('enum must be a non-empty array of JSON scalars')
    expect(() => accept({ enum: [{ a: 1 }] })).toThrow('enum must be a non-empty array of JSON scalars')
    expect(() => accept({ type: 'string', const: 3 })).toThrow('const must be a scalar matching the declared schema type')
    expect(() => accept({ const: { nested: true } })).toThrow('const must be a scalar matching the declared schema type')
  })

  it('rejects annotation values that cannot round-trip lossless JSON', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    expect(() => accept({ default: cyclic })).toThrow('schema.default must be lossless JSON')
    expect(() => accept({ examples: cyclic })).toThrow('schema.examples must be lossless JSON')
    expect(() => accept({ default: 1n as unknown as number })).toThrow('lossless JSON')
  })

  it('rejects recursive schema graphs instead of recursing forever', () => {
    const loop: Record<string, unknown> = { type: 'object', properties: {} }
    loop['properties'] = { self: loop }
    expect(() => accept(loop)).toThrow('is recursive; the subset does not accept recursive schemas')
  })

  it('accumulates every violation into one diagnostic in walk order', () => {
    try {
      accept({ type: 'object', properties: { a: { type: 'bit' } }, required: ['ghost'], pattern: '^x', oneOf: [] })
      expect.unreachable('expected the assertion to throw')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('schema.pattern is not part of the enforced subset')
      expect(message).toContain('schema must not declare both type and oneOf')
      expect(message).toContain('schema.oneOf requires at least two branches')
      expect(message).toContain('schema.properties.a.type must be one of')
      expect(message).toContain('schema.required lists "ghost" which has no declared property')
      // Walk order: object keywords before the oneOf pair is not guaranteed, so
      // only assert that each violation appears once in the joined message.
      expect(message.split('; ').filter(part => part.includes('oneOf'))).toHaveLength(2)
    }
  })
})
