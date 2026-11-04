/**
 * Guards that the package ships no built-in output styles.
 *
 * Styles come from plugins and from the person. A directory of the plugin's own
 * documents would reintroduce a third source, so its absence is the invariant now.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

describe('published output styles', () => {
  it('publishes no built-in style directory and no file entry for one', () => {
    expect(existsSync('plugins/output-styles')).toBe(false)
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { files?: string[] }
    expect(manifest.files ?? []).not.toContain('plugins/output-styles')
  })
})
