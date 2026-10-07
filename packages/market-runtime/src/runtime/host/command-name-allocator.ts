/**
 * Unique call names for the commands this plugin registers.
 *
 * The host's command registry keys one name to one definition per layer:
 * `NamedEntries.insert` throws `command "x" is already registered` when the
 * name is taken, and the layer a registration lands in is chosen by the
 * registry service's own context, never by the caller's. Two suites flattening
 * to one call name, a host built-in such as `compact`, or a second mount
 * registry feeding the same layer therefore collide — and a colliding
 * definition is the one thing the slash menu drops, so the name has to be
 * chosen before `register` is called. The layer's existing names cannot be
 * enumerated from here, which leaves the refused registration as the only
 * observable of a foreign occupant; {@link registerWithAllocatedName} retries
 * with the next suffix.
 *
 * Allocation answers the preferred name while it is free and appends an
 * increasing numeric suffix afterwards: the first conflict is `compact-1`,
 * then `compact-2`. A name the host refused stays held as occupied, so the
 * retry asks for the following suffix instead of repeating the name that just
 * failed.
 *
 * @module runtime/command-name-allocator
 */

/** Suffixes one preferred name may spend before allocation gives up on it. */
export const MAX_COMMAND_NAME_ATTEMPTS = 50

/** The host's duplicate-registration failure, as `CommandRuntime.register` renders it. */
const DUPLICATE_COMMAND_NAME = /^command "[^"]+" is already registered/

/**
 * Whether the host refused a registration because that exact name is taken.
 *
 * `CommandRuntime.register` renders one sentence for the global layer
 * (`command "x" is already registered (for a per-agent variant, ...)`) and a
 * shorter one for a scoped layer (`... in this scope`); both open with the
 * same clause, and an error carrying any other text is a real failure rather
 * than a name collision.
 * @param error - the value thrown by `register`.
 * @returns whether re-claiming under another name can succeed.
 */
export function isDuplicateCommandName(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return DUPLICATE_COMMAND_NAME.test(message)
}

/** Naming policy over one layer's occupancy. */
export interface CommandNameAllocator {
  /**
   * Claim a unique call name: `preferred` when free, otherwise the first free
   * `preferred-1`, `preferred-2`, ... suffix.
   * @param preferred - the name the command uses undisturbed.
   * @returns the name to register under.
   * @throws when every suffix within {@link MAX_COMMAND_NAME_ATTEMPTS} is taken.
   */
  claim(preferred: string): string
  /**
   * Release a previously claimed name so it can be reused. Releasing a name
   * that was never claimed, or already released, is a no-op.
   * @param name - the name returned by an earlier {@link CommandNameAllocator.claim}.
   */
  release(name: string): void
}

/**
 * Build a naming policy over `taken`.
 *
 * The allocator owns the names it hands out, which is what makes
 * {@link CommandNameAllocator.release} meaningful; `taken` adds the names
 * occupied outside it (another surface's registrations in the same layer, and
 * the names the host has already refused).
 * @param taken - every name currently unavailable to this allocator.
 * @returns the allocator.
 */
export function createCommandNameAllocator(taken: () => ReadonlySet<string>): CommandNameAllocator {
  const claimed = new Set<string>()
  return {
    claim(preferred: string): string {
      const busy = new Set<string>(taken())
      for (const name of claimed) busy.add(name)
      if (!busy.has(preferred)) {
        claimed.add(preferred)
        return preferred
      }
      for (let suffix = 1; suffix <= MAX_COMMAND_NAME_ATTEMPTS; suffix += 1) {
        const candidate = `${preferred}-${suffix}`
        if (busy.has(candidate)) continue
        claimed.add(candidate)
        return candidate
      }
      throw new Error(`command name "${preferred}" has no free suffix within ${MAX_COMMAND_NAME_ATTEMPTS} attempts`)
    },
    release(name: string): void {
      claimed.delete(name)
    }
  }
}

/**
 * The names one command layer holds for this plugin.
 *
 * A mount registry keeps one of these for the lifetime of its layer seat: it
 * spans every reconcile pass, so a name stays reserved exactly as long as the
 * registration carrying it is live, and it dies with the seat — a recomposed
 * layer starts from the host's own occupancy alone. Names the host refused are
 * held too, so a rename never retries a name this layer just rejected.
 *
 * Occupancy is per layer, not per process, because that is the unit the host
 * checks: two agents' scoped layers each hold their own `review`, and neither
 * registration sees the other. A process-wide ledger would rename the second
 * one for a collision the host never reports.
 */
export class CommandNameRegistry {
  /** Names held by this plugin in the layer, whether registered or refused. */
  private readonly held = new Set<string>()
  private readonly allocator = createCommandNameAllocator(() => this.held)

  /**
   * Reserve the next free name for `preferred`.
   * @param preferred - the name the command uses undisturbed.
   * @returns the name to register under.
   * @throws when every suffix within {@link MAX_COMMAND_NAME_ATTEMPTS} is taken.
   */
  claim(preferred: string): string {
    const name = this.allocator.claim(preferred)
    this.held.add(name)
    return name
  }

  /**
   * Drop a name this plugin no longer registers, freeing it for a later claim.
   * @param name - the name whose registration ended.
   */
  forget(name: string): void {
    this.allocator.release(name)
    this.held.delete(name)
  }

  /**
   * Hold a name the host refused, so it stays occupied without a registration.
   * @param name - the refused call name.
   */
  refuse(name: string): void {
    this.allocator.release(name)
    this.held.add(name)
  }

  /**
   * Every name this layer holds for the plugin.
   * @returns the allocated and refused names, as one read-only view.
   */
  taken(): ReadonlySet<string> {
    return new Set(this.held)
  }
}

/** What one registration attempt settled as. */
export type CommandNameRegistration<T> = { kind: 'registered'; name: string; disposer: T } | { kind: 'failed'; error: unknown }

/**
 * Register under the first call name the layer accepts.
 *
 * The attempt loop is the only way past a foreign occupant: the layer's names
 * are not enumerable, so a refusal is what moves allocation to the next
 * suffix. A refusal is held on `names` before the retry, which is what makes
 * the loop terminate — every iteration either registers or retires one
 * candidate, and allocation itself fails once the suffix ceiling is reached.
 * Any other failure ends the attempt immediately, because renaming around a
 * malformed definition or an unavailable registry would report a rename
 * instead of the bug that caused it.
 * @param names - the layer's occupancy ledger.
 * @param preferred - the name the command uses when nothing holds it.
 * @param register - the host registration, called once per candidate name.
 * @returns the accepted name and its registration, or the failure to diagnose.
 */
export function registerWithAllocatedName<T>(names: CommandNameRegistry, preferred: string, register: (name: string) => T): CommandNameRegistration<T> {
  for (;;) {
    let name: string
    try {
      name = names.claim(preferred)
    } catch (error) {
      return { kind: 'failed', error }
    }
    try {
      return { kind: 'registered', name, disposer: register(name) }
    } catch (error) {
      if (!isDuplicateCommandName(error)) {
        // The registration never landed, so the name is free again.
        names.forget(name)
        return { kind: 'failed', error }
      }
      names.refuse(name)
    }
  }
}
