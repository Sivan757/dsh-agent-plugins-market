/**
 * The proxy diagnosis: a machine can be online and still fail every intranet service.
 */
import { describe, expect, it } from 'vitest'

import { proxyMismatchFor } from '../../../market-mcp/src/application/mcp/proxy-hint.js'

const PROXY_ENV = { HTTPS_PROXY: 'http://127.0.0.1:7890', NO_PROXY: 'localhost,127.0.0.1,::1' }

describe('proxy mismatch', () => {
  it('names the proxy and the host it cannot reach', () => {
    expect(proxyMismatchFor('https://kuboard.platform.zealwon.com/mcp', { code: 'timeout' }, PROXY_ENV)).toEqual({
      proxy: 'http://127.0.0.1:7890',
      host: 'kuboard.platform.zealwon.com'
    })
  })

  it('reads the timeout out of a generic mount failure', () => {
    // A timeout arrives as mount-failed with the SDK's own sentence underneath, which
    // is the only place the shape survives.
    const failure = {
      code: 'mount-failed',
      reason: 'mount failed: mcp-client(kuboard): initial connection or tool synchronization failed',
      causes: ['MCP error -32001: Request timed out']
    }
    expect(proxyMismatchFor('https://kuboard.platform.zealwon.com/mcp', failure, PROXY_ENV)).toBeDefined()
  })

  it('stays quiet when the host is already bypassed', () => {
    expect(proxyMismatchFor('https://kuboard.platform.zealwon.com/mcp', { code: 'timeout' }, { ...PROXY_ENV, NO_PROXY: 'localhost,.platform.zealwon.com' })).toBeUndefined()
    // The lower-case spelling counts too, on its own (no upper-case NO_PROXY beside it).
    expect(
      proxyMismatchFor('https://git.platform.zealwon.com/api', { code: 'tls' }, { HTTPS_PROXY: 'http://127.0.0.1:7890', no_proxy: 'git.platform.zealwon.com' })
    ).toBeUndefined()
    expect(proxyMismatchFor('https://example.com/mcp', { code: 'timeout' }, { ...PROXY_ENV, NO_PROXY: '*' })).toBeUndefined()
  })

  it('only explains the failures a proxy can explain', () => {
    // A 401 or a bad command line is not the proxy's doing, and saying so would send
    // the reader down the wrong path.
    expect(proxyMismatchFor('https://kuboard.platform.zealwon.com/mcp', { code: 'auth' }, PROXY_ENV)).toBeUndefined()
    expect(proxyMismatchFor('https://kuboard.platform.zealwon.com/mcp', { code: 'command-missing', reason: 'spawn npx ENOENT' }, PROXY_ENV)).toBeUndefined()
    expect(proxyMismatchFor('https://kuboard.platform.zealwon.com/mcp', {}, PROXY_ENV)).toBeUndefined()
  })

  it('needs a proxy, an http endpoint and a parseable url', () => {
    expect(proxyMismatchFor('https://kuboard.platform.zealwon.com/mcp', { code: 'timeout' }, {})).toBeUndefined()
    expect(proxyMismatchFor('node server.js', { code: 'timeout' }, PROXY_ENV)).toBeUndefined()
    expect(proxyMismatchFor(undefined, { code: 'timeout' }, PROXY_ENV)).toBeUndefined()
  })
})
