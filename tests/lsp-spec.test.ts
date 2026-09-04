import { describe, expect, it } from 'vitest'
import { parseLspServers } from '../src/catalog/lsp-spec.js'

describe('parseLspServers', () => {
  it('parses a valid Claude Code declaration', () => {
    const errors: string[] = []
    const specs = parseLspServers(
      {
        typescript: {
          command: 'typescript-language-server',
          args: ['--stdio'],
          extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' }
        }
      },
      errors
    )
    expect(errors).toEqual([])
    expect(specs['typescript']).toEqual({
      key: 'typescript',
      command: 'typescript-language-server',
      args: ['--stdio'],
      extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' }
    })
  })

  it('normalizes extension case and leading dots', () => {
    const errors: string[] = []
    const specs = parseLspServers({ lua: { command: 'lua-language-server', extensionToLanguage: { '.LUA': 'lua', txt: 'text' } } }, errors)
    expect(errors).toEqual([])
    expect(specs['lua']!.extensionToLanguage).toEqual({ '.lua': 'lua', '.txt': 'text' })
  })

  it('collapses case-variant extensions silently (clangd .c/.C)', () => {
    const errors: string[] = []
    const specs = parseLspServers({ clangd: { command: 'clangd', extensionToLanguage: { '.c': 'c', '.C': 'cpp', '.cpp': 'cpp' } } }, errors)
    expect(errors).toEqual([])
    expect(specs['clangd']!.extensionToLanguage).toEqual({ '.c': 'c', '.cpp': 'cpp' })
  })

  it('drops broken servers fail-closed and reports each cause', () => {
    const errors: string[] = []
    const specs = parseLspServers(
      {
        empty: { command: 'x' },
        noCommand: { extensionToLanguage: { '.py': 'python' } },
        badMap: { command: 'x', extensionToLanguage: 'nope' },
        badExt: { command: 'x', extensionToLanguage: { 'a/b': 'c' } },
        emptyId: { command: 'x', extensionToLanguage: { '.rs': '' } },
        badArgs: { command: 'x', args: [1], extensionToLanguage: { '.go': 'go' } },
        badEnv: { command: 'x', env: { A: 1 }, extensionToLanguage: { '.go': 'go' } },
        good: { command: 'gopls', extensionToLanguage: { '.go': 'go' } }
      },
      errors
    )
    expect(Object.keys(specs)).toEqual(['good'])
    expect(errors.length).toBeGreaterThanOrEqual(7)
    expect(errors.some(error => error.includes('lspServers.noCommand'))).toBe(true)
  })

  it('ignores unknown fields with a diagnostic and Claude Code-only keys silently', () => {
    const errors: string[] = []
    const specs = parseLspServers(
      {
        jdtls: { command: 'jdtls', startupTimeout: 120_000, extensionToLanguage: { '.java': 'java' } },
        odd: { command: 'x', customField: true, extensionToLanguage: { '.c': 'c' } }
      },
      errors
    )
    expect(Object.keys(specs)).toEqual(['jdtls', 'odd'])
    expect(errors).toEqual(['lspServers.odd: ignoring unknown field "customField"'])
  })

  it('accepts env, initializationOptions and configuration passthrough', () => {
    const errors: string[] = []
    const specs = parseLspServers(
      {
        intelephense: {
          command: 'intelephense',
          args: ['--stdio'],
          env: { NODE_ENV: 'production' },
          initializationOptions: { licenceKey: null },
          configuration: { x: 1 },
          extensionToLanguage: { '.php': 'php' }
        }
      },
      errors
    )
    expect(errors).toEqual([])
    expect(specs['intelephense']).toMatchObject({ env: { NODE_ENV: 'production' }, initializationOptions: { licenceKey: null }, configuration: { x: 1 } })
  })

  it('tolerates undefined and rejects non-object tables', () => {
    expect(parseLspServers(undefined, [])).toEqual({})
    const errors: string[] = []
    expect(parseLspServers('x', errors)).toEqual({})
    expect(errors).toEqual(['lspServers: not an object'])
  })
})
