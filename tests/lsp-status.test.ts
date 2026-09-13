import { describe, expect, it } from 'vitest'
import { buildLspStatus, type LspMountStatusSource } from '../src/runtime/lsp-status.js'
import type { LspMountDiagnostic } from '../src/runtime/lsp-mounts.js'
import { effectiveSurfaces, type Suite } from '../src/model/types.js'

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
    activeSurfaces: effectiveSurfaces(undefined),
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
    expect(payload.entries[0]).toMatchObject({ id: 'src/ts/typescript', serverKey: 'typescript', command: 'typescript-language-server', state: 'mounted' })
    expect(payload.totals).toEqual({ all: 1, mounted: 1, failed: 0, blocked: 0, disabled: 0 })
    expect(payload.hostMissing).toBe(false)
  })

  it('reports host-missing from the stored diagnostic', () => {
    const payload = buildLspStatus([lspSuite('ts')], registry([{ suiteId: 'src/ts', serverKey: 'ts/typescript', reason: 'not installed', code: 'host-missing' }]))
    expect(payload.entries).toHaveLength(1)
    const [entry] = payload.entries
    if (entry === undefined) throw new Error('expected the stored diagnostic to produce one status row')
    expect(entry.state).toBe('host-missing')
    expect(entry.reason).toBe('not installed')
    expect(payload.hostMissing).toBe(true)
    expect(payload.totals.blocked).toBe(1)
  })

  it('falls back to starting when no mounts and no diagnostics exist (mount pass in flight)', () => {
    const payload = buildLspStatus([lspSuite('ts')], registry([], false))
    expect(payload.entries).toHaveLength(1)
    const [entry] = payload.entries
    if (entry === undefined) throw new Error('expected the in-flight mount pass to produce one status row')
    expect(entry.state).toBe('starting')
    expect(payload.hostMissing).toBe(false)
  })

  it('classifies seam conflicts and retryable mount failures', () => {
    const payload = buildLspStatus(
      [lspSuite('a'), lspSuite('b')],
      registry([
        { suiteId: 'src/a', serverKey: 'a/typescript', reason: 'extension ".ts" is already handled by another LSP provider', code: 'seam-conflict' },
        { suiteId: 'src/b', serverKey: 'b/typescript', reason: 'mount failed: executable not found', code: 'mount-failed' }
      ])
    )
    const [conflict, failed] = payload.entries
    if (conflict === undefined || failed === undefined) throw new Error('expected the two declared servers to produce two status rows')
    expect(conflict.state).toBe('conflict')
    expect(failed.state).toBe('failed')
    expect(failed.retryable).toBe(true)
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
    expect(payload.entries[0]).toMatchObject({ id: 'src/off/typescript', state: 'disabled' })
    expect(payload.totals.disabled).toBe(1)
  })
})
