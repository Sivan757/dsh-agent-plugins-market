import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverSuiteStyles } from '../src/scanning/suite-components.js'
import type { SuiteManifest } from '../../market-contracts/src/model/types.js'

/** A manifest whose only interesting field is the output-style declaration. */
function manifest(components: SuiteManifest['components'] = {}): SuiteManifest {
  return { layout: 'claude-code', path: '', id: 'teaching', name: 'Teaching', components }
}

describe('suite output-style files', () => {
  it('reads the conventional directory: frontmatter metadata and the body', async () => {
    const root = await mkdtemp(join(tmpdir(), 'suite-styles-'))
    try {
      await mkdir(join(root, 'output-styles'), { recursive: true })
      await writeFile(
        join(root, 'output-styles', 'teaching-style.md'),
        ['---', 'name: teaching-style', 'description: Teach as you go', 'keep-coding-instructions: true', '---', '', 'Explain as you go.', ''].join('\n'),
        'utf8'
      )
      await writeFile(join(root, 'output-styles', 'plain.md'), 'Answer first.\n', 'utf8')
      const errors: string[] = []
      const styles = await discoverSuiteStyles(root, manifest(), errors)
      expect(errors).toEqual([])
      expect(styles.map(style => style.name)).toEqual(['plain', 'teaching-style'])
      expect(styles.find(style => style.name === 'teaching-style')).toMatchObject({
        description: 'Teach as you go',
        keepCodingInstructions: true,
        body: 'Explain as you go.'
      })
      // No frontmatter is still a style: the file stem names it and the text is the body.
      expect(styles.find(style => style.name === 'plain')).toMatchObject({ description: '', keepCodingInstructions: false, body: 'Answer first.' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('follows a manifest declaration instead of the conventional directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'suite-styles-'))
    try {
      await mkdir(join(root, 'styles'), { recursive: true })
      await mkdir(join(root, 'output-styles'), { recursive: true })
      await writeFile(join(root, 'styles', 'declared.md'), 'Declared body.\n', 'utf8')
      await writeFile(join(root, 'output-styles', 'ignored.md'), 'Ignored body.\n', 'utf8')
      const styles = await discoverSuiteStyles(root, manifest({ outputStyles: ['styles'] }), [])
      // The field replaces the directory, the same way the other component fields do.
      expect(styles.map(style => style.name)).toEqual(['declared'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads a name-keyed table with inline content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'suite-styles-'))
    try {
      const styles = await discoverSuiteStyles(root, manifest({ outputStyles: { listing: { content: 'Numbered list only.' } } }), [])
      expect(styles).toHaveLength(1)
      expect(styles[0]).toMatchObject({ name: 'listing', body: 'Numbered list only.' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('ships no styles when there is no directory and no declaration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'suite-styles-'))
    try {
      const errors: string[] = []
      expect(await discoverSuiteStyles(root, manifest(), errors)).toEqual([])
      // An absent optional directory is not a rejection to report.
      expect(errors).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
