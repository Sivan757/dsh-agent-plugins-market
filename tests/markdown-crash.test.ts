// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

// Points at a locally-installed suite for a real-world markdown crash test.
// This path only exists on the maintainer's machine; the test skips in CI
// and any other environment where the directory is absent.
const ROOT = '/Users/sivan/.dsh/agent-plugins/.sources/mattpocock/skills'

function skillFiles(): string[] {
  const files: string[] = []
  for (const cat of readdirSync(ROOT, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue
    for (const dir of readdirSync(`${ROOT}/${cat.name}`, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue
      const file = `${ROOT}/${cat.name}/${dir.name}/SKILL.md`
      try {
        readFileSync(file, 'utf8')
        files.push(file)
      } catch {
        /* skip */
      }
    }
  }
  return files
}

describe('MarkdownText renders all mattpocock skill bodies', () => {
  it.runIf(existsSync(ROOT))('does not throw on any SKILL.md', () => {
    const files = skillFiles()
    expect(files.length).toBeGreaterThan(0)
    const crashed: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      try {
        act(() => {
          root.render(h(MarkdownText, { text, labels: { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' } }))
        })
        act(() => {
          root.unmount()
        })
      } catch {
        crashed.push(file)
      } finally {
        container.remove()
      }
    }
    expect(crashed, `crashed files: ${crashed.join(', ')}`).toEqual([])
  })
})
