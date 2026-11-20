/**
 * The session's committed extension selection, folded by the host for the client.
 *
 * The composer chip used to ask a route for this label, which meant a request and
 * a state word: loading while it ran, "not ready" while the session had no Agent.
 * The host's own composer controls never do that — their values ride session
 * projections, seeded by the history snapshot and advanced by projection frames,
 * so the control has its answer before any request is made. This unit gives the
 * preset chip the same answer: the last committed binding in the log.
 *
 * It is display-only. Writes still address the live Agent and go through the
 * window route's compare-and-swap revision; this unit never authorizes anything.
 *
 * @module runtime/host/extension-selection-projection
 */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import { EXTENSION_SELECTION_PROJECTION_KEY } from '../../../../market-contracts/src/contracts/extension-presets.js'
import { EXTENSION_SESSION_SOURCE } from './extension-session-state.js'

/** The projection key this plugin owns, and the key the client seat reads. */
export const EXTENSION_SELECTION_KEY = EXTENSION_SELECTION_PROJECTION_KEY

/** What the chip renders: the committed selection, never a request and never a status. */
export interface ExtensionSelectionView {
  readonly presetId: string | null
  readonly presetName: string | null
  readonly modified: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    marketExtensionSelection: ExtensionSelectionView
  }
  interface SessionProjectionMap {
    marketExtensionSelection: ExtensionSelectionView
  }
}

/** A session that follows no preset, which is what every session starts from. */
const GLOBAL: ExtensionSelectionView = { presetId: null, presetName: null, modified: false }

const selectionViewSchema = z
  .object({
    presetId: z.string().min(1).nullable(),
    presetName: z.string().min(1).max(80).nullable(),
    modified: z.boolean()
  })
  .strict()

/** Whether two views name the same displayed selection; an unchanged one keeps its reference. */
function sameView(left: ExtensionSelectionView, right: ExtensionSelectionView): boolean {
  return left.presetId === right.presetId && left.presetName === right.presetName && left.modified === right.modified
}

/**
 * The host fold this plugin registers.
 *
 * Only a committed binding is effective, so a pending request never moves the
 * chip; the session's own state machine makes the same distinction. A fork folds
 * its inherited prefix, which is how a child shows the parent's selection.
 */
export const extensionSelectionProjection = {
  key: EXTENSION_SELECTION_KEY,
  stateVersion: 1,
  stateSchema: selectionViewSchema,
  init: () => GLOBAL,
  apply: (state, event) => {
    const messages = event.type === 'user/message' ? [event.data] : event.type === 'agent/inbox/spliced' ? event.data.inserted : []
    let next = state
    for (const message of messages) {
      if (message.source.kind !== EXTENSION_SESSION_SOURCE) continue
      const binding = message.source.binding
      if (binding.phase !== 'committed') continue
      const view: ExtensionSelectionView = {
        presetId: binding.selection.presetId,
        presetName: binding.selection.presetName,
        modified: binding.selection.modified
      }
      if (!sameView(next, view)) next = view
    }
    return next
  },
  wire: {
    viewSchema: selectionViewSchema,
    // The state is already the view; returning it keeps the reference the frame
    // comparison needs to suppress publications for unchanged selections.
    view: state => state,
    summary: true
  }
} satisfies ProjectionDefinition<typeof EXTENSION_SELECTION_KEY, ExtensionSelectionView>
