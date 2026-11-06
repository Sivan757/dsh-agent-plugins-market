// @vitest-environment jsdom

/**
 * One dialog footer's action row is one size.
 *
 * The host Button has two sizes: md (36px tall, 14px type) and sm (28px tall,
 * 12px type). A footer that mixes them draws a 28px control beside a 36px one,
 * so the row does not line up. The defect the owner reported was on the
 * instruction file's dialog, whose footer held 删除 | 编辑 | 完成: the two
 * action buttons were sm and the closing one was the host's default md.
 *
 * The house size is md. It is the host's default, it is what every other
 * footer in the plugin already uses, and a footer's row is a row of peer
 * controls, not a toolbar of mixed weights.
 *
 * The test pins both halves: the row a reader sees, and the source rule that
 * keeps a footer from choosing a size of its own.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { InstructionDetail } from '../../../packages/market-ui/src/features/instructions/InstructionDetail.js'
import { LspDetailModal } from '../../../packages/market-ui/src/features/lsp/LspStatusPanel.js'
import type { InstructionRow } from '../../../packages/market-contracts/src/contracts/instructions.js'
import type { LspStatusEntry } from '../../../packages/market-contracts/src/contracts/lsp-status.js'
import type { Translate } from '../../../packages/market-ui/src/index.js'

const t: Translate = key => String(key)

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

/**
 * The host's size class on one button: 'md' (36px) or 'sm' (28px).
 *
 * @param button - a rendered host button.
 * @returns the size class, or undefined when the button states none.
 */
function sizeOf(button: HTMLElement): string | undefined {
  // The host's size class is a CSS-module name: `_md_<hash>` or `_sm_<hash>`.
  const found = [...button.classList].find(name => /^_(md|sm)_/.test(name))
  return found?.slice(1).split('_')[0]
}

/**
 * The buttons of one dialog's footer row.
 *
 * The host Modal renders the header, the body and a footer slot; the slot is
 * the dialog's own child, so the header's close button is never in it.
 *
 * @param dialog - the dialog element.
 * @returns the footer's buttons, in order.
 */
function footerButtons(dialog: HTMLElement): HTMLButtonElement[] {
  // The host Modal renders the body and then the footer slot, so the footer's
  // buttons live in the dialog's last child. The header's close button is in
  // the body, and never in the row.
  const slot = dialog.lastElementChild
  expect(slot, 'the dialog has a footer slot').not.toBeNull()
  return [...slot!.querySelectorAll('button')]
}

/**
 * Render one dialog and return its footer buttons.
 *
 * @param node - the dialog to render.
 * @returns the buttons of its footer row.
 */
async function renderFooter(node: React.ReactNode): Promise<HTMLButtonElement[]> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(node)
  })
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  expect(dialog, 'the dialog rendered').not.toBeNull()
  return footerButtons(dialog!)
}

describe('a dialog footer row is one size', () => {
  it('draws the instruction file dialog’s three buttons on one line', async () => {
    const row: InstructionRow = {
      scope: 'user-global',
      directory: '.',
      candidate: 'AGENTS.md',
      displayPath: '$DSH_HOME/AGENTS.md',
      path: '/home/u/.dsh/AGENTS.md',
      exists: true,
      size: 20,
      status: 'loaded',
      content: '# Global\n'
    }
    const buttons = await renderFooter(h(InstructionDetail, { t, row, budget: 65536, onClose: () => {}, onEdit: () => {}, onDelete: () => {} }))
    // 删除 | 编辑 | 完成 — the row the owner photographed.
    expect(buttons).toHaveLength(3)
    const sizes = buttons.map(sizeOf)
    expect(sizes).toEqual(['md', 'md', 'md'])
    // One size, and it is the house size: the host's default, 36px tall.
    expect(new Set(sizes).size).toBe(1)
    expect(sizes[0]).toBe('md')
  })

  it('draws the language server dialog’s two buttons on one line', async () => {
    const entry: LspStatusEntry = {
      id: 'src/ts/typescript',
      serverKey: 'typescript',
      suiteId: 'src/ts',
      suiteName: 'TS Suite',
      sourceId: 'src',
      kind: 'plugin',
      command: 'typescript-language-server',
      args: ['--stdio'],
      extensions: { '.ts': 'typescript' },
      state: 'mounted'
    }
    const buttons = await renderFooter(h(LspDetailModal, { entry, t, onClose: () => {} }))
    // 复制诊断 | 完成
    expect(buttons).toHaveLength(2)
    const sizes = buttons.map(sizeOf)
    expect(sizes).toEqual(['md', 'md'])
  })
})

/**
 * Every source file under a directory.
 *
 * @param directory - the directory to walk.
 * @returns the .tsx file paths, relative to it.
 */
function sourceFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(path))
    else if (entry.name.endsWith('.tsx')) found.push(path)
  }
  return found
}

/**
 * The text from an opening bracket to its matching close.
 *
 * @param source - the file's text.
 * @param open - the index of the opening bracket.
 * @returns the bracketed text, or an empty string when it never closes.
 */
function balanced(source: string, open: number): string {
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    const character = source[index]
    if (character === '(' || character === '{' || character === '[') depth += 1
    else if (character === ')' || character === '}' || character === ']') {
      depth -= 1
      if (depth === 0) return source.slice(open, index + 1)
    }
  }
  return ''
}

/**
 * The text of every footer expression in one file.
 *
 * A footer is either a `footer:` prop or a `footer={` prop, and the suite
 * detail builds its row in a helper named `footer`. Each one is read to its
 * matching close, so a size prop anywhere inside it is found.
 *
 * @param source - the file's text.
 * @returns the footer expressions.
 */
function footerExpressions(source: string): string[] {
  const expressions: string[] = []
  for (const match of source.matchAll(/\bfooter\s*[:=]\s*[A-Za-z0-9_.$]*\s*(\{|\()/g)) {
    const bracket = match[1]
    if (bracket === undefined) continue
    const open = source.indexOf(bracket, match.index)
    if (open < 0) continue
    expressions.push(source.slice(match.index, open) + balanced(source, open))
  }
  // A helper that builds the row: the body is what holds the buttons.
  for (const match of source.matchAll(/function\s+footer\s*\(/g)) {
    const open = source.indexOf('(', match.index)
    const body = source.indexOf('{', open + balanced(source, open).length)
    if (open < 0 || body < 0) continue
    expressions.push(source.slice(match.index, body) + balanced(source, body))
  }
  return expressions
}

describe('no footer chooses a button size of its own', () => {
  it('leaves every footer button on the house size', () => {
    const root = 'packages/market-ui/src'
    const offenders: string[] = []
    for (const file of sourceFiles(root)) {
      for (const expression of footerExpressions(readFileSync(file, 'utf8'))) {
        // A size prop inside a footer row is the defect: the row must be one
        // size, and the house size is the host's default, which no footer has
        // to state.
        if (/\bsize\s*[:=]\s*['"]?(sm|md|['"])/.test(expression)) offenders.push(file)
      }
    }
    expect(offenders, 'a footer button states a size of its own').toEqual([])
  })
})
