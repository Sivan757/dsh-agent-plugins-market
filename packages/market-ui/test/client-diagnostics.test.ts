// @vitest-environment jsdom

/**
 * The copyable diagnosis: one block, fixed shape, whatever surface produced it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText, diagnosticsText } from '../../market-ui/src/ui/diagnostics.js'

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('diagnostics block', () => {
  it('prints the surface, the state, the facts in order, the causes and the timestamp', () => {
    const text = diagnosticsText({
      surface: '连接器',
      name: 'kuboard',
      state: '连接失败',
      facts: [
        { label: 'endpoint', value: 'https://kuboard.platform.zealwon.com/mcp' },
        { label: 'transport', value: 'streamable-http' },
        { label: 'tools', value: '0' },
        { label: 'reason', value: '' }
      ],
      causes: ['连接超时：确认服务可达'],
      observedAt: '2026-10-31T17:05:00+08:00'
    })
    expect(text.split('\n')).toEqual([
      'dsh-agent-plugins-market · 连接器 · kuboard',
      'state: 连接失败',
      'endpoint: https://kuboard.platform.zealwon.com/mcp',
      'transport: streamable-http',
      'tools: 0',
      'causes:',
      '  - 连接超时：确认服务可达',
      'observed: 2026-10-31T17:05:00+08:00'
    ])
  })

  it('drops a blank fact and leaves out sections it was not given', () => {
    const text = diagnosticsText({
      surface: 'Language Engine',
      name: 'tsserver',
      state: 'mounted',
      facts: [
        { label: 'reason', value: '' },
        { label: 'command', value: 'typescript-language-server --stdio' }
      ]
    })
    expect(text).toBe(['dsh-agent-plugins-market · Language Engine · tsserver', 'state: mounted', 'command: typescript-language-server --stdio'].join('\n'))
  })

  it('reports a clipboard the browser refused', async () => {
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('NotAllowedError')) }, configurable: true })
    expect(await copyText('x')).toBe(false)
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true })
    expect(await copyText('x')).toBe(true)
  })
})
