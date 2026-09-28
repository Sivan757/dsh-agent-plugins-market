/**
 * Tolerant reads of optional services off a cordis context.
 * @module runtime/core/context
 */

/**
 * Read one optional service off a cordis context, tolerating every access
 * style the host shows.
 *
 * Cordis strict mode throws instead of returning `undefined` for an
 * unregistered service, and contexts vary in which access style they expose —
 * some the bare property, some only a `get()` accessor — so each read is
 * guarded and absence always comes back as `undefined`, never a throw.
 */
export function optionalService(ctx: unknown, name: string): unknown {
  try {
    const direct = (ctx as Record<string, unknown> | undefined)?.[name]
    if (direct !== undefined && direct !== null) return direct
  } catch {
    // Strict mode throws on the property read too; fall through to `get()`.
  }
  try {
    const get = (ctx as { get?: (name: string) => unknown } | undefined)?.get
    const service = typeof get === 'function' ? get.call(ctx, name) : undefined
    return service === null ? undefined : service
  } catch {
    return undefined
  }
}
