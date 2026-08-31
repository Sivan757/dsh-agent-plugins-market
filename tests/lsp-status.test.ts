import { describe, expect, it } from 'vitest'
import { buildLspStatus, type LspMountStatusSource } from '../src/runtime/lsp-status.js'
import type { LspMountDiagnostic } from '../src/runtime/lsp-mounts.js'
import type { Suite } from '../src/model/types.js'

function lspSuite(id: string, overrides: Partial<Suite> = {}): Suite {
  return {
    sourceId: 'src',
    id,
    root: `/tmp/${id}`,
    manifest: { layout: 'claude-code', path: '', id, name: id },
    skills: [],
    lsp: {
      servers: {
        typescript: { key: 'typescript', command: 'typescript-language-server', args: ['--stdio'], extensionToLanguage: { '.ts': 'typescript' } }
      }
    },
    surfaces: { skills: 0, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: 1 },
    dimension: 'user',
    enabled: true,
    installedAt: '2026-08-30T00:00:00.000Z',
    errors: [],
    ...overrides
  }
}

function registry(diagnostics: LspMountDiagnostic[] = [], live = false): LspMountStatusSource {
  return {
    diagnosticsSnapshot: () => new Map(diagnostics.map(diagnostic => [diagnostic.suiteId, diagnostic])),
    hasLiveMounts: () => live
  }
}

describe('buildLspStatus', () => {
  it('marks an enabled declaration as mounted when mounts are live and no diagnostic exists', () => {
    const payload = buildLspStatus([lspSuite('ts')], registry([], true))
    expect(payload.entries).toHaveLength(1)
    expect(payload.entries[0]).toMatchObject({ id: 'ts/typescript', serverKey: 'typescript', command: 'typescript-language-server', state: 'mounted' })
    expect(payload.totals).toEqual({ all: 1, mounted: 1, failed: 0, blocked: 0, disabled: 0 })
    expect(payload.hostMissing).toBe(false)
  })

  it('reports host-missing from the stored diagnostic', () => {
    const payload = buildLspStatus(
      [lspSuite('ts')],
      registry([{ suiteId: 'ts', serverKey: 'ts/typescript', reason: 'not installed', code: 'host-missing' }])
    )
    expect(payload.entries[0]!.state).toBe('host-missing')
    expect(payload.entries[0]!.reason).toBe('not installed')
    expect(payload.hostMissing).toBe(true)
    expect(payload.totals.blocked).toBe(1)
  })

  it('falls back to host-missing when no mounts and no diagnostics exist', () => {
    const payload = buildLspStatus([lspSuite('ts')], registry([], false))
    expect(payload.entries[0]!.state).toBe('host-missing')
    expect(payload.hostMissing).toBe(true)
  })

  it('classifies seam conflicts and retryable mount failures', () => {
    const payload = buildLspStatus(
      [lspSuite('a'), lspSuite('b')],
      registry([
        { suiteId: 'a', serverKey: 'a/typescript', reason: 'extension ".ts" is already handled by another LSP provider', code: 'seam-conflict' },
        { suiteId: 'b', serverKey: 'b/typescript', reason: 'mount failed: executable not found', code: 'mount-failed' }
      ])
    )
    expect(payload.entries[0]!.state).toBe('conflict')
    expect(payload.entries[1]!.state).toBe('failed')
    expect(payload.entries[1]!.retryable).toBe(true)
    expect(payload.totals.blocked).toBe(1)
    expect(payload.totals.failed).toBe(1)
  })

  it('renders disabled rows for lsp-disabled suites and skips uninstalled/disabled suites', () => {
    const payload = buildLspStatus(
      [
        lspSuite('off', { activeSurfaces: { skills: true, mcp: true, hooks: true, commands: true, agents: true, lsp: false } }),
        lspSuite('uninstalled', { installedAt: undefined }),
        lspSuite('disabled', { enabled: false })
      ],
      registry([], true)
    )
    expect(payload.entries).toHaveLength(1)
    expect(payload.entries[0]).toMatchObject({ id: 'off/typescript', state: 'disabled' })
    expect(payload.totals.disabled).toBe(1)
  })
})
