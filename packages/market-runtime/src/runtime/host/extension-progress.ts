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
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import { EXTENSION_SESSION_SOURCE } from './extension-session-state.js'

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
 * One registration attempt against the host's projection registry.
 *
 * The host hands the handle over asynchronously, so the attempt carries the
 * registration and what it produced. A handle that lands after the effect that
 * started it was cleaned up is released instead of kept.
 */
interface ProjectionAttempt {
  /** The host's registration: it resolves with a ready handle. */
  readonly registration: Promise<ProjectionHandle<ExtensionProgressState>>
  /** True once the effect that started this attempt was cleaned up. */
  cancelled: boolean
  /** The handle, once the host hands it over. */
  handle: ProjectionHandle<ExtensionProgressState> | undefined
  /** The release of the handle, once it was released. */
  release: Promise<void> | undefined
}

/**
 * Owns this plugin's projection registration and answers one session's progress.
 *
 * The injected callback re-runs whenever a required service changes, so the
 * reader guards it with its own disposal flag and owns the injected fiber: a
 * disposed reader never registers again, and an older effect cleanup never
 * clears a newer registration pointer.
 *
 * The host registers asynchronously: the handle arrives after the effect that
 * started it, so the attempt tracks the handle it waits for. A handle that
 * lands after its effect was cleaned up is released rather than kept, and it
 * never passes for a newer registration.
 */
export class ExtensionProgressReader {
  private attempt: ProjectionAttempt | undefined
  private handle: ProjectionHandle<ExtensionProgressState> | undefined
  private injection: ReturnType<Context['inject']> | undefined
  private disposed = false

  /**
   * Settles once the current registration attempt has run; production reads do not await it.
   * @returns the current attempt's settlement, or the injection's when no attempt has started.
   */
  get ready(): PromiseLike<unknown> {
    const attempt = this.attempt
    if (!attempt) return Promise.resolve(this.injection)
    return attempt.registration.then(
      () => undefined,
      () => undefined
    )
  }

  /**
   * Register the projection for the lifetime of the calling context.
   * @param ctx - context whose fiber owns the registration.
   */
  constructor(private readonly ctx: Context) {
    this.injection = this.ctx.inject(['sessionProjections'], scoped => {
      if (this.disposed) return
      scoped.effect(() => {
        if (this.disposed) return () => {}
        const registration = scoped.sessionProjections.register(extensionProgressProjection)
        const attempt: ProjectionAttempt = { registration, cancelled: false, handle: undefined, release: undefined }
        this.attempt = attempt
        void registration.then(
          handle => {
            attempt.handle = handle
            if (this.disposed || attempt.cancelled || this.attempt !== attempt) {
              // The attempt was given up before its handle arrived: release the
              // handle instead of keeping a registration nobody owns.
              attempt.handle = undefined
              void handle.dispose()
              return
            }
            this.handle = handle
          },
          () => {
            // A registration that fails leaves the reader on its log-scan fallback.
          }
        )
        return () => {
          // Identity guard: a cleanup for an older registration must not clear a newer one.
          attempt.cancelled = true
          if (this.attempt === attempt) this.attempt = undefined
          const handle = attempt.handle
          attempt.handle = undefined
          if (handle) {
            if (this.handle === handle) this.handle = undefined
            attempt.release = handle.dispose()
          }
        }
      }, 'dsh-agent-plugins-market: extension progress projection')
    })
  }

  /** True while this plugin's projection is registered in the live registry. */
  get registered(): boolean {
    return this.handle !== undefined
  }

  /**
   * Whether one session carries authored progress.
   * @param session - session to answer for.
   * @returns the folded answer, or the log scan while no handle has landed.
   */
  read(session: Session): boolean {
    const state = this.handle?.stateOf(session)
    return state ? state.started : scanExtensionProgress(session)
  }

  /**
   * Unregister the projection and release the injected fiber, so a registry that
   * arrives or cycles later cannot register this reader again.
   * @returns after the projection is released and the injected fiber has unloaded.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    const attempt = this.attempt
    this.attempt = undefined
    if (attempt) {
      attempt.cancelled = true
      const handle = attempt.handle
      attempt.handle = undefined
      if (handle) {
        if (this.handle === handle) this.handle = undefined
        attempt.release = handle.dispose()
      }
    }
    this.handle = undefined
    const injection = this.injection
    this.injection = undefined
    await injection?.dispose()
    await attempt?.release
  }
}
