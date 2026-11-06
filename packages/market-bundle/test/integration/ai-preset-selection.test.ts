/**
 * What a preset suggestion stores, and what the runtime later grants.
 *
 * The suggestion path and the manager's switches name the same rows, so they have to end
 * up with the same selection: a row under a suite carries the suite that owns it, and a
 * suite carries the rows under it. That closure is what the manager reads back as selected
 * and what the runtime grants; a selection without it is stored, and grants nothing.
 *
 * The bound on the rows one suggestion may be offered is the other half of the question:
 * it decides which rows the model ever sees.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AI_DRAFT_ROUTES, AI_PRESET_LIMITS } from '../../../../packages/market-contracts/src/contracts/ai-draft.js'
import type { AiPort } from '../../../../packages/market-bundle/src/application/ai-port.js'
import { createAiPresetService } from '../../../../packages/market-bundle/src/application/ai-preset.js'
import { createAiDiagnoseService } from '../../../../packages/market-bundle/src/application/ai-diagnose.js'
import { mountAiDraftRoutes } from '../../../../packages/market-bundle/src/routes-ai.js'
import { ExtensionPresetStore } from '../../../../packages/market-runtime/src/application/state/extension-presets.js'
import { extensionResourceEnabled } from '../../../../packages/market-runtime/src/application/extension-authorization.js'
import { captureExtensionSelection, type ExtensionResource } from '../../../../packages/market-contracts/src/contracts/extension-presets.js'
import { canonicalPresetSelection } from '../../../../packages/market-ui/src/features/extension-presets/resource.js'
import { removeTempRoot } from './helpers/temp-root.js'

const suite: ExtensionResource = {
  id: 'market:src/one',
  face: 'market',
  name: 'One',
  source: 'src',
  available: true,
  detail: { kind: 'suite', sourceId: 'src', suiteId: 'one' }
}
const child: ExtensionResource = {
  id: 'skills:src/one/review',
  face: 'skills',
  name: 'Review',
  source: 'src',
  available: true,
  suiteResourceId: suite.id,
  detail: { kind: 'panel', panel: 'skills', entryId: 'src/one/review' }
}
const rows = [suite, child]

describe('what a preset suggestion stores', () => {
  it('keeps the closure the manager reads back, and grants what it named', async () => {
    // What the suggestion path produces for a row under a suite.
    const ids = canonicalPresetSelection(rows, [], [{ id: child.id, enabled: true }])
    const root = await mkdtemp(join(tmpdir(), 'ai-preset-selection-'))
    try {
      const store = new ExtensionPresetStore(root)
      const library = await store.create('/project', 0, { name: 'Suggested', enabledIds: ids })
      const preset = library.presets[0]!
      expect(preset.enabledIds).toEqual(expect.arrayContaining([child.id, suite.id]))

      // The runtime reads the stored ids as the session's selection, and grants the row the
      // suggestion named.
      const selection = captureExtensionSelection(preset, [])
      expect(extensionResourceEnabled(child, selection, rows)).toBe(true)
      expect(extensionResourceEnabled(suite, selection, rows)).toBe(true)
    } finally {
      await removeTempRoot(root)
    }
  })

  it('grants nothing for a selection that names a row without its suite', () => {
    // The shape the suggestion path used to store: the row is there, and the runtime
    // refuses it because the suite that owns it is not selected.
    const raw = captureExtensionSelection({ id: 'preset', name: 'Suggested', revision: 1, enabledIds: [child.id] }, [])
    expect(extensionResourceEnabled(child, raw, rows)).toBe(false)
  })
})

describe('the rows one suggestion is offered', () => {
  const logger = { warn: (): void => {}, info: (): void => {}, error: (): void => {} }

  it('shows the model a bounded list, so the rows beyond the bound are never seen', async () => {
    const calls: Array<{ system: string; user: string }> = []
    const port: AiPort = {
      complete: async prompt => {
        calls.push(prompt)
        return { text: '{"name":"x","picks":["market:src/0"]}', provider: 'deepseek', model: 'fixture' }
      }
    }
    const routes = new Map<string, (req: unknown, res: unknown) => void | Promise<void>>()
    mountAiDraftRoutes(
      {
        get: (name: string) =>
          name === 'webServer'
            ? {
                register(entry: { path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void {
                  routes.set(entry.path, entry.handler)
                  return () => routes.delete(entry.path)
                }
              }
            : undefined
      },
      {
        presets: createAiPresetService(port),
        diagnose: createAiDiagnoseService(port),
        catalogue: { overview: async () => ({ suites: [] }) },
        logger
      }
    )
    const candidates = Array.from({ length: AI_PRESET_LIMITS.candidates + 100 }, (_value, index) => ({ id: 'market:src/' + index, label: 'suite ' + index }))
    const body = JSON.stringify({ intent: 'frontend work', candidates, locale: 'en' })
    let status = 0
    let payload = ''
    const response = { writeHead: (code: number) => (status = code), end: (text: string) => (payload = text) }
    const request = {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:56780', host: '127.0.0.1:56780' },
      on(event: string, listener: (value?: unknown) => void) {
        if (event === 'data') setTimeout(() => listener(Buffer.from(body)), 0)
        if (event === 'end') setTimeout(() => listener(), 5)
        return request
      }
    }
    await routes.get(AI_DRAFT_ROUTES.suggestPreset)?.(request, response)
    expect(status).toBe(200)
    expect((JSON.parse(payload) as { ok: boolean }).ok).toBe(true)
    // The bound is the contract's, and the client orders its rows so that the ones that
    // carry a selection are the ones inside it.
    expect(calls[0]!.user.split('\n').filter(line => line.startsWith('market:src/')).length).toBe(AI_PRESET_LIMITS.candidates)
  })
})
