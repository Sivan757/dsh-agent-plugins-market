/**
 * The one filter a surface offers: who provides the row.
 *
 * Every list used to cut on its own axis — the market on installed state, the service
 * panels on "needs attention", the user panels on source plus a disabled cut, the preset
 * manager on whether a card is switched on. A state the card already shows (its rail, its
 * state word) does not need a filter that hides the other rows: the reader who wants the
 * failed connector searches for it or glances at the rail.
 *
 * What is left is the question the lists cannot answer on their face: does a suite provide
 * this row, or did a person write it? Each face words its two providers in its own
 * vocabulary, because "project" and "plugin" mean different things per surface, but the
 * mechanism, the position and the behaviour are the same everywhere.
 *
 * @module client/ui/surface-facets
 */
import type { LocaleKey } from '../locales.js'
import type { WorkspaceTabKey } from '../../../market-contracts/src/contracts/tab-layout.js'

/** Which of the two providers a row came from. */
export type SurfaceProvider = 'suite' | 'user'

/**
 * The provider words one face uses, or undefined when the face has only one provider.
 *
 * A face whose rows all come from suites (the market, the hook list) gets no facet at all:
 * two chips reading 全部 1000 and 套件 1000 ask the reader to choose between the same list.
 */
export const SURFACE_PROVIDERS: Partial<Record<WorkspaceTabKey, Record<SurfaceProvider, LocaleKey>>> = {
  skills: { suite: 'panelSourcePlugin', user: 'panelSourceUser' },
  personas: { suite: 'panelSourcePlugin', user: 'panelSourceUser' },
  commands: { suite: 'panelSourcePlugin', user: 'panelSourceUser' },
  mcp: { suite: 'panelSourcePlugin', user: 'panelSourceUser' },
  lsp: { suite: 'panelSourcePlugin', user: 'panelSourceUser' },
  outputStyles: { suite: 'panelSourcePlugin', user: 'panelSourceUser' },
  // The prompt layer's two halves are a scope, not an owner, so this face words them the
  // way the page does: a file in the checkout, or one in the person's own directory.
  instructions: { suite: 'instructionsGroupProject', user: 'instructionsGroupGlobal' }
}

/** One facet cut, as the shared renderer takes it. */
export interface SurfaceFacetCut {
  id: string
  label: string
  match: (entry: { id: string }) => boolean
}

/**
 * The provider cuts for one face, or none when the face has a single provider.
 *
 * @param key - the workspace tab key.
 * @param t - the translator.
 * @param providerOf - which provider a row id belongs to, or undefined when unknown.
 * @returns up to two cuts, in the order the two providers are declared.
 */
export function surfaceProviderCuts(key: WorkspaceTabKey, t: (name: LocaleKey) => string, providerOf: (id: string) => SurfaceProvider | undefined): SurfaceFacetCut[] {
  const words = SURFACE_PROVIDERS[key]
  if (words === undefined) return []
  return (['suite', 'user'] as const).map(provider => ({
    id: provider,
    label: t(words[provider]),
    match: (entry: { id: string }) => providerOf(entry.id) === provider
  }))
}
