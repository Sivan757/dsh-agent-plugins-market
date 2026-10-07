/**
 * The runtime's single read/write owner of per-workspace surface toggles.
 *
 * Both sides meet here: the reconciler reads {@link current} before mounting
 * each surface, and the composer control writes {@link set} then triggers the
 * same refresh the settings namespace uses, so a toggle takes effect through
 * the ordinary reconcile path rather than a UI-only state change.
 *
 * The in-memory copy exists because the read path is synchronous (the
 * composition root consults it while wiring mounts) while persistence stays
 * async; {@link reload} is the only place the copy refreshes from disk.
 *
 * @module runtime/host/surface-toggle-service
 */
import {
  ALL_SURFACES_ON,
  SURFACE_TOGGLE_KEYS,
  resolveSurfaceToggles,
  type SurfaceToggleKey,
  type SurfaceToggles
} from '../../../../market-contracts/src/contracts/surface-toggles.js'
import { loadSurfaceToggles, saveSurfaceToggles } from '../../application/state/surface-toggles.js'

/** What a toggle change asks the runtime to do: the standard refresh chain. */
export interface SurfaceToggleHooks {
  /** Re-run the mount refresh chain for the toggled surfaces. */
  onTogglesChanged(): Promise<void> | void
}

export class SurfaceToggleService {
  private current: SurfaceToggles = { ...ALL_SURFACES_ON }
  private readonly workspace: string

  constructor(
    private readonly dataRoot: string,
    workspace: string | undefined,
    private readonly hooks: SurfaceToggleHooks
  ) {
    this.workspace = workspace ?? ''
  }

  /** Load the persisted state for this workspace into memory. */
  async reload(): Promise<void> {
    if (this.workspace === '') return
    this.current = await loadSurfaceToggles(this.dataRoot, this.workspace)
  }

  /** The live toggle state; all-on until the first reload lands. */
  currentToggles(): SurfaceToggles {
    return this.current
  }

  /** Whether one surface may mount right now. */
  allows(key: SurfaceToggleKey): boolean {
    return this.current[key]
  }

  /** Flip one surface, persist, and ask the runtime to reconcile. */
  async set(key: SurfaceToggleKey, enabled: boolean): Promise<SurfaceToggles> {
    if (!SURFACE_TOGGLE_KEYS.includes(key)) return this.current
    this.current = { ...this.current, [key]: enabled }
    if (this.workspace !== '') await saveSurfaceToggles(this.dataRoot, this.workspace, this.current)
    await this.hooks.onTogglesChanged()
    return this.current
  }

  /**
   * Replace the whole switch set in one write. Used when a favorite snapshot
   * lands: the six switches and the entry filters must become one coherent
   * document, and the caller owns running the refresh chain once afterwards.
   */
  async applyAll(toggles: SurfaceToggles): Promise<void> {
    this.current = resolveSurfaceToggles(toggles)
    if (this.workspace !== '') await saveSurfaceToggles(this.dataRoot, this.workspace, this.current)
  }
}
