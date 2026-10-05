/**
 * The `/` menu's row-face data source.
 *
 * {@link installMenuRowFace} decides how a row's description is written; this
 * decides what it says. The host resolves the text — it reads the translation
 * cache the panels filled — and this keeps the answer in a map the wrapper
 * consults on every candidate synthesis, so a locale change or a newly
 * translated row shows up on the next keystroke rather than at the next page
 * load.
 *
 * Only descriptions travel: a name is an identifier the user types and matches
 * against upstream documentation, so a row's title always stays the host's own.
 *
 * Nothing here throws and nothing blocks the menu: a failed read leaves the
 * faces it already had in place, and a row with no face renders exactly as the
 * host wrote it.
 * @module client/menu-row-faces
 */
import type { MenuRowFaceWire, MenuRowSource } from '../contracts/market.js'
import { installMenuRowFace, type MenuRowFace } from './ui/menu-row-face.js'

/** What {@link createMenuRowFaces} needs. */
export interface MenuRowFacesOptions {
  /** `ctx.commandUi`; handed to the wrapper untyped, which probes it structurally. */
  readonly commandUi: unknown
  /** `ctx.inputTriggers`; the roster owning the skill source. */
  readonly inputTriggers: unknown
  /** Read the host's localized faces. Rejections are contained here. */
  readonly load: () => Promise<readonly MenuRowFaceWire[]>
  /** Report a read failure; called at most once per install. */
  readonly onError?: (error: unknown) => void
}

/** The live face source behind the wrapper. */
export interface MenuRowFaces {
  /** Re-read the host faces and swap them in. Never throws. */
  refresh(): Promise<void>
  /** Drop the faces and unwrap the menu. */
  dispose(): void
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
  const faceOf = (source: MenuRowSource, name: string): MenuRowFace | undefined => faces.get(rowKey(source, name))
  const disposeFace = installMenuRowFace({
    commandUi: options.commandUi,
    inputTriggers: options.inputTriggers,
    faceOf
  })
  return {
    async refresh(): Promise<void> {
      let rows: readonly MenuRowFaceWire[]
      try {
        rows = await options.load()
      } catch (error) {
        // The menu keeps serving whatever it already had — on a first failure
        // that is nothing, so every row renders as the host wrote it.
        if (!reported) {
          reported = true
          options.onError?.(error)
        }
        return
      }
      const next = new Map<string, MenuRowFace>()
      for (const row of rows) {
        const description = shown(row.description)
        if (description === undefined) continue
        next.set(rowKey(row.source, row.name), { description })
      }
      faces = next
    },
    dispose(): void {
      faces = new Map()
      disposeFace()
    }
  }
}
