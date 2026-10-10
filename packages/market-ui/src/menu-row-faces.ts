/**
 * The `/` menu's row-face data source.
 *
 * {@link installMenuRowFace} decides how a row's description is written; this
 * decides what it says. The host resolves the text — it reads the translation
 * cache the panels filled — and this keeps the answer in a map the wrapper
 * consults on every candidate request. A requested open menu revalidates a
 * bounded number of times and refreshes through its public controller when
 * descriptions change.
 *
 * Only descriptions travel: a name is an identifier the user types and matches
 * against upstream documentation, so a row's title always stays the host's own.
 *
 * Nothing here throws and nothing blocks the menu: a failed read leaves the
 * faces it already had in place, and a row with no face renders exactly as the
 * host wrote it.
 * @module client/menu-row-faces
 */
import type { MenuRowFaceWire, MenuRowSource } from '../../market-contracts/src/contracts/market.js'
import { installMenuRowFace, type MenuRowFace } from './ui/menu-row-face.js'

/** Minimum interval between reads while a requested menu stays open. */
export const MENU_FACE_REVALIDATE_MS = 1_500
/** Maximum follow-up reads for one uninterrupted menu opening. */
export const MENU_FACE_MAX_READS = 40

/** What {@link createMenuRowFaces} needs. */
export interface MenuRowFacesOptions {
  /** `ctx.commandUi`; handed to the wrapper untyped, which probes it structurally. */
  readonly commandUi: unknown
  /** `ctx.inputTriggers`; the roster owning the skill source. */
  readonly inputTriggers: unknown
  /** Published sessions service. Only existing retained scopes are borrowed. */
  readonly sessions?: unknown
  /** Read the host's localized faces. Rejections are contained here. */
  readonly load: () => Promise<readonly MenuRowFaceWire[]>
  /** Report a read failure; called at most once per install. */
  readonly onError?: (error: unknown) => void
}

/** The live face source behind the wrapper. */
export interface MenuRowFaces {
  /** Re-read the host faces and swap them in. Never throws. */
  refresh(clear?: boolean): Promise<void>
  /** Drop the faces and unwrap the menu. */
  dispose(): void
}

/** Public controller members used from dsh-client-ui-input-trigger 0.2.0-rc.2. */
interface OpenMenuController {
  menu: { getSnapshot(): { open: boolean }; subscribe(listener: () => void): () => void }
  refreshOpenMenu(): void
}

/** Borrow the requesting session's existing controller, never retain or create a session. */
function existingMenu(options: MenuRowFacesOptions, session: unknown): OpenMenuController | undefined {
  try {
    const id = (session as { sessionId?: unknown } | undefined)?.sessionId
    if (typeof id !== 'string') return undefined
    const sessions = options.sessions as { scope?: (id: string) => unknown } | undefined
    const scope = sessions?.scope?.(id)
    if (scope === undefined) return undefined
    const triggers = options.inputTriggers as { sessionOf?: (scope: unknown) => OpenMenuController } | undefined
    const controller = triggers?.sessionOf?.(scope)
    if (typeof controller?.menu?.getSnapshot !== 'function' || typeof controller.menu.subscribe !== 'function' || typeof controller.refreshOpenMenu !== 'function') return undefined
    return controller
  } catch {
    return undefined
  }
}

/** The map key for one row: a command and a skill of the same name are two rows. */
function rowKey(source: MenuRowSource, name: string): string {
  return `${source}\u0000${name}`
}

/** The text to show, or undefined when the host sent nothing usable. */
function shown(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value
}

/**
 * Face the `/` menu from the host's own answer.
 *
 * A row the host sent no text for is left out of the map entirely, which is
 * what makes it render as the host wrote it: the wrapper only rewrites a row it
 * is handed a face for.
 * @param options - the services to wrap and the reader of the host's faces.
 * @returns the live source: refresh it when the locale changes, dispose it to unwrap.
 */
export function createMenuRowFaces(options: MenuRowFacesOptions): MenuRowFaces {
  let faces = new Map<string, MenuRowFace>()
  let reported = false
  let disposed = false
  let generation = 0
  let activeReads = 0
  let nextReadAt = 0
  const openMenus = new Map<OpenMenuController, { stop: () => void }>()
  const notifyMenus = (): void => {
    for (const controller of openMenus.keys()) {
      if (controller.menu.getSnapshot().open) controller.refreshOpenMenu()
    }
  }

  const refresh = async (clear = false): Promise<void> => {
    if (disposed) return
    const current = ++generation
    if (clear) {
      faces = new Map()
      notifyMenus()
    }
    activeReads += 1
    nextReadAt = Date.now() + MENU_FACE_REVALIDATE_MS
    try {
      const rows = await options.load()
      if (disposed || current !== generation) return
      const next = new Map<string, MenuRowFace>()
      for (const row of rows) {
        const description = shown(row.description)
        if (description !== undefined) next.set(rowKey(row.source, row.name), { description })
      }
      const changed = next.size !== faces.size || [...next].some(([key, face]) => face.description !== faces.get(key)?.description)
      faces = next
      if (changed) notifyMenus()
    } catch (error) {
      if (!disposed && current === generation && !reported) {
        reported = true
        options.onError?.(error)
      }
    } finally {
      activeReads -= 1
    }
  }

  // Candidate reads never wait for translation. Hosts without the public
  // controller interface still revalidate on the next user request.
  const faceOf = (source: MenuRowSource, name: string): MenuRowFace | undefined => {
    if (!disposed && activeReads === 0 && Date.now() >= nextReadAt) void refresh()
    return faces.get(rowKey(source, name))
  }
  const onCandidates = (session: unknown): void => {
    const controller = existingMenu(options, session)
    if (controller === undefined || !controller.menu.getSnapshot().open || openMenus.has(controller)) return
    let remaining = MENU_FACE_MAX_READS
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe = (): void => {}
    const stop = (): void => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      unsubscribe()
      openMenus.delete(controller)
    }
    const tick = async (): Promise<void> => {
      if (stopped || disposed || !controller.menu.getSnapshot().open) {
        stop()
        return
      }
      if (remaining === 0) return
      remaining -= 1
      if (activeReads === 0 && Date.now() >= nextReadAt) await refresh()
      if (!stopped && remaining > 0) timer = setTimeout(() => void tick(), MENU_FACE_REVALIDATE_MS)
    }
    openMenus.set(controller, { stop })
    unsubscribe = controller.menu.subscribe(() => {
      if (!controller.menu.getSnapshot().open) stop()
    })
    timer = setTimeout(() => void tick(), MENU_FACE_REVALIDATE_MS)
  }
  const disposeFace = installMenuRowFace({ commandUi: options.commandUi, inputTriggers: options.inputTriggers, faceOf, onCandidates })
  return {
    refresh,
    dispose(): void {
      disposed = true
      generation += 1
      const controllers = [...openMenus.keys()]
      for (const menu of [...openMenus.values()]) menu.stop()
      faces = new Map()
      disposeFace()
      for (const controller of controllers) {
        if (controller.menu.getSnapshot().open) controller.refreshOpenMenu()
      }
    }
  }
}
