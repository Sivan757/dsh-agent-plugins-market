/**
 * Persisted suite state: configured sources and per-suite install entries.
 *
 * State is a plain JSON file at `<dimensionRoot>/state.json`. The host is the
 * only writer (through manager actions and the HTTP routes); the manager
 * re-reads the file whenever a mutation races, keeping the on-disk copy
 * authoritative like the market profile state this pattern follows.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { SUITE_SURFACE_KEYS, type InstalledEntry, type SourceRef, type SuiteState, type SurfaceOverrides } from './types.js'

export const EMPTY_STATE: SuiteState = { version: 1, sources: [], installed: {} }

/** Parse persisted state; unreadable or wrong-version files yield a contained empty state. */
export async function loadState(statePath: string): Promise<SuiteState> {
  try {
    const text = await readFile(statePath, 'utf8')
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_STATE
    const record = parsed as Record<string, unknown>
    if (record['version'] !== 1) return EMPTY_STATE
    return normalizeState(record)
  } catch {
    return EMPTY_STATE
  }
}

function normalizeState(record: Record<string, unknown>): SuiteState {
  const sources: SourceRef[] = Array.isArray(record['sources'])
    ? (record['sources'] as unknown[]).flatMap((entry): SourceRef[] => {
        if (typeof entry !== 'object' || entry === null) return []
        const source = entry as Record<string, unknown>
        const id = typeof source['id'] === 'string' ? source['id'] : ''
        const url = typeof source['url'] === 'string' ? source['url'] : ''
        if (id === '' || url === '') return []
        const branch = typeof source['branch'] === 'string' ? source['branch'] : undefined
        const local = source['local'] === true
        const kind = source['kind'] === 'git' || source['kind'] === 'local' || source['kind'] === 'archive' ? source['kind'] : undefined
        const sha256 = typeof source['sha256'] === 'string' && source['sha256'] !== '' ? source['sha256'] : undefined
        const adopted = source['adopted'] === true
        return [
          {
            id,
            url,
            ...(branch === undefined ? {} : { branch }),
            ...(local ? { local: true } : {}),
            ...(kind === undefined ? {} : { kind }),
            ...(sha256 === undefined ? {} : { sha256 }),
            ...(adopted ? { adopted: true } : {})
          }
        ]
      })
    : []
  const installed: Record<string, InstalledEntry> = {}
  if (typeof record['installed'] === 'object' && record['installed'] !== null) {
    for (const [key, value] of Object.entries(record['installed'] as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const entry = value as Record<string, unknown>
      installed[key] = {
        enabled: entry['enabled'] === true,
        lockCommit: typeof entry['lockCommit'] === 'string' ? entry['lockCommit'] : undefined,
        installedAt: typeof entry['installedAt'] === 'string' ? entry['installedAt'] : new Date(0).toISOString(),
        ...parseSurfaceOverrides(entry['surfaces'])
      }
    }
  }
  return { version: 1, sources, installed }
}

/** Parse a persisted `surfaces` override record, keeping only valid boolean keys. */
function parseSurfaceOverrides(raw: unknown): { surfaces?: SurfaceOverrides } {
  if (typeof raw !== 'object' || raw === null) return {}
  const record = raw as Record<string, unknown>
  const overrides: SurfaceOverrides = {}
  let hasAny = false
  for (const key of SUITE_SURFACE_KEYS) {
    const value = record[key]
    if (typeof value === 'boolean') {
      overrides[key] = value
      hasAny = true
    }
  }
  return hasAny ? { surfaces: overrides } : {}
}

/** Persist state atomically through a sibling-temp rename. */
export async function saveState(statePath: string, state: SuiteState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true })
  const temp = `${statePath}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temp, statePath)
}
