/**
 * Rank named candidates by a menu query.
 *
 * The host primitives package exported this shared rule until 0.2.3-alpha.2
 * removed it. The market's skill menu still orders its catalog the same way
 * the host menu did, so the rule lives beside its one caller instead of
 * leaving a host import that no longer resolves.
 *
 * A candidate matches when the query is a case-insensitive ordered subsequence
 * of its name. Prefix hits rank first, then the strongest alignment score,
 * then source order.
 */

/** Bonus weight for a match at the name start or after a separator. */
function boundaryBonus(name: string, index: number): number {
  const previous = index === 0 ? '' : name.charAt(index - 1)
  return index === 0 || previous === '-' || previous === '_' ? 8 : 0
}

/**
 * Score the strongest ordered-subsequence alignment in O(name × query).
 * @param name - lower-cased candidate name.
 * @param query - lower-cased query.
 * @returns the best alignment score, or undefined when the query does not fit.
 */
function alignmentScore(name: string, query: string): number | undefined {
  if (query.length > name.length) return undefined
  const noMatch = Number.NEGATIVE_INFINITY
  let previous = Array<number>(name.length).fill(noMatch)
  for (let index = 0; index < name.length; index++) {
    if (name.charAt(index) === query.charAt(0)) previous[index] = 1 + boundaryBonus(name, index) - index
  }
  for (let queryIndex = 1; queryIndex < query.length; queryIndex++) {
    const current = Array<number>(name.length).fill(noMatch)
    // Sweep the previous row once: 'left' is its score one character back
    // (adjacent continuation), 'leftLeft' two back (the earliest gapped one).
    let left = noMatch
    let leftLeft = noMatch
    let bestGapped = noMatch
    for (const [index, prior] of previous.entries()) {
      if (leftLeft !== noMatch) bestGapped = Math.max(bestGapped, leftLeft + index - 2)
      if (name.charAt(index) === query.charAt(queryIndex)) {
        const bonus = 1 + boundaryBonus(name, index)
        let score = noMatch
        if (left !== noMatch) score = left + bonus + 4
        if (bestGapped !== noMatch) score = Math.max(score, bestGapped + bonus + 1 - index)
        current[index] = score
      }
      leftLeft = left
      left = prior
    }
    previous = current
  }
  let best = noMatch
  for (const score of previous) best = Math.max(best, score)
  return best === noMatch ? undefined : best
}

/** One match with its stable source position. */
interface Ranked<T> {
  readonly item: T
  readonly index: number
  readonly prefix: boolean
  readonly score: number
}

/**
 * Order candidates by a typed query.
 * @param items - candidates in source order.
 * @param rawQuery - the text typed after the trigger, matched case-insensitively.
 * @returns the matching candidates: prefix hits first, then by alignment score,
 * then in source order. The input list itself for an empty query.
 */
export function rankByName<T extends { readonly name: string }>(items: readonly T[], rawQuery: string): readonly T[] {
  const query = rawQuery.toLowerCase()
  if (query === '') return items
  const ranked: Ranked<T>[] = []
  items.forEach((item, index) => {
    const name = item.name.toLowerCase()
    const score = alignmentScore(name, query)
    if (score === undefined) return
    ranked.push({ item, index, prefix: name.startsWith(query), score })
  })
  ranked.sort((left, right) => Number(right.prefix) - Number(left.prefix) || right.score - left.score || left.index - right.index)
  return ranked.map(match => match.item)
}
