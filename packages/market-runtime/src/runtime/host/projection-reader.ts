/**
 * One session-projection registration owned by this plugin.
 *
 * A projection unit is a pure fold the host drives; this reader owns the part
 * that is not pure — when the unit is registered, which handle is current, and
 * releasing it. Two units (progress and the committed selection) share the same
 * lifecycle, so the awkward parts live here once: the injected fiber re-runs
 * whenever a required service changes, the host hands the handle over
 * asynchronously, and a handle that lands after its effect was cleaned up is
 * released instead of kept.
 *
 * @module runtime/host/projection-reader
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition, ProjectionHandle } from '@deepseek-ai/dsh-session-projection'

/**
 * One registration attempt against the host's registry.
 *
 * The attempt carries the registration and what it produced, because a handle
 * that arrives after the effect that started it was cleaned up must be released.
 */
interface ProjectionAttempt<S> {
  /** The host's registration: it resolves with a ready handle. */
  readonly registration: Promise<ProjectionHandle<S>>
  /** True once the effect that started this attempt was cleaned up. */
  cancelled: boolean
  /** The handle, once the host hands it over. */
  handle: ProjectionHandle<S> | undefined
  /** The release of the handle, once it was released. */
  release: Promise<void> | undefined
}

/**
 * Owns this plugin's registration and answers one session's folded state.
 *
 * The injected callback re-runs whenever a required service changes, so the
 * reader guards it with its own disposal flag and owns the injected fiber: a
 * disposed reader never registers again, and an older effect cleanup never
 * clears a newer registration pointer.
 */
export class SessionProjectionReader<K extends string, S> {
  private attempt: ProjectionAttempt<S> | undefined
  private handle: ProjectionHandle<S> | undefined
  private injection: ReturnType<Context['inject']> | undefined
  private disposed = false

  /**
   * @param ctx - context whose fiber owns the registration.
   * @param definition - the unit to register.
   * @param label - the effect label the host reports for this registration.
   */
  constructor(
    private readonly ctx: Context,
    private readonly definition: ProjectionDefinition<K, S>,
    private readonly label: string
  ) {
    this.injection = this.ctx.inject(['sessionProjections'], scoped => {
      if (this.disposed) return
      scoped.effect(() => {
        if (this.disposed) return () => {}
        // The registry declares two overloads — one for a unit with a client view,
        // one for a host-only unit — and this reader serves both kinds through one
        // path, so the argument is widened once here instead of duplicating the
        // registration for the two shapes. The call stays on the service object:
        // its method needs the registry as the receiver.
        const registry = scoped.sessionProjections as unknown as {
          register(definition: ProjectionDefinition<string, S>): Promise<ProjectionHandle<S>>
        }
        const registration = registry.register(this.definition)
        const attempt: ProjectionAttempt<S> = { registration, cancelled: false, handle: undefined, release: undefined }
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
            // A registration that fails leaves the reader on its fallback.
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
      }, this.label)
    })
  }

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

  /** True while this unit is registered in the live registry. */
  get registered(): boolean {
    return this.handle !== undefined
  }

  /**
   * One session's folded state.
   * @param session - session to answer for.
   * @returns the host's state, or undefined while no handle has landed.
   */
  stateOf(session: Session): S | undefined {
    return this.handle?.stateOf(session)
  }

  /**
   * Unregister the unit and release the injected fiber, so a registry that
   * arrives or cycles later cannot register this reader again.
   * @returns after the unit is released and the injected fiber has unloaded.
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
