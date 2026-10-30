/**
 * Reading one completed tool call as LSP evidence.
 *
 * The host's lsp tool is the only place a language-server provider's behaviour
 * becomes visible, so this extraction is what turns a failed request into a
 * reason on the status row. Anything that is not a path-carrying lsp call must
 * answer undefined rather than record a guess against some other provider.
 */
import { describe, expect, it } from 'vitest'
import { lspCallOutcome } from '../../../packages/market-runtime/src/runtime/core/lsp-call-observation.js'

describe('lsp call evidence', () => {
  it('reads a successful lsp call as a path and an ok outcome', () => {
    expect(lspCallOutcome({ name: 'lsp', arguments: { file_path: '/work/src/app.ts', line: 3 } }, { isError: false })).toEqual({
      filePath: '/work/src/app.ts',
      ok: true
    })
  })

  it('carries the failure message so the row can say why the provider stopped answering', () => {
    expect(lspCallOutcome({ name: 'lsp', arguments: { file_path: '/work/src/app.ts' } }, { isError: true, error: { message: 'language server exited with code 1' } })).toEqual({
      filePath: '/work/src/app.ts',
      ok: false,
      error: 'language server exited with code 1'
    })
  })

  it('ignores every other tool, and an lsp call that names no file', () => {
    expect(lspCallOutcome({ name: 'read', arguments: { file_path: '/work/src/app.ts' } }, { isError: false })).toBeUndefined()
    expect(lspCallOutcome({ name: 'lsp', arguments: {} }, { isError: false })).toBeUndefined()
    expect(lspCallOutcome({ name: 'lsp', arguments: { file_path: '' } }, { isError: false })).toBeUndefined()
    expect(lspCallOutcome({ name: 'lsp' }, { isError: false })).toBeUndefined()
  })
})
