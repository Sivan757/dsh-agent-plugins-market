/**
 * How often one session's extension inventory is re-read after a failed or
 * postponed refresh.
 *
 * The fail-closed window is correct while a catalog read is genuinely pending,
 * but it must close. `ExtensionRuntime` fails closed on a stale inventory, so a
 * refresh that cannot finish denies every managed capability of that session;
 * nothing else comes back for an idle session. This policy is the schedule that
 * does.
 *
 * The retry never stops while the session is dirty, because a retry budget that
 * runs out turns a transient failure into the permanent denial this schedule
 * exists to prevent. It slows instead: the delay doubles from the base, caps at
 * the floor, and the cap is where a session settles until something changes.
 *
 * @module runtime/host/inventory-retry
 */

/**
 * Default delay before the first retry, in milliseconds.
 *
 * A session that was still attaching a moment ago is re-read almost at once,
 * which is what makes the common case invisible.
 */
export const INVENTORY_RETRY_BASE_MS = 200

/**
 * Default ceiling of the retry delay, in milliseconds.
 *
 * This is the steady state of a session whose inventory stays unreadable: one
 * attempt per minute. It is a ceiling rather than a limit, so the schedule never
 * ends and a session that recovers later still heals.
 */
export const INVENTORY_RETRY_MAX_MS = 60_000

/** One resolved retry schedule, frozen so a caller cannot mutate it in flight. */
export interface InventoryRetryPolicy {
  /** Delay before the first retry, in milliseconds. */
  baseMs: number
  /** Ceiling the doubling delay settles at, in milliseconds. */
  maxMs: number
}

/** The schedule a deployment gets when it configures nothing. */
export const DEFAULT_INVENTORY_RETRY: InventoryRetryPolicy = Object.freeze({
  baseMs: INVENTORY_RETRY_BASE_MS,
  maxMs: INVENTORY_RETRY_MAX_MS
})

/**
 * The delay before one attempt, from its zero-based position in the schedule.
 *
 * The doubling is bounded by the ceiling, so the schedule is a fixed number of
 * fast attempts followed by a steady one per ceiling. Exported so a test can
 * state the schedule without waiting for it.
 * @param policy - the resolved schedule.
 * @param attempt - zero-based attempt index.
 * @returns the delay in milliseconds.
 */
export function inventoryRetryDelay(policy: InventoryRetryPolicy, attempt: number): number {
  const exponential = policy.baseMs * 2 ** Math.max(0, attempt)
  return Math.min(Number.isFinite(exponential) ? exponential : policy.maxMs, policy.maxMs)
}

/**
 * Resolve a deployment's retry schedule, the one explicit step from
 * configuration to the values in force.
 *
 * A slow machine or a large catalog changes how long a re-read takes, so both
 * numbers are deployment-varying and belong here rather than in a constant. A
 * typo fails loud at load instead of turning into either a hot loop or a
 * schedule that never runs.
 * @param value - the configured section, or `undefined` for the defaults.
 * @returns the frozen schedule in force.
 */
export function resolveInventoryRetry(value: { baseMs?: number | undefined; maxMs?: number | undefined } | undefined): InventoryRetryPolicy {
  const baseMs = value?.baseMs ?? INVENTORY_RETRY_BASE_MS
  const maxMs = value?.maxMs ?? INVENTORY_RETRY_MAX_MS
  for (const [name, millis] of [
    ['inventoryRetry.baseMs', baseMs],
    ['inventoryRetry.maxMs', maxMs]
  ] as const) {
    if (!Number.isFinite(millis) || millis <= 0) throw new Error(`${name} must be a positive finite number of milliseconds; received ${String(millis)}`)
  }
  if (baseMs > maxMs) throw new Error(`inventoryRetry.baseMs must not exceed inventoryRetry.maxMs; received ${String(baseMs)} and ${String(maxMs)}`)
  return Object.freeze({ baseMs, maxMs })
}
