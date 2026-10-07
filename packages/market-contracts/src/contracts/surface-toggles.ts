/** Per-project on/off switches for the six surfaces the plugin mounts. */

/** The six switchable surfaces, in the order the composer control shows them. */
export const SURFACE_TOGGLE_KEYS = ['market', 'skills', 'commands', 'agents', 'mcp', 'lsp'] as const

/** One switchable surface. */
export type SurfaceToggleKey = (typeof SURFACE_TOGGLE_KEYS)[number]

/**
 * The persisted toggle state for one workspace. Every key defaults to on: the
 * file only records a project that turned something off, so the common case —
 * no opinion — costs nothing and an absent file means "all surfaces on".
 */
export interface SurfaceToggles {
  market: boolean
  skills: boolean
  commands: boolean
  agents: boolean
  mcp: boolean
  lsp: boolean
}

/** The all-on default applied when a workspace has no recorded opinion. */
export const ALL_SURFACES_ON: SurfaceToggles = {
  market: true,
  skills: true,
  commands: true,
  agents: true,
  mcp: true,
  lsp: true
}

/**
 * Read one workspace's toggles from an untrusted record.
 *
 * Unknown keys are dropped and wrong-typed values fall back to on, so a
 * hand-edited or future-shaped file degrades to "the known keys apply" the
 * same way the other state files in this plugin do.
 */
export function resolveSurfaceToggles(value: unknown): SurfaceToggles {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const out = { ...ALL_SURFACES_ON }
  for (const key of SURFACE_TOGGLE_KEYS) {
    const raw = record[key]
    if (typeof raw === 'boolean') out[key] = raw
  }
  return out
}
