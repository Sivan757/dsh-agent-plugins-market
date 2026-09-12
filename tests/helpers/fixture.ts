/**
 * A value a test requires to be present.
 *
 * Tests read fixtures by index and by key, and `noUncheckedIndexedAccess` types
 * those reads `T | undefined`. Guarding here instead of asserting with `!` means
 * a wrong fixture fails saying what the test expected, rather than reading
 * `undefined` and surfacing as a `TypeError` somewhere further down the test.
 *
 * @param value - the read value, absent when the fixture is not what the test assumes.
 * @param expected - what the test wanted, in the words it would use to explain itself.
 */
export function required<T>(value: T | undefined, expected: string): T {
  if (value === undefined) throw new Error(`expected ${expected}`)
  return value
}
