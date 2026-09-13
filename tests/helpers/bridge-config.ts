import { expect } from 'vitest'
import type { Config } from '../../src/runtime/mcp-client/config.js'

/**
 * Assert a mount's transport and narrow its config to that variant.
 *
 * The discriminant check is the assertion the mount cases used to make by
 * reading `config['transport']` off a cast-to-record value; keeping it in one
 * narrowing helper preserves that check while typing every field read that
 * follows, so a renamed or dropped bridge field fails the typecheck instead of
 * silently reading `undefined`.
 */
export function expectTransport<T extends Config['transport']>(config: Config, transport: T): asserts config is Extract<Config, { transport: T }> {
  expect(config.transport).toBe(transport)
}
