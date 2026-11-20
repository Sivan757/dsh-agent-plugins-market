// @vitest-environment node

/**
 * One dialog shell, one action row, one radius scale.
 *
 * Three rules the owner set after reviewing the workspace, each of which is
 * cheap to break and expensive to notice in review:
 *
 * 1. Every dialog goes through the plugin's own shell (`ui/DetailModal` and
 *    `ui/FormDialog`), never the host `Modal` directly. A dialog that builds
 *    its own chrome is a second layout nobody audits.
 * 2. An action row holds buttons and nothing else: no hint, count, or sentence
 *    sits to their left.
 * 3. Every corner comes from the host radius scale, and a capsule or a circle
 *    states its curve.
 *
 * The suite reads the sources and the stylesheets, so it fails on the shape of
 * the code rather than on one rendering of one surface.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = 'packages/market-ui/src'

/** Every file under a directory with one of the extensions. */
function sourceFiles(directory: string, extensions: readonly string[]): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(path, extensions))
    else if (extensions.some(extension => entry.name.endsWith(extension))) found.push(path)
  }
  return found
}

/** The host primitives a file imports. */
function primitiveImports(source: string): string[] {
  const names: string[] = []
  for (const match of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+'@deepseek-ai\/dsh-client-ui-primitives'/g)) {
    for (const name of (match[1] ?? '').split(',')) names.push(name.trim().replace(/^type\s+/, ''))
  }
  return names
}

describe('one dialog shell', () => {
  it('opens every dialog through the plugin shell, never the host Modal', () => {
    const offenders = sourceFiles(ROOT, ['.tsx'])
      .filter(file => !file.endsWith('ui/DetailModal.tsx'))
      .filter(file => primitiveImports(readFileSync(file, 'utf8')).includes('Modal'))
    expect(offenders, 'a surface builds its own dialog chrome').toEqual([])
  })

  it('renders no action row of its own outside the shell', () => {
    // Only a dialog element counts: a menu and the preset list carry their own
    // `footer` prop, which is a list region rather than an action row.
    const offenders = sourceFiles(ROOT, ['.tsx'])
      .filter(file => !file.endsWith('ui/DetailModal.tsx'))
      .filter(file => /<(?:Modal|DetailModal|FormDialog)\b[\s\S]{0,4000}?\bfooter\s*=/.test(readFileSync(file, 'utf8')))
    expect(offenders, 'a dialog passes a footer instead of an action row').toEqual([])
  })

  it('focuses a text field on its own edge, not with a ring outside it', () => {
    // A focused input that draws a second box around itself reads as a heavier
    // field. The border and a soft halo state focus; an outline does not.
    const css = readFileSync('packages/market-ui/src/ui/form.module.css', 'utf8')
    const focused = [...css.matchAll(/\.field (?:input|select|textarea):focus[^{]*\{([^}]*)\}/g)].map(match => match[1] ?? '')
    expect(focused.length).toBeGreaterThan(0)
    const painted = focused.flatMap(body => [...body.matchAll(/outline:\s*([^;]+)/g)].map(match => (match[1] ?? '').trim())).filter(value => value !== 'none')
    expect(painted).toEqual([])
    expect(focused.some(body => /border-color:/.test(body))).toBe(true)
  })

  it('keeps prose out of the action row', () => {
    const names = /\b(footerHint|footerCount|footerCountOver|modalFooter|modalFooterLeft|editorFooter)\b/
    const offenders = sourceFiles(ROOT, ['.tsx', '.css']).filter(file => names.test(readFileSync(file, 'utf8')))
    expect(offenders, 'an action row carries a hint, a count, or a sentence').toEqual([])
  })
})

describe('one radius scale', () => {
  /** One declared corner, with the rule body it sits in. */
  interface Declaration {
    source: string
    value: string
    body: string
  }

  /** Every declared `border-radius` with the rule body it sits in. */
  function declarations(): Declaration[] {
    const found: Declaration[] = []
    for (const file of sourceFiles(ROOT, ['.css'])) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = (match[1] ?? '').trim().replace(/\s+/g, ' ')
        const body = match[2] ?? ''
        if (!/border-radius\s*:/.test(body)) continue
        const value = /border-radius\s*:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? ''
        found.push({ source: file + ' ' + selector, value, body })
      }
    }
    return found
  }

  it('draws every corner from the host scale', () => {
    const allowed = /^(var\(--dsw-radius-(?:xs|sm|md|lg|xl|panel)\)|inherit|0)$/
    const capsules = /^(50%|999px)$/
    const offenders = declarations()
      .filter(declaration => !allowed.test(declaration.value) && !capsules.test(declaration.value))
      .map(declaration => declaration.source + ': ' + declaration.value)
    expect(offenders, 'a hand-written radius outside the scale').toEqual([])
  })

  it('states the curve on every capsule and circle', () => {
    const offenders = declarations()
      .filter(declaration => /^(50%|999px)$/.test(declaration.value))
      .filter(declaration => !/corner-shape\s*:\s*round/.test(declaration.body))
      .map(declaration => declaration.source + ': ' + declaration.value)
    expect(offenders, 'a capsule or circle without its round curve').toEqual([])
  })
})
