/**
 * The filters a surface offers.
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
 * The market is the one face whose rows all come from one provider, so it has no provider
 * facet to draw. It does have two states worth separating — a suite that is switched on and
 * one that is switched off — and the owner asked for exactly that filter. The state cuts
 * live in this one table beside the provider cuts, so the settings page and the preset
 * manager cannot disagree about what a filter is.
 *
 * @module client/ui/surface-facets
 */
import type { LocaleKey } from '../locales.js'
import type { WorkspaceTabKey } from '../../../market-contracts/src/contracts/tab-layout.js'
import type { ResourceState } from './ResourceCard.js'

/** Which of the two providers a row came from. */
export type SurfaceProvider = 'suite' | 'user'

/**
 * The provider words one face uses, or undefined when the face has only one provider.
 *
 * A face whose rows can only come from one place (the market, where every row is a suite) gets
 * no provider facet at all: two chips reading 全部 1000 and 套件 1000 ask the reader to choose between the
 * same list. The hook face does have two providers — a declaration a suite ships, and one the
 * reader wrote in their own hooks.json — so it carries the same pair as the rest.
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
  instructions: { suite: 'instructionsGroupProject', user: 'instructionsGroupGlobal' },
  hooks: { suite: 'panelSourcePlugin', user: 'panelSourceUser' }
}

/** One state cut, as the shared table declares it. */
export interface SurfaceStateCut {
  /** Stable id, also the segment the toolbar keys its selection by. */
  id: string
  /** The locale key the cut's word comes from. */
  label: LocaleKey
  /** The row state this cut selects. */
  state: ResourceState
}

/**
 * The state words one face cuts on, or undefined when the face has no state to cut on.
 *
 * The market is the face that declares them: a suite that is switched on and a suite that
 * is switched off are two lists a reader asks for separately. A suite that is listed but not
 * installed is `absent`, so it belongs to neither cut and stays visible under 全部 — the
 * cut narrows to what is installed and switched either way.
 */
export const SURFACE_STATE_CUTS: Partial<Record<WorkspaceTabKey, readonly SurfaceStateCut[]>> = {
  market: [
    { id: 'enabled', label: 'enabledLabel', state: 'active' },
    { id: 'disabled', label: 'disabledLabel', state: 'disabled' }
  ]
}

/** The row facts a cut may read. */
export interface SurfaceFacetEntry {
  id: string
  /** The state the card's rail wears; absent when the surface did not set one. */
  state?: ResourceState
  /** Whether the entry is switched off, for an entry that carries no state. */
  disabled?: boolean
}

/** One facet cut, as the shared renderer takes it. */
export interface SurfaceFacetCut {
  id: string
  label: string
  match: (entry: SurfaceFacetEntry) => boolean
}

/**
 * The state a card's rail wears, the same fallback the renderer applies to an entry that
 * carries no state of its own: a cut must agree with the card it filters.
 */
function effectiveState(entry: SurfaceFacetEntry): ResourceState {
  return entry.state ?? (entry.disabled === true ? 'disabled' : 'active')
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
    match: (entry: SurfaceFacetEntry) => providerOf(entry.id) === provider
  }))
}

/**
 * The state cuts for one face, or none when the face declares no state cut.
 *
 * @param key - the workspace tab key.
 * @param t - the translator.
 * @returns the declared cuts, in the order the table declares them.
 */
export function surfaceStateCuts(key: WorkspaceTabKey, t: (name: LocaleKey) => string): SurfaceFacetCut[] {
  const words = SURFACE_STATE_CUTS[key]
  if (words === undefined) return []
  return words.map(word => ({
    id: word.id,
    label: t(word.label),
    match: (entry: SurfaceFacetEntry) => effectiveState(entry) === word.state
  }))
}

/**
 * Every cut one face draws: who provides the row, then the states worth separating.
 *
 * This is the one entry point both surfaces call, so the settings page and the preset
 * manager read the same table and cannot end up with different filters.
 *
 * @param key - the workspace tab key.
 * @param t - the translator.
 * @param providerOf - which provider a row id belongs to, or undefined when unknown.
 * @returns the face's cuts, in a stable order: providers first, then states.
 */
export function surfaceCuts(key: WorkspaceTabKey, t: (name: LocaleKey) => string, providerOf: (id: string) => SurfaceProvider | undefined): SurfaceFacetCut[] {
  return [...surfaceProviderCuts(key, t, providerOf), ...surfaceStateCuts(key, t)]
}
