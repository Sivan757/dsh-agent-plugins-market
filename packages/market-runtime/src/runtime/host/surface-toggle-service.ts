/** Legacy surface API over the shared policy owner; no independent state or persistence. */
import type { SurfaceToggleKey, SurfaceToggles } from '../../../../market-contracts/src/contracts/surface-toggles.js'
import type { ResourceFilterService } from './resource-filter-service.js'

export class SurfaceToggleService {
  constructor(private readonly owner: ResourceFilterService) {}

  async reload(): Promise<void> {
    await this.owner.reload()
  }
  currentToggles(): SurfaceToggles {
    return this.owner.currentToggles()
  }
  async set(key: SurfaceToggleKey, enabled: boolean): Promise<SurfaceToggles> {
    return this.owner.setSurface(key, enabled)
  }
}
