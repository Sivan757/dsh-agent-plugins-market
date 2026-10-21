/**
 * Guards the published file set against the runtime's vendored schemas.
 *
 * `packages/market-catalog/src/scanning/validate.ts` resolves the JSON
 * Schemas from the package that carries it: `schemas/` beside the private
 * workspace package in the checkout, and `packages/market-catalog/schemas`
 * under the published package root — the npm `files` entry preserves the
 * workspace path, and `tsc` emits the module to
 * `lib/packages/market-catalog/src/scanning/validate.js`. The tarball
 * therefore has to ship that directory under exactly that path. Issue #113
 * shipped none: `files` named a root `schemas/` that does not exist, so
 * every manifest validation threw ENOENT at runtime. The checks below are
 * filesystem-only and need no pack, no build and no network.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const VALIDATOR = 'packages/market-catalog/src/scanning/validate.ts'
/**
 * The schema directory the resolver computes inside the published artifact
 * (`join(root, 'packages/market-catalog/schemas')` in the resolver's
 * `dsh-agent-plugins-market` branch). Keep in step with that branch.
 */
const PACKED_SCHEMAS_DIR = 'packages/market-catalog/schemas'
const SCHEMA_FILES = ['plugin.schema.json', 'mcp.schema.json'] as const

/** Every Agent Plugins release the validator bundles, read from its source. */
async function supportedVersions(source: string): Promise<string[]> {
  const versions = [...source.matchAll(/^\s*\{ version: '([^']+)'/gm)].map(match => match[1] ?? '')
  expect(versions.length, 'no SpecVersion entry found in ' + VALIDATOR).toBeGreaterThan(0)
  for (const version of versions) expect(version, VALIDATOR).toMatch(/^\d+\.\d+\.\d+$/)
  return versions
}

/** Whether an npm `files` list ships `target`; a directory entry ships recursively. */
function shipped(files: readonly string[], target: string): boolean {
  return files.some(entry => {
    const shippedPath = entry.replace(/^\.\//, '').replace(/\/+$/, '')
    return target === shippedPath || target.startsWith(shippedPath + '/')
  })
}

describe('published schemas', () => {
  it('ships every schema file the validator reads', async () => {
    const source = await readFile(join(ROOT, VALIDATOR), 'utf8')
    expect(source).toContain(PACKED_SCHEMAS_DIR)
    const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as { files?: string[] }
    const files = manifest.files ?? []
    expect(files.length).toBeGreaterThan(0)
    for (const version of await supportedVersions(source)) {
      for (const name of SCHEMA_FILES) {
        const declared = `${PACKED_SCHEMAS_DIR}/${version}/${name}`
        expect(existsSync(join(ROOT, declared)), declared + ' is missing from the checkout').toBe(true)
        expect(shipped(files, declared), declared + ' is not covered by the package.json "files" entries ' + JSON.stringify(files)).toBe(true)
      }
    }
  })

  it('keeps the packed resolver path in step with the files entry', async () => {
    // The packed module sits under lib/, so the only package.json above it is
    // the published root one; the resolver returns the schema directory this
    // test names above. A rename on either side breaks the pairing silently,
    // so the literal is asserted against the resolver source.
    const source = await readFile(join(ROOT, VALIDATOR), 'utf8')
    const resolverBranch = source.match(/name === 'dsh-agent-plugins-market'\) return join\(directory, '([^']+)'\)/)
    expect(resolverBranch?.[1]).toBe(PACKED_SCHEMAS_DIR)
  })
})
