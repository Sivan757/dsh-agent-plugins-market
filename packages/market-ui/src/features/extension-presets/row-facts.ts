/**
 * The facts one preset row contributes to the shared card.
 *
 * A row appears on its own settings face and inside the preset manager, and the
 * suggestion dialog shows the same row again when the model proposes a
 * selection. All three draw one card and answer the same questions about it, so
 * the adaptation from an `ExtensionResource` onto `FaceRowFacts` lives here
 * once instead of in each caller.
 *
 * @module client/features/extension-presets/row-facts
 */
import type { ExtensionResource } from '../../../../market-contracts/src/contracts/extension-presets.js'
import type { FaceRowFacts } from '../../ui/face-entry.js'
import type { ResourceSurface as SurfaceFamily } from '../../ui/ResourceCard.js'
import { displayText } from '../../ui/translated-text.js'
import type { SurfaceProvider } from '../../ui/surface-facets.js'
import { PRESET_FACES, WORKSPACE_TAB_META, workspaceKeyOfFace } from '../../workspace/tab-meta.js'
import type { WorkspaceTabKey } from '../../../../market-contracts/src/contracts/tab-layout.js'
import type { LocaleKey } from '../../locales.js'
import type { ExtensionTranslate } from './types.js'

const faces = PRESET_FACES

/** The card family each preset face draws with; a prompt-layer face has none of these rules. */
const SURFACE_OF: Record<(typeof PRESET_FACES)[number], SurfaceFamily> = {
  market: 'market',
  skills: 'skills',
  commands: 'commands',
  agents: 'personas',
  mcp: 'mcp',
  lsp: 'lsp',
  hooks: 'hooks',
  // A style and an instruction block are documents, not collections of plugins: no card rule
  // keys off them, so they ride the nearest family without borrowing its meaning.
  outputStyles: 'commands',
  instructions: 'commands'
}

/** Each face's workspace tab key, resolved once from the shared metadata. */
export const PRESET_TAB_KEY = Object.fromEntries(faces.map(face => [face, workspaceKeyOfFace(face)!])) as Record<(typeof faces)[number], WorkspaceTabKey>

/** The face's tab label, or the noun one collection of it is counted in. */
export const labelOf = (face: (typeof faces)[number]): LocaleKey => WORKSPACE_TAB_META[PRESET_TAB_KEY[face]].label
const countOf = (face: (typeof faces)[number]): LocaleKey | undefined => WORKSPACE_TAB_META[PRESET_TAB_KEY[face]].surface

/**
 * Which provider a preset row came from, in the same terms the workspace tab uses.
 *
 * The inventory carries the answer per face: a suite-owned row names its suite, a direct
 * service or a person's own entry does not, and the two prompt-layer faces encode it in
 * their ids because a style or a file has no owning suite row.
 */
export function providerOf(row: ExtensionResource | undefined): SurfaceProvider | undefined {
  if (row === undefined) return undefined
  if (row.face === 'market' || row.face === 'hooks') return 'suite'
  if (row.face === 'instructions') return row.id.startsWith('instructions:project/') ? 'suite' : 'user'
  if (row.face === 'outputStyles') return row.id.startsWith('outputStyles:user') ? 'user' : 'suite'
  return row.suiteResourceId !== undefined ? 'suite' : 'user'
}

/** One row, its context, and whether the surface that asked holds it on. */
export interface PresetRowFactsInput {
  t: ExtensionTranslate
  row: ExtensionResource
  /** Every resource of the preset window, for a market suite's own counts. */
  resources: readonly ExtensionResource[]
  /** Whether this surface holds the row on (the preset's selection or the suggestion's ticks). */
  on: boolean
  showOriginal: boolean
  translationEnabled: boolean
}

/**
 * Adapt one preset row onto the facts both surfaces share.
 *
 * @param input - the row and the surface state that decides what the card says.
 * @returns the facts the shared card builder draws.
 */
export function presetRowFacts(input: PresetRowFactsInput): FaceRowFacts {
  const { t, row, resources, on, showOriginal, translationEnabled } = input
  const displayName = row.configuration === 'user-hooks' ? t('epUserHooks') : row.name
  const displayDescription = displayText(row.translatedDescription, row.description, t, { original: !translationEnabled || showOriginal })
  // The owner tag mirrors each settings face's own mapping: a market row is an
  // installed user-dimension suite (extension-inventory.ts), a panel entry with
  // no owning suite is the user's own file, and an MCP or LSP row with no owning
  // suite is a directly declared service. Hook rows keep their own card.
  const ownerLabel = (value: ExtensionResource): string => {
    // An instruction file names its root in the id, so the tag says which half of the
    // chain it belongs to instead of borrowing a suite's vocabulary.
    if (value.face === 'instructions')
      return value.id.startsWith('instructions:project/') ? t(labelOf('instructions')) + ' · ' + t('epScopeProject') : t(labelOf('instructions')) + ' · ' + t('epScopeGlobal')
    if (value.face === 'market') return t('panelSourceUser')
    // A style has no suite child row: its own source says whether a person wrote it or a
    // suite brought it. Falling through to the child-row test labelled every suite style
    // 用户, because a style never carries suiteResourceId.
    if (value.face === 'outputStyles') return value.source === 'user' ? t('panelSourceUser') : t('panelSourcePlugin')
    if (value.face === 'mcp') return value.suiteResourceId === undefined ? t('mcpDirect') : t('mcpPlugin')
    if (value.face === 'lsp') return value.suiteResourceId === undefined ? t('lspDirect') : t('lspPlugin')
    return value.suiteResourceId === undefined ? t('panelSourceUser') : t('panelSourcePlugin')
  }
  const hints = (value: ExtensionResource): string =>
    value.control === 'global-only'
      ? value.unavailableReason === 'hook-event-partial'
        ? t('epHookEventPartial')
        : value.unavailableReason === 'hook-event-unsupported'
          ? t('epHookEventUnsupported')
          : t('epGlobalManaged')
      : value.unavailableReason === 'instructions-no-switch'
        ? t('epInstructionsNoSwitch')
        : value.unavailableReason === 'style-uncaptured'
          ? t('epStyleUncaptured')
          : (value.unavailableReason ?? t(value.configuration ? 'epConfigurationUnavailable' : 'epUnavailable'))
  const noSwitch = row.unavailableReason === 'instructions-no-switch'
  const globalOnly = row.control === 'global-only'
  const counts =
    row.toolCount === undefined
      ? row.face === 'market'
        ? faces
            // A face without a count noun is the market itself: the row is the market,
            // so it does not count itself.
            .flatMap(value => {
              const label = countOf(value)
              return label === undefined ? [] : [{ label: t(label), count: resources.filter(child => child.suiteResourceId === row.id && child.face === value).length }]
            })
            .filter(item => item.count > 0)
        : undefined
      : [{ label: t(row.toolCount === 1 ? 'mcpTool' : 'mcpTools'), count: row.toolCount }]
  return {
    surface: SURFACE_OF[row.face],
    provider: providerOf(row) ?? 'user',
    id: row.id,
    name: displayName,
    ...(row.version === undefined ? {} : { version: row.version }),
    ...(row.face === 'commands' ? { mono: true } : {}),
    // The panel's own facts, in the panel's own slots: a service row's transport rides the
    // bottom line, its endpoint and tools are a monospace body and a count.
    ...(row.runtime !== undefined && row.face === 'mcp' ? { monoBody: true } : {}),
    tag: ownerLabel(row),
    description: displayDescription,
    // A host-managed row has no switch, so the bottom line carries its position in the
    // preset's own words instead.
    meta: globalOnly ? row.source + ' · ' + t(on ? 'epOn' : 'epOff') : (row.transport ?? row.source),
    keywords: [row.name, row.description ?? '', row.source].join(' '),
    ...(counts === undefined ? {} : { counts }),
    showSwitch: !globalOnly && !noSwitch,
    switchability: globalOnly ? 'global-only' : !row.available ? 'unavailable' : 'ready',
    on,
    ...(row.runtime === undefined
      ? {}
      : {
          live: {
            state: row.runtime.state,
            ...(row.runtime.code === undefined ? {} : { code: row.runtime.code }),
            ...(row.runtime.reason === undefined ? {} : { reason: row.runtime.reason }),
            ...(row.runtime.causes === undefined ? {} : { causes: row.runtime.causes }),
            ...(row.runtime.mountMs === undefined ? {} : { mountMs: row.runtime.mountMs })
          }
        }),
    // An instruction file has no on/off switch, so it says whether the host injects it
    // rather than borrowing the vocabulary of the switches beside it.
    ...(row.face === 'instructions' ? { unswitchableWord: t(row.available ? 'epInstructionInjected' : 'epInstructionNotInjected') } : {}),
    ...(!row.available || globalOnly ? { note: hints(row) } : {})
  }
}
