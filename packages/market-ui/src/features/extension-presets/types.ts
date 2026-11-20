export type { ExtensionTranslate } from '../../i18n.js'

/**
 * The committed selection as the host's session projection carries it.
 *
 * The composer seat's standard kit hands the entry a projection reader, and this
 * is the value the extension selection unit publishes under its key: what the chip
 * shows, never a request result and never a status.
 */
export interface ExtensionSelectionFace {
  presetId: string | null
  presetName: string | null
  modified: boolean
}

/**
 * Read one host-computed session projection value by key.
 *
 * Delivered by the session seat kit; absent outside a session-scoped seat, which is
 * why every caller treats a missing reader as capability absent.
 */
export type UseSessionProjection = (key: string) => unknown
