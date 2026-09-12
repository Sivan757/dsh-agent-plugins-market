import { createHash } from 'node:crypto'

/** Internal IDs stay opaque to callers; only colliding resource names need qualification. */
export function namedAgentRoles<T extends { name: string }>(entries: readonly T[]): Array<T & { callName: string }> {
  const roles = entries.map(entry => {
    let parts: unknown
    try {
      parts = JSON.parse(entry.name)
    } catch {
      /* User-authored role names are plain strings. */
    }
    const identity = Array.isArray(parts) && parts.length === 4 && parts.every(part => typeof part === 'string') ? parts : undefined
    const base = identity ? identity[3].replace(/\.agent$/, '') : entry.name
    return { entry, base, suite: identity?.[1] ?? 'user', source: identity?.[0] ?? 'user', level: 0 }
  })
  const baseCounts = new Map<string, number>()
  for (const role of roles) baseCounts.set(role.base, (baseCounts.get(role.base) ?? 0) + 1)
  for (const role of roles) if ((baseCounts.get(role.base) ?? 0) > 1) role.level = 1
  const candidate = (role: (typeof roles)[number]): string => {
    if (role.level === 0) return role.base
    const parts = [role.base, `${role.suite}/${role.base}`, `${role.source}/${role.suite}/${role.base}`]
    return role.level < 3 ? parts[role.level] : `${parts[2]}~${createHash('sha256').update(role.entry.name).digest('hex')}`
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
