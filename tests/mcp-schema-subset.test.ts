import { describe, expect, it } from 'vitest'
import { assertSupportedJsonSchema, JsonSchemaError, type JsonSchemaNode } from '@deepseek-ai/dsh-tools'

/** The bridge's admission call, unmodified: assert and return the typed node. */
function accept(schema: unknown): JsonSchemaNode {
  assertSupportedJsonSchema(schema)
  return schema
}

// The bridge admits a server's advertised `outputSchema` through the host's
// own enforced-subset validator (`@deepseek-ai/dsh-tools`, published from the
// package root since rc.2). These two pins hold the pieces the bridge relies
// on; the fallback behavior itself is exercised end-to-end in
// tests/mcp-bridge.test.ts ("falls back to untyped output ...").
describe('the host-published outputSchema admission contract', () => {
  it('keeps the upstream subset semantics the bridge assumes', () => {
    // Annotation-only schemas are the unconstrained-JSON form.
    expect(accept({})).toEqual({})
    expect(accept({ description: 'anything', default: { a: [1, 'x', null, true] } })).toEqual({
      description: 'anything',
      default: { a: [1, 'x', null, true] }
    })
    // One scalar type per node, nested structure, exact-one oneOf.
    expect(accept({ type: 'object', properties: { a: { type: 'integer' } }, required: ['a'], additionalProperties: false })).toBeDefined()
    expect(accept({ type: 'array', items: { type: 'string', enum: ['a'] } })).toBeDefined()
    expect(accept({ oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }] })).toBeDefined()
    // Unsupported or misplaced keywords reject rather than pass unenforced.
    expect(() => accept({ type: 'string', pattern: '^a' })).toThrow(/not a supported keyword|not part of the enforced subset/)
  })

  it('reports violations as JsonSchemaError with the violation list', () => {
    try {
      accept({ type: 'object', properties: { a: { type: 'bit' } }, required: ['ghost'] })
      expect.unreachable('expected the assertion to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(JsonSchemaError)
      const violations = (error as JsonSchemaError).violations
      expect(violations).toHaveLength(2)
      expect(violations.join(' ')).toContain('properties.a.type')
      expect(violations.join(' ')).toContain('required')
    }
  })
})
