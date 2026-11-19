/**
 * Session progress for the extension window: whether a session carries work the
 * user authored.
 *
 * The host folds this answer once per session through its projection registry and
 * then advances it per committed event, so a window read no longer scans the whole
 * event log. The wire meaning is unchanged: a started turn, or a user/inbox
 * message this plugin did not author. A host that publishes no projection registry
 * falls back to the historical log scan instead of answering a constant.
 *
 * @module runtime/host/extension-progress
 */
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import { EXTENSION_SESSION_SOURCE } from './extension-session-state.js'
import { SessionProjectionReader } from './projection-reader.js'

/** The projection key this plugin owns; host-only, so it never reaches a client view. */
export const EXTENSION_PROGRESS_KEY = 'marketExtensionProgress'

/** Folded progress state for one session. */
export interface ExtensionProgressState {
  readonly started: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    marketExtensionProgress: ExtensionProgressState
  }
}

const STARTED: ExtensionProgressState = { started: true }
const BLANK: ExtensionProgressState = { started: false }

/**
 * Whether one committed event is authored progress.
 *
 * This is the definition the wire field has always carried: a started turn, or a
 * user/inbox message whose source is not this plugin's own and carries no form.
 * @param event - one committed session event.
 * @returns true when the event proves the user started work.
 */
export function eventCarriesProgress(event: SessionEvent): boolean {
  if (event.type === 'turn/start') return true
  const messages = event.type === 'user/message' ? [event.data] : event.type === 'agent/inbox/spliced' ? event.data.inserted : []
  return messages.some(message => message.source.kind !== EXTENSION_SESSION_SOURCE && !('form' in message.source))
}

/** The host fold this plugin registers: monotonic, because progress never un-happens. */
export const extensionProgressProjection = {
  key: EXTENSION_PROGRESS_KEY,
  stateVersion: 1,
  stateSchema: z.object({ started: z.boolean() }),
  init: () => BLANK,
  apply: (state, event) => (state.started || !eventCarriesProgress(event) ? state : STARTED)
} satisfies ProjectionDefinition<typeof EXTENSION_PROGRESS_KEY, ExtensionProgressState>

/**
 * Read progress from the log itself.
 *
 * The compatibility fallback for a host without the projection registry. The
 * synchronous full-log reader is deprecated host-side; this call carries the
 * deferred-migration waiver the deprecation decision allows, and disappears when
 * every supported host publishes the registry.
 * @param session - session whose log is scanned.
 * @returns true when the log carries authored progress.
 */
export function scanExtensionProgress(session: Session): boolean {
  return session.snapshotEvents().some(eventCarriesProgress)
}

/**
 * Owns this plugin's progress registration and answers one session's progress.
 *
 * The host fold is the authority once the handle lands; a host that publishes no
 * registry keeps the log scan, so the answer stays correct rather than constant.
 */
export class ExtensionProgressReader {
  private readonly seat: SessionProjectionReader<typeof EXTENSION_PROGRESS_KEY, ExtensionProgressState>
  /**
   * Register the projection for the lifetime of the calling context.
   * @param ctx - context whose fiber owns the registration.
   */
  constructor(ctx: Context) {
    this.seat = new SessionProjectionReader(ctx, extensionProgressProjection, 'dsh-agent-plugins-market: extension progress projection')
  }
  /** Settles once the current registration attempt has run; production reads do not await it. */
  get ready(): PromiseLike<unknown> {
    return this.seat.ready
  }
  /** True while this plugin's projection is registered in the live registry. */
  get registered(): boolean {
    return this.seat.registered
  }
  /**
   * Whether one session carries authored work.
   * @param session - session to answer for.
   * @returns the folded answer, or the log scan while no handle has landed.
   */
  read(session: Session): boolean {
    const state = this.seat.stateOf(session)
    return state ? state.started : scanExtensionProgress(session)
  }
  /**
   * Unregister the projection and release the injected fiber, so a registry that
   * arrives or cycles later cannot register this reader again.
   * @returns after the projection is released and the injected fiber has unloaded.
   */
  dispose(): Promise<void> {
    return this.seat.dispose()
  }
}
