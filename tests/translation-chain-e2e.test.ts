/**
 * Lead's end-to-end probe: the real chain, real masking, real HTTP shapes,
 * with fetch stubbed at the boundary. Proves the fallback order the design
 * promises rather than trusting each unit in isolation.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { runChain, resetCircuitBreaker } from '../packages/market-translation/src/application/translation/chain.js'
import { createTranslationProviders } from '../packages/market-translation/src/runtime/host/translation-providers.js'

afterEach(() => {
  resetCircuitBreaker()
  vi.unstubAllGlobals()
})

const ctx = { get: () => undefined }

describe('the real chain end to end', () => {
  it('uses microsoft when google is unreachable', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url))
      if (String(url).includes('googleapis')) throw new Error('blocked network')
      return new Response(JSON.stringify([{ translations: [{ text: '从磁盘读取文件' }] }]), { status: 200 })
    })
    const providers = createTranslationProviders({ host: ctx })
    const result = await runChain(providers, ['Read files from disk'], 'zh')
    expect(result.provider).toBe('microsoft')
    expect(result.texts).toEqual(['从磁盘读取文件'])
    expect(calls.some(u => u.includes('googleapis'))).toBe(true)
    expect(calls.some(u => u.includes('microsoft'))).toBe(true)
  })

  it('preserves a masked placeholder through the whole pipeline', async () => {
    let sent = ''
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent = typeof init.body === 'string' ? init.body : ''
      return new Response(JSON.stringify([{ translations: [{ text: '管理在⟦T1⟧中声明的服务' }] }]), { status: 200 })
    })
    const providers = createTranslationProviders({ host: ctx })
    const result = await runChain(providers, ['Manage servers declared in <config>'], 'zh')
    // The angle-bracket fragment never reaches the engine as raw markup.
    expect(sent).not.toContain('<config>')
    expect(sent).toContain('⟦T1⟧')
    // ...and it is restored in the answer.
    expect(result.texts[0]).toContain('<config>')
  })

  it('reports failure when every provider is down, without throwing into a caller', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    const providers = createTranslationProviders({ host: ctx })
    await expect(runChain(providers, ['Read files'], 'zh')).rejects.toThrow(/exhausted/)
  })

  it('orders the chain google, microsoft, then the model', async () => {
    const seen: string[] = []
    const providers = createTranslationProviders({
      host: ctx,
      llm: {
        id: 'llm',
        available: () => true,
        translate: async ({ texts }) => {
          seen.push('llm')
          return texts.map(t => 'LLM:' + t)
        }
      }
    })
    expect(providers.map(p => p.id)).toEqual(['google', 'microsoft', 'llm'])
    vi.stubGlobal('fetch', async () => {
      throw new Error('both endpoints down')
    })
    const result = await runChain(providers, ['Read files'], 'zh')
    expect(result.provider).toBe('llm')
    expect(seen).toEqual(['llm'])
  })
})
