/**
 * The `/` menu's row-face seam: localized titles and descriptions for the rows
 * this plugin owns.
 *
 * Two Host surfaces build that menu and neither offers a third party a face.
 * The command group is `ctx.commandUi`, whose first-party rows are faced by a
 * table keyed on the Host command id; a client contribution cannot take that
 * seat either, because registering a name the Host already serves throws and
 * drops the whole group. The skill group is a second source on
 * `ctx.inputTriggers` (`/` + `skill`) with no face seam at all.
 *
 * Both groups are faced where their rows are produced: `candidates`. The
 * wrapper rewrites only the rows it is handed a face for, keeps every other row
 * and the array itself untouched, and lets the Host's own failure through so a
 * broken source still reports as a failed group rather than an empty one.
 * Nothing is imported from a Host client package: both services are probed
 * structurally, and a seam that is missing, renamed, or private in a later Host
 * falls back to the rows the Host produced.
 * @module client/ui/menu-row-face
 */

/**
 * Patch marker, on the patched function. A Symbol.for key so two copies of this
 * bundle sharing one page recognize each other's work.
 */
const FACE_PATCH = Symbol.for('dsh-agent-plugins-market.menu-row-face')

/** Disposer recorded on a patched function, handed back to a second installer. */
const FACE_DISPOSE = Symbol.for('dsh-agent-plugins-market.menu-row-face.dispose')

/** The menu groups this plugin faces. */
export type MenuRowSource = 'commands' | 'skills'

/** Display overrides for one owned row; an absent field leaves the Host value. */
export interface MenuRowFace {
  /** Localized row title. */
  readonly label?: string
  /** Localized row description. */
  readonly description?: string
}

/** What {@link installMenuRowFace} needs to face the menu. */
export interface MenuRowFaceOptions {
  /** `ctx.commandUi`, the `/` command source. Probed structurally, never imported. */
  readonly commandUi: unknown
  /** `ctx.inputTriggers`, the roster owning the skill source. Probed structurally. */
  readonly inputTriggers: unknown
  /** Observe a real candidate request without delaying its result. */
  readonly onCandidates?: ((session: unknown) => void) | undefined
  /**
   * Resolve one row's localized face.
   * @param source - the menu group the row belongs to.
   * @param name - the row's command or skill call name.
   * @returns the overrides to apply, or undefined for a row this plugin does not own.
   */
  readonly faceOf: (source: MenuRowSource, name: string) => MenuRowFace | undefined
}

/** One report per bundle, however many keystrokes re-enter a failed wrapper. */
let failureReported = false

/** Report a contained failure once; the menu keeps serving the Host's own rows. */
function reportFailure(error: unknown): void {
  if (failureReported) return
  failureReported = true
  console.error('[dsh-agent-plugins-market] menu row face failed:', error)
}

/** Read one field off a value that may be a primitive, null, or an object. */
function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined
  return (value as Record<string, unknown>)[key]
}

/** Read a patch marker off a value without widening it. */
function marker(value: unknown, key: symbol): unknown {
  return typeof value === 'function' ? (value as unknown as Record<symbol, unknown>)[key] : undefined
}

/** Record a patch marker on a function. */
function mark(value: unknown, key: symbol, entry: unknown): void {
  ;(value as Record<symbol, unknown>)[key] = entry
}

/**
 * The text to render, or undefined when the field carries nothing.
 *
 * A blank override is treated as absent: the Host renders `label ?? name`, so
 * an empty string would blank the title and, because it differs from the name,
 * append the name as an alias beside it.
 */
function displayText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim() === '' ? undefined : value
}

/**
 * Overlay one row's face on the Host row.
 *
 * Only `label` and `description` are ever written; the row's identity fields
 * (`name`, `hint`, `icon`, `section`, the pick payload) are carried over
 * untouched. A row whose resolved face changes neither field is returned as the
 * very object the Host produced.
 * @param row - one Host-produced candidate.
 * @param source - the menu group the row belongs to.
 * @param faceOf - the owner's face resolver.
 * @returns the faced row, or the original row when nothing changes.
 */
function faceRow(row: unknown, source: MenuRowSource, faceOf: MenuRowFaceOptions['faceOf']): unknown {
  const name = field(row, 'name')
  if (typeof name !== 'string' || name === '') return row
  const face = faceOf(source, name)
  if (face === null || typeof face !== 'object') return row
  const label = displayText(field(face, 'label'))
  const description = displayText(field(face, 'description'))
  if (label === undefined && description === undefined) return row
  const current = row as Record<string, unknown>
  let faced: Record<string, unknown> | undefined
  if (label !== undefined && label !== current['label']) faced = { ...current, label }
  if (description !== undefined && description !== current['description']) faced = { ...(faced ?? current), description }
  return faced ?? row
}

/**
 * Face every row the resolver claims.
 * @returns a new array when at least one row changed, the original array otherwise.
 */
function faceRows(rows: unknown, source: MenuRowSource, faceOf: MenuRowFaceOptions['faceOf']): unknown {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const faced = rows.map((row) => {
    const next = faceRow(row, source, faceOf)
    if (next !== row) changed = true
    return next
  })
  return changed ? faced : rows
}

/**
 * Wrap one holder's `candidates` method so its rows pass through the resolver.
 *
 * The wrapper owns one layer only. A second installer finds the patch marker and
 * receives the live disposer instead of stacking a second wrapper; a wrapper
 * installed after this one keeps ownership, so tearing this one down never
 * unwraps someone else's.
 * @param holder - the service or source owning the method (a prototype method reads through).
 * @param source - the menu group its rows belong to.
 * @param faceOf - the owner's face resolver.
 * @returns the disposer, or undefined when the seam is absent or already faced.
 */
function wrapCandidates(holder: unknown, source: MenuRowSource, faceOf: MenuRowFaceOptions['faceOf'], onCandidates?: MenuRowFaceOptions['onCandidates']): (() => void) | undefined {
  if (holder === null || holder === undefined) return undefined
  if (typeof holder !== 'object' && typeof holder !== 'function') return undefined
  const target = holder as Record<string, unknown>
  const original = target['candidates']
  if (typeof original !== 'function') return undefined
  if (marker(original, FACE_PATCH) === true) return marker(original, FACE_DISPOSE) as (() => void) | undefined
  // A prototype method is restored by deleting the own property this creates.
  const inherited = !Object.prototype.hasOwnProperty.call(target, 'candidates')
  const call = original as (this: unknown, ...args: unknown[]) => unknown
  const patched = async function patchedCandidates(this: unknown, ...args: unknown[]): Promise<unknown> {
    // A rejected Host source is the Host's to report: it already renders as a
    // failed group with a console error, and swallowing it here would trade a
    // loud failure for a silently empty group.
    const rows = await call.apply(this, args)
    try {
      onCandidates?.(args[0])
      return faceRows(rows, source, faceOf)
    } catch (error) {
      reportFailure(error)
      return rows
    }
  }
  const dispose = (): void => {
    if (target['candidates'] !== patched) return
    if (inherited) delete target['candidates']
    else target['candidates'] = original
  }
  mark(patched, FACE_PATCH, true)
  mark(patched, FACE_DISPOSE, dispose)
  try {
    target['candidates'] = patched
  } catch (error) {
    reportFailure(error)
    return undefined
  }
  return dispose
}

/** Whether one roster entry is the skill group's source. */
function isSkillSource(value: unknown): boolean {
  return field(value, 'trigger') === '/' && field(value, 'name') === 'skill'
}

/** The `skill` sources already on the roster, when the service exposes its live list. */
function registeredSkillSources(roster: unknown): unknown[] {
  const sources = field(field(roster, 'live'), 'sources')
  return Array.isArray(sources) ? sources.filter(isSkillSource) : []
}

/**
 * Face a `skill` source that registers after this plugin.
 *
 * `ui-skill` owns the group and the bundle order does not guarantee it runs
 * first, so the roster is read once and this covers the late arrival. Watching
 * registration is the timer-free form of a retry: no polling, no delay, and it
 * unwinds with the disposer.
 * @param roster - the `ctx.inputTriggers` service.
 * @param faceOf - the owner's face resolver.
 * @param collect - receives the disposer of every source faced while watching.
 * @returns the disposer, or undefined when the roster exposes no registration seam.
 */
function watchSkillRegistrations(roster: unknown, faceOf: MenuRowFaceOptions['faceOf'], collect: (dispose: () => void) => void, onCandidates?: MenuRowFaceOptions['onCandidates']): (() => void) | undefined {
  if (roster === null || roster === undefined) return undefined
  if (typeof roster !== 'object' && typeof roster !== 'function') return undefined
  const target = roster as Record<string, unknown>
  const register = target['registerSource']
  if (typeof register !== 'function') return undefined
  if (marker(register, FACE_PATCH) === true) return undefined
  const inherited = !Object.prototype.hasOwnProperty.call(target, 'registerSource')
  const call = register as (this: unknown, ...args: unknown[]) => unknown
  const patched = function patchedRegisterSource(this: unknown, ...args: unknown[]): unknown {
    const disposer = call.apply(this, args)
    const source = args[0]
    if (isSkillSource(source)) {
      try {
        const dispose = wrapCandidates(source, 'skills', faceOf, onCandidates)
        if (dispose !== undefined) collect(dispose)
      } catch (error) {
        reportFailure(error)
      }
    }
    return disposer
  }
  const dispose = (): void => {
    if (target['registerSource'] !== patched) return
    if (inherited) delete target['registerSource']
    else target['registerSource'] = register
  }
  mark(patched, FACE_PATCH, true)
  try {
    target['registerSource'] = patched
  } catch (error) {
    reportFailure(error)
    return undefined
  }
  return dispose
}

/** Face every `skill` source the roster can reach, now and on later registration. */
function faceSkillSources(options: MenuRowFaceOptions, collect: (dispose: () => void) => void): void {
  for (const source of registeredSkillSources(options.inputTriggers)) {
    const dispose = wrapCandidates(source, 'skills', options.faceOf, options.onCandidates)
    if (dispose !== undefined) collect(dispose)
  }
  const watching = watchSkillRegistrations(options.inputTriggers, options.faceOf, collect, options.onCandidates)
  if (watching !== undefined) collect(watching)
}

/**
 * Face the `/` menu's command and skill rows, and keep facing them until the
 * returned disposer runs. Installing twice returns the live disposer rather
 * than stacking a second wrapper.
 *
 * Every seam is probed: a Host that moved, renamed, or hid one leaves that
 * group on its own rows, and no failure here can reach the menu.
 * @param options - the services to face and the resolver naming the owned rows.
 * @returns the disposer restoring every wrapped seam.
 */
export function installMenuRowFace(options: MenuRowFaceOptions): () => void {
  const disposers: Array<() => void> = []
  const collect = (dispose: () => void): void => {
    disposers.push(dispose)
  }
  try {
    const commands = wrapCandidates(options.commandUi, 'commands', options.faceOf, options.onCandidates)
    if (commands !== undefined) collect(commands)
  } catch (error) {
    reportFailure(error)
  }
  try {
    faceSkillSources(options, collect)
  } catch (error) {
    reportFailure(error)
  }
  return (): void => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch (error) {
        reportFailure(error)
      }
    }
  }
}
