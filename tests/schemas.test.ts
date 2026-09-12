/**
 * Guards the specification library under `schemas/`: every vendored and
 * authored schema must compile, `$id`s must stay unique, the runtime
 * agent-plugins ids must stay pinned to `validate.ts`, and each dialect must
 * keep a sibling spec document and a paired marketplace schema.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Same 2020-12 dist quirk as src/catalog/validate.ts: the d.ts resolves to a
// CJS namespace, the runtime default export is the class itself.
import Ajv2020Default from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { MCP_SCHEMA_ID, PLUGIN_SCHEMA_ID } from '../src/catalog/validate.js'

const SCHEMAS_DIR = fileURLToPath(new URL('../schemas/', import.meta.url))

const Ajv2020 = Ajv2020Default as unknown as { new (options?: Record<string, unknown>): { compile(schema: unknown): unknown } }

interface SchemaFile {
  /** Path relative to `schemas/`, e.g. `zcode/plugin.schema.json`. */
  relative: string
  document: Record<string, unknown>
}

async function walk(directory: string, prefix = ''): Promise<SchemaFile[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: SchemaFile[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await walk(join(directory, entry.name), relative)))
    } else if (entry.name.endsWith('.schema.json')) {
      files.push({ relative, document: JSON.parse(await readFile(join(directory, entry.name), 'utf8')) as Record<string, unknown> })
    }
  }
  return files
}

const schemas = await walk(SCHEMAS_DIR)

describe('schemas library', () => {
  it('finds every vendored and authored schema', () => {
    expect(schemas.length).toBeGreaterThanOrEqual(18)
    expect(schemas.some(schema => schema.relative === '1.0.0/plugin.schema.json')).toBe(true)
    expect(schemas.some(schema => schema.relative === 'zcode/plugin.schema.json')).toBe(true)
  })

  it('compiles every schema as JSON Schema draft 2020-12', () => {
    const ajv = new Ajv2020({ strict: false })
    for (const schema of schemas) {
      expect(() => ajv.compile(schema.document), `${schema.relative} must compile`).not.toThrow()
      expect(schema.document['$schema'], `${schema.relative} must declare the 2020-12 dialect`).toBe('https://json-schema.org/draft/2020-12/schema')
    }
  })

  it('keeps every $id unique and absolute', () => {
    const ids = schemas.map(schema => schema.document['$id'])
    for (const [index, id] of ids.entries()) {
      const schema = schemas[index]
      if (schema === undefined) throw new Error(`expected a schema for $id entry ${index}`)
      expect(typeof id, `${schema.relative} must declare $id`).toBe('string')
      expect(id as string, `${schema.relative} $id must be absolute`).toMatch(/^https:\/\//)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('pins the vendored agent-plugins ids to the runtime constants', () => {
    const vendored = new Map(schemas.filter(schema => schema.relative.startsWith('1.0.0/')).map(schema => [schema.relative, schema.document['$id']]))
    expect(vendored.get('1.0.0/plugin.schema.json')).toBe(PLUGIN_SCHEMA_ID)
    expect(vendored.get('1.0.0/mcp.schema.json')).toBe(MCP_SCHEMA_ID)
  })

  it('pairs every dialect schema with a marketplace schema and a spec document', async () => {
    // `1.0.0/` is the vendored upstream directory: its schemas are documented
    // by schemas/agent-plugins/spec.md and schemas/README.md, not a sibling file.
    const directories = (await readdir(SCHEMAS_DIR, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name !== '1.0.0').map(entry => entry.name)
    expect(directories.length).toBeGreaterThanOrEqual(9)
    for (const directory of directories) {
      const files = await readdir(join(SCHEMAS_DIR, directory))
      expect(files, `schemas/${directory} must ship a spec document`).toContain('spec.md')
      if (files.includes('plugin.schema.json')) {
        expect(files, `schemas/${directory} must pair plugin.schema.json with marketplace.schema.json`).toContain('marketplace.schema.json')
      }
    }
  })
})
