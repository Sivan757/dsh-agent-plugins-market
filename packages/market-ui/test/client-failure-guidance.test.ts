// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { FAILURE_GUIDANCE_LABEL, failureCause, failureGuidanceKey } from '../../../packages/market-ui/src/ui/failure-guidance.js'
import { en, zh } from '../../../packages/market-ui/src/locales.js'

describe('failure guidance', () => {
  it('gives a row the cause alone, and keeps the advice for the detail', () => {
    // The card has one line: which row needs attention, not what to do about it.
    expect(failureCause(zh.failureGuideTimeout)).toBe('连接超时')
    expect(failureCause(en.failureGuideTimeout)).toBe('Connection timed out')
    // A sentence with no separator is kept whole rather than guessed at.
    expect(failureCause('mount failed')).toBe('mount failed')
    expect(failureCause('：无原因')).toBe('：无原因')
  })

  it('reads a recorded code before the wording', () => {
    expect(failureGuidanceKey({ code: 'missing-credential', reason: 'API_TOKEN is not set' })).toBe('credentials')
    expect(failureGuidanceKey({ code: 'credential-error', reason: 'credential lookup failed' })).toBe('credentials')
    expect(failureGuidanceKey({ code: 'unsupported-transport', reason: 'anything' })).toBe('transport')
    expect(failureGuidanceKey({ code: 'host-missing', reason: 'anything' })).toBe('missingPackage')
    expect(failureGuidanceKey({ code: 'seam-conflict', reason: 'anything' })).toBe('seamConflict')
    expect(failureGuidanceKey({ code: 'unmount-failed', reason: 'anything' })).toBe('unmount')
    expect(failureGuidanceKey({ code: 'foreign-mount', reason: 'anything' })).toBe('foreignMount')
    expect(failureGuidanceKey({ code: 'duplicate-mount', reason: 'anything' })).toBe('duplicateMount')
    expect(failureGuidanceKey({ code: 'orphaned-tools', reason: 'anything' })).toBe('orphanedTools')
    expect(failureGuidanceKey({ code: 'disabled-override', reason: 'anything' })).toBe('disabledOverride')
    // A service a session preset keeps mounted is switched off yet still live,
    // and the code is what localizes the sentence the band shows.
    expect(failureGuidanceKey({ code: 'preset-demand', reason: 'anything' })).toBe('presetDemand')
    expect(failureGuidanceKey({ code: 'modified-override', reason: 'anything' })).toBe('modifiedOverride')
  })

  it('has a bilingual sentence for every classified code', () => {
    // A classification with no dictionary entry would render a bare key — or,
    // worse, the raw English reason — in a Chinese panel.
    const sentence = FAILURE_GUIDANCE_LABEL.presetDemand
    expect(sentence).toBe('failureGuidePresetDemand')
    expect(zh[sentence]).toContain('当前会话的预设')
    expect(en[sentence]).toContain('active session preset')
    expect(zh[sentence]).not.toBe(en[sentence])
  })

  it('classifies a wrapper sentence by the messages under it', () => {
    const wrapper = 'mount failed: mcp-client(service): initial connection or tool synchronization failed'
    expect(failureGuidanceKey({ code: 'mount-failed', reason: wrapper, causes: ['spawn npx ENOENT'] })).toBe('commandMissing')
    expect(failureGuidanceKey({ code: 'mount-failed', reason: wrapper, causes: ['connect ECONNREFUSED 127.0.0.1:8000'] })).toBe('refused')
    expect(failureGuidanceKey({ code: 'mount-failed', reason: wrapper, causes: ['McpError: request timed out'] })).toBe('timeout')
  })

  it('classifies the shapes the reasons name outright', () => {
    expect(failureGuidanceKey({ code: 'mount-failed', reason: 'connect ECONNREFUSED 127.0.0.1:8000' })).toBe('refused')
    expect(failureGuidanceKey({ reason: 'request timed out after 60000ms' })).toBe('timeout')
    expect(failureGuidanceKey({ code: 'mount-failed', reason: 'getaddrinfo ENOTFOUND mcp.example.test' })).toBe('dns')
    expect(failureGuidanceKey({ code: 'mount-failed', reason: 'self-signed certificate in certificate chain' })).toBe('tls')
    expect(failureGuidanceKey({ code: 'mount-failed', reason: 'child process exited with code 1' })).toBe('processExit')
    expect(failureGuidanceKey({ code: 'mount-failed', reason: 'initialize handshake failed' })).toBe('protocol')
    expect(failureGuidanceKey({ code: 'mount-failed', reason: 'native MCP tool filters and startup timeouts require the built-in backend' })).toBe('backend')
    expect(
      failureGuidanceKey({
        code: 'mount-failed',
        reason: 'the @deepseek-ai/dsh-mcp-client package is not installed in this profile — switch the MCP backend back to the built-in client'
      })
    ).toBe('backendMissing')
    expect(failureGuidanceKey({ code: 'mount-failed', reason: 'the host context does not support dynamic plugin mounting' })).toBe('hostUnsupported')
  })

  it('falls back to the one sentence every mount failure earns', () => {
    expect(failureGuidanceKey({ code: 'mount-failed', reason: 'mount failed: mcp-client(service): initial connection or tool synchronization failed' })).toBe('startup')
  })

  it('leaves a reason it cannot place to the raw text', () => {
    expect(failureGuidanceKey({ reason: 'modified by override' })).toBeUndefined()
    expect(failureGuidanceKey({ reason: 'everything is fine' })).toBeUndefined()
  })
})
