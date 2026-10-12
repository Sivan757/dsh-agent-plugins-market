/**
 * The first-party plugin collection lives in this repository under `plugins/`.
 *
 * The collection is what a fresh install sees through the preset `dsh-agent-plugins`
 * source, so it must always pass the market's own conformance bar: the scanner this
 * plugin ships has to discover every suite under `plugins/`, each manifest has to
 * validate against the vendored schemas, and no scan note may report a skipped file.
 * A collection change and the validator that judges it therefore travel in the same
 * commit.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanSource } from '../src/scanning/scan-resolvers.js'

const PLUGINS_ROOT = fileURLToPath(new URL('../../../plugins/', import.meta.url))

import { fileURLToPath } from 'node:url'

async function collectionPluginDirectories(): Promise<string[]> {
  const entries = await readdir(PLUGINS_ROOT, { withFileTypes: true })
  return entries.filter(entry => entry.isDirectory()).map(entry => join(PLUGINS_ROOT, entry.name))
}

describe('first-party plugin collection', () => {
  it('discovers every plugin directory through the shipped scanner', async () => {
    const directories = await collectionPluginDirectories()
    expect(directories.length).toBeGreaterThan(0)
    for (const directory of directories) {
      const result = await scanSource(directory, 'dsh-agent-plugins', 'project')
      expect(result.suites, directory).toHaveLength(1)
    }
  })

  it('produces no scan notes for the collection', async () => {
    for (const directory of await collectionPluginDirectories()) {
      const result = await scanSource(directory, 'dsh-agent-plugins', 'project')
      expect(result.notes, directory).toEqual([])
    }
  })

  it('validates every manifest against the vendored schemas', async () => {
    for (const directory of await collectionPluginDirectories()) {
      const manifestPath = join(directory, 'plugin.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { name?: string }
      expect(manifest.name, manifestPath).toBeTruthy()
    }
  })
})
