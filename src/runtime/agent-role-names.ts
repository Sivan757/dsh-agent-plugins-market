import { createHash } from 'node:crypto'

/**
 * The `[source, suite, kind, name]` identity the host encodes into a discovery
 * name, or `undefined` for a name that is not one — a user-authored role name
 * is a plain string, and anything else carries no identity.
 */
function roleIdentity(name: string): [string, string, string, string] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(name)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const parts: unknown[] = parsed
  if (parts.length !== 4) return undefined
  const [source, suite, kind, id] = parts
  if (typeof source !== 'string' || typeof suite !== 'string' || typeof kind !== 'string' || typeof id !== 'string') return undefined
  return [source, suite, kind, id]
}

/** Internal IDs stay opaque to callers; only colliding resource names need qualification. */
export function namedAgentRoles<T extends { name: string }>(entries: readonly T[]): Array<T & { callName: string }> {
  const roles = entries.map(entry => {
    const identity = roleIdentity(entry.name)
    const base = identity === undefined ? entry.name : identity[3].replace(/\.agent$/, '')
    return { entry, base, suite: identity?.[1] ?? 'user', source: identity?.[0] ?? 'user', level: 0 }
  })
  const baseCounts = new Map<string, number>()
  for (const role of roles) baseCounts.set(role.base, (baseCounts.get(role.base) ?? 0) + 1)
  for (const role of roles) if ((baseCounts.get(role.base) ?? 0) > 1) role.level = 1
  const candidate = (role: (typeof roles)[number]): string => {
    if (role.level === 0) return role.base
    const qualified = `${role.suite}/${role.base}`
    const fullyQualified = `${role.source}/${role.suite}/${role.base}`
    if (role.level === 1) return qualified
    if (role.level === 2) return fullyQualified
    return `${fullyQualified}~${createHash('sha256').update(role.entry.name).digest('hex')}`
  }
  // Recheck all names: a qualified collision may overlap another role's literal name.
  for (;;) {
    const groups = new Map<string, typeof roles>()
    for (const role of roles) {
      const key = candidate(role)
      groups.set(key, [...(groups.get(key) ?? []), role])
    }
    let changed = false
    for (const group of groups.values()) {
      if (group.length < 2) continue
      for (const role of group) {
        if (role.level < 3) {
          role.level++
          changed = true
        }
      }
    }
    if (!changed) return roles.map(role => ({ ...role.entry, callName: candidate(role) }))
  }
}
