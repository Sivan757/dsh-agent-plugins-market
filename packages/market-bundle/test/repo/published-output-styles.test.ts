/**
 * Guards the published file set against the builtin output styles.
 *
 * `packages/market-runtime/src/application/output-styles.ts` resolves the style
 * documents from the package that carries them: `plugins/output-styles/styles`
 * beside the private workspace package in the checkout, and the same path under
 * the published package root, which the npm `files` entry preserves. A tarball
 * without that entry would ship no builtin style at all, and the default style
 * that turns styles off is one of them.
 *
 * The checks below are filesystem-only: no pack, no build, no network. The
 * shipped-path literal is duplicated here on purpose, so a resolver change has
 * to move this test with it.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const RESOLVER = 'packages/market-runtime/src/application/output-styles.ts'
/** The style directory the resolver computes inside the published artifact. */
const PACKED_STYLES_DIR = 'plugins/output-styles/styles'
/** The styles the page promises before a person authors one. */
const REQUIRED = ['default.md', 'explanatory.md', 'concise.md'] as const

/** Whether an npm `files` list ships `target`; a directory entry ships recursively. */
function shipped(files: readonly string[], target: string): boolean {
  return files.some(entry => {
    const shippedPath = entry.replace(/^\.\//, '').replace(/\/+$/, '')
    return target === shippedPath || target.startsWith(shippedPath + '/')
  })
}

describe('published output styles', () => {
  it('ships every builtin style the resolver reads', async () => {
    const source = await readFile(join(ROOT, RESOLVER), 'utf8')
    // The resolver names the packed directory in its package-root branch; keep
    // the two spellings in step.
    expect(source).toContain("'plugins', 'output-styles', 'styles'")
    const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as { files?: string[] }
    const files = manifest.files ?? []
    expect(files.length).toBeGreaterThan(0)
    for (const name of REQUIRED) {
      const declared = `${PACKED_STYLES_DIR}/${name}`
      expect(existsSync(join(ROOT, declared)), declared + ' is missing from the checkout').toBe(true)
      expect(shipped(files, declared), declared + ' is not covered by the package.json "files" entries ' + JSON.stringify(files)).toBe(true)
    }
  })

  it('ships the plugin manifest that makes the collection list the styles', async () => {
    const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as { files?: string[] }
    expect(shipped(manifest.files ?? [], 'plugins/output-styles/plugin.json')).toBe(true)
  })
})
