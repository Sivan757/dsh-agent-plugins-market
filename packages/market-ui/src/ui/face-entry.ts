/**
 * One row, built once, for both surfaces that show it.
 *
 * A row appears twice in this product: on its own settings face, where it belongs to a
 * workspace, and inside the preset manager, where it belongs to a preset. The two draw the same
 * card and answer the same questions — is it on, can it be switched, what did it fail at, what
 * does it cost — yet those answers used to be written twice, so a fact added to one surface
 * quietly went missing on the other.
 *
 * This module is the one place they are computed. A surface adapts its own row type to
 * `FaceRowFacts`, says which of the two modes is drawing, and gets back the entry the shared
 * card renders. The modes differ in two deliberate ways and no others: the state word (the
 * settings face names what the row is doing, a preset names whether the row is in it) and the
 * availability vocabulary, because a preset can hold a row the host cannot switch at all.
 *
 * @module client/ui/face-entry
 */
import type { ResourceEntry } from './ResourceSurface.js'
import type { ResourceState, ResourceSurface } from './ResourceCard.js'
import type { Translate } from '../i18n.js'
import { failureCause, failureGuidanceKey, FAILURE_GUIDANCE_LABEL } from './failure-guidance.js'
import type { SurfaceProvider } from './surface-facets.js'

/** A service row's live condition, in the contract's own vocabulary. */
export type LiveState = 'connected' | 'starting' | 'failed' | 'degraded' | 'disabled' | 'foreign' | 'orphaned' | 'needs-credentials' | 'unknown'

/**
 * How a row stands with respect to being switched.
 *
 * `ready` can be switched, `unavailable` cannot be switched because nothing is there to
 * switch, and `global-only` is managed by the host, so the row has no switch of its own.
 */
export type Switchability = 'ready' | 'unavailable' | 'global-only'

/** What the two surfaces must agree on about one row. */
export interface FaceRowFacts {
  /** The card family, which decides a few narrow-container rules. */
  surface: ResourceSurface
  /** Which provider the row belongs to; the shared facet cuts read it. */
  provider: SurfaceProvider
  id: string
  name: string
  /** The version chip, when the row has one. */
  version?: string
  /** A quiet qualifier after the title: the raw name, the file, the style source. */
  hint?: string
  /** Draw the title in a monospace face. */
  mono?: boolean
  /** Draw the body line in a monospace face, for endpoints and commands. */
  monoBody?: boolean
  /** The chip naming the row's family or owner, already in this face's words. */
  tag: string
  /** One sentence under the title. */
  description?: string
  /** The quiet line at the bottom. */
  meta?: string
  /** Extra search text the eye cannot read off the card. */
  keywords?: string
  /** Whether this surface offers a switch for the row at all. */
  showSwitch: boolean
  /** Whether the row can be switched; a preset distinguishes the two refusals. */
  switchability?: Switchability
  /** The row's own position: on this face, or in this preset. */
  on: boolean
  /** The live condition, when the row stands for something that runs. */
  live?: {
    state: LiveState
    code?: string
    reason?: string
    causes?: readonly string[]
    mountMs?: number
    transport?: string
    toolCount?: number
  }
  /** The settings face's own word for the live state, from that face's dictionary. */
  liveWord?: string
  /** A preset's word for a row it cannot switch, when its own rules have one. */
  unswitchableWord?: string
  /** A sentence the row earns besides its live failure, such as why it cannot be switched. */
  note?: string
  /** Counts the card carries under the title, already labelled. */
  counts?: readonly { label: string; count: number }[]
}

/** Which surface is drawing the entry. */
export type FaceEntryMode = 'settings' | 'resolve'

/** The state class each live condition earns on a face that owns the thing. */
const LIVE_STATE: Record<LiveState, ResourceState> = {
  connected: 'active',
  starting: 'warning',
  failed: 'error',
  degraded: 'warning',
  disabled: 'disabled',
  foreign: 'disabled',
  orphaned: 'error',
  'needs-credentials': 'warning',
  unknown: 'absent'
}

/**
 * The failure sentence a row earns, or undefined when the row is fine.
 *
 * The panels classified a failure with `failureGuidanceKey` and the manager re-derived the same
 * sentence; this is that composition once. The advice after the colon is the sentence; the time
 * the attempt took rides behind it when the builder recorded one.
 * @param t - the translator.
 * @param live - the row's live condition.
 * @returns the sentence, or undefined when no failure is stated or known.
 */
export function liveFailureSentence(t: Translate, live: FaceRowFacts['live']): string | undefined {
  if (live === undefined || live.state === 'connected' || live.state === 'disabled') return undefined
  const guidance = failureGuidanceKey({ code: live.code, reason: live.reason, causes: live.causes })
  const sentence = guidance === undefined ? live.reason : t(FAILURE_GUIDANCE_LABEL[guidance])
  if (sentence === undefined || sentence === '') return undefined
  const seconds = live.mountMs === undefined || live.mountMs < 1000 ? undefined : (live.mountMs / 1000).toFixed(1) + 's'
  const advice = failureCause(sentence)
  return seconds === undefined ? advice : advice + ' · ' + seconds
}

/**
 * The state the card's rail wears.
 * @param facts - the row's facts.
 * @param mode - which surface is drawing.
 * @returns the state class.
 */
function entryState(facts: FaceRowFacts, mode: FaceEntryMode): ResourceState {
  if (mode === 'settings') return facts.live === undefined ? (facts.on ? 'active' : 'disabled') : LIVE_STATE[facts.live.state]
  // A preset paints what it can actually switch: a host-managed row is simply off, and a row
  // with nothing behind it warns instead of pretending to be a choice.
  if (facts.switchability === 'global-only') return 'disabled'
  if (facts.switchability === 'unavailable') return 'warning'
  return facts.on ? 'active' : 'disabled'
}

/**
 * The word a screen reader hears beside the rail.
 * @param t - the translator.
 * @param facts - the row's facts.
 * @param mode - which surface is drawing.
 * @returns the state word.
 */
function entryStateLabel(t: Translate, facts: FaceRowFacts, mode: FaceEntryMode): string {
  if (mode === 'settings') return facts.liveWord ?? t(facts.on ? 'enabledLabel' : 'disabledLabel')
  if (facts.unswitchableWord !== undefined) return facts.unswitchableWord
  if (facts.switchability === 'unavailable') return t('stateUnavailable')
  return t(facts.on ? 'enabledLabel' : 'disabledLabel')
}

/**
 * Build the entry both surfaces render for one row.
 *
 * @param t - the translator in force.
 * @param facts - everything the two surfaces must agree on.
 * @param mode - whether this is the row's own face or a preset's view of it.
 * @returns the entry the shared card draws.
 */
export function buildFaceEntry(t: Translate, facts: FaceRowFacts, mode: FaceEntryMode): ResourceEntry {
  const failure = liveFailureSentence(t, facts.live)
  const warning = failure ?? facts.note
  return {
    id: facts.id,
    name: facts.name,
    ...(facts.version === undefined ? {} : { version: facts.version }),
    ...(facts.hint === undefined ? {} : { hint: facts.hint }),
    ...(facts.mono === true ? { mono: true } : {}),
    ...(facts.monoBody === true ? { monoBody: true } : {}),
    tag: facts.tag,
    ...(facts.description === undefined ? {} : { description: facts.description }),
    ...(facts.meta === undefined ? {} : { meta: facts.meta }),
    ...(facts.keywords === undefined ? {} : { keywords: facts.keywords }),
    ...(facts.counts === undefined ? {} : { counts: facts.counts }),
    surface: facts.surface,
    state: entryState(facts, mode),
    stateLabel: entryStateLabel(t, facts, mode),
    // A row without a switch still says where it stands; a row with one says what pressing it
    // does. The switch's verb, so the control is not announced as the resource's name again.
    ...(facts.showSwitch ? { toggleLabel: t(facts.on ? 'disable' : 'enable') } : { hideToggle: true }),
    ...(warning === undefined ? {} : { warning })
  }
}
