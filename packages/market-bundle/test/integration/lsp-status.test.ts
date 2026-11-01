import { describe, expect, it } from 'vitest'
import { buildLspStatus, type LspMountStatusSource } from '../../../../packages/market-lsp/src/application/lsp/lsp-status.js'
import type { LspMountDiagnostic } from '../../../../packages/market-lsp/src/runtime/lsp/lsp-mounts.js'
import { effectiveSurfaces, type Suite } from '../../../../packages/market-contracts/src/model/types.js'

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
  it('carries the last call routed to a provider onto its row', () => {
    // The seam reports no process death: a mounted provider that stopped
    // answering shows up only through what its last request did.
    const observed: LspMountStatusSource = {
      ...registry([], true),
      observationSnapshot: () => new Map([['src/ts/typescript', { at: 1_700_000_000_000, ok: false, error: 'language server exited with code 1' }]])
    }
    const payload = buildLspStatus([lspSuite('ts')], observed)
    expect(payload.entries[0]?.observation).toMatchObject({ ok: false, error: 'language server exited with code 1' })
    // The row state stays the mount's own judgment; the observation is evidence
    // beside it, not a replacement for it.
    expect(payload.entries[0]?.state).toBe('mounted')
  })

  it("gives each suite its own liveness instead of borrowing a sibling's mount", () => {
    // One suite mounted, the other never came up. The registry-wide flag says
    // "something is live", which used to make both rows read mounted.
    const perSuite: LspMountStatusSource = {
      ...registry([], true),
      liveKeys: () => new Set(['src/ts/typescript'])
    }
    const payload = buildLspStatus([lspSuite('ts'), lspSuite('py')], perSuite)
    expect(payload.entries.map(entry => [entry.suiteId, entry.state])).toEqual([
      ['src/ts', 'mounted'],
      ['src/py', 'starting']
    ])
  })

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
    expect(entry.code).toBe('host-missing')
    expect(payload.hostMissing).toBe(true)
    expect(payload.totals.blocked).toBe(1)
  })

  it('carries the messages under a failure onto its status row', () => {
    const payload = buildLspStatus(
      [lspSuite('ts')],
      registry([
        {
          suiteId: 'src/ts',
          serverKey: 'ts/typescript',
          reason: 'mount failed: initialize failed',
          code: 'mount-failed',
          mountMs: 20_500,
          causes: ['Error: spawn typescript-language-server ENOENT']
        }
      ])
    )
    const [entry] = payload.entries
    if (entry === undefined) throw new Error('expected the stored diagnostic to produce one status row')
    expect(entry.reason).toBe('mount failed: initialize failed')
    expect(entry.causes).toEqual(['Error: spawn typescript-language-server ENOENT'])
    // A start that took twenty seconds says so: "it never comes up" and "it fails at
    // once" are different problems.
    expect(entry.mountMs).toBe(20_500)
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
