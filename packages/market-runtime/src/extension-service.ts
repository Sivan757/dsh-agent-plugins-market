import type { ExtensionHooksOverview, ExtensionWindowPayload, ExtensionPresetInput } from '../../market-contracts/src/contracts/extension-presets.js'

export interface ExtensionRouteService {
  window(sessionId: string): Promise<ExtensionWindowPayload>
  create(sessionId: string, revision: number, input: ExtensionPresetInput): Promise<void>
  update(sessionId: string, revision: number, id: string, input: ExtensionPresetInput): Promise<void>
  delete(sessionId: string, revision: number, id: string): Promise<void>
  setDefault(sessionId: string, revision: number, id: string | null): Promise<void>
  select(sessionId: string, revision: number, id: string | null): Promise<void>
  recover?(sessionId: string, revision: number): Promise<void>
  /** The settings Hooks tab reads the configured declarations; no session owns them. */
  hooksOverview?(): Promise<ExtensionHooksOverview>
}
