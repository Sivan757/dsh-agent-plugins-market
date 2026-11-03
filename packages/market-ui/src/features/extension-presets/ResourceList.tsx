import { createElement as h, useCallback, useId, useMemo, useState, type ReactNode } from 'react'

import { type ExtensionResource } from '../../../../market-contracts/src/contracts/extension-presets.js'
import { TabRail } from '../../ui/TabRail.js'
import { ResourceSurface } from '../../ui/ResourceSurface.js'
import { BilingualToggle } from '../../ui/BilingualToggle.js'
import { displayText } from '../../ui/translated-text.js'
import { useTranslationEnabled } from '../../ui/translation-enabled.js'
import { resourceSelected } from './resource.js'
import type { ExtensionTranslate } from './types.js'
import panel from '../../ui/panel.module.css'
import workspace from '../../workspace/workspace.module.css'
import { useTabLayout, type TabLayoutMessages } from '../../workspace/tab-layout-store.js'
import { visibleTabs, type WorkspaceTabKey } from '../../../../market-contracts/src/contracts/tab-layout.js'
import { PRESET_FACES, WORKSPACE_TAB_META, workspaceKeyOfFace } from '../../workspace/tab-meta.js'
import { surfaceProviderCuts, type SurfaceProvider } from '../../ui/surface-facets.js'
import type { LocaleKey } from '../../locales.js'
// The faces, their labels and the noun each collection is counted in all come from
// the workspace's own metadata: this surface names one collection differently
// (`agents` here, `personas` in the workspace) and that difference lives in one
// field there rather than in four maps here.
const faces = PRESET_FACES
/** Each face's workspace tab key, resolved once from the shared metadata. */
const TAB_KEY = Object.fromEntries(faces.map(face => [face, workspaceKeyOfFace(face)!])) as Record<(typeof faces)[number], WorkspaceTabKey>
/** The face's tab label, or the noun one collection of it is counted in. */
const labelOf = (face: (typeof faces)[number]): LocaleKey => WORKSPACE_TAB_META[TAB_KEY[face]].label
const countOf = (face: (typeof faces)[number]): LocaleKey | undefined => WORKSPACE_TAB_META[TAB_KEY[face]].surface
/**
 * Which provider a preset row came from, in the same terms the workspace tab uses.
 *
 * The inventory carries the answer per face: a suite-owned row names its suite, a direct
 * service or a person's own entry does not, and the two prompt-layer faces encode it in
 * their ids because a style or a file has no owning suite row.
 *
 * @param row - the row, or undefined when the id is unknown.
 * @returns the provider, or undefined when the row is unknown.
 */
function providerOf(row: ExtensionResource | undefined): SurfaceProvider | undefined {
  if (row === undefined) return undefined
  if (row.face === 'market' || row.face === 'hooks') return 'suite'
  if (row.face === 'instructions') return row.id.startsWith('instructions:project/') ? 'suite' : 'user'
  if (row.face === 'outputStyles') return row.id.startsWith('outputStyles:user') ? 'user' : 'suite'
  return row.suiteResourceId !== undefined ? 'suite' : 'user'
}

/**
 * One tab key back to this surface's face, when the surface has that tab.
 *
 * The mapping is the only authority consulted: a face whose name differs from its
 * tab key (`agents` against `personas`) is not a member of the tab-key list, so
 * testing that list first would silently drop the face.
 */
const faceOf = (key: WorkspaceTabKey): (typeof faces)[number] | undefined => (Object.keys(TAB_KEY) as (typeof faces)[number][]).find(face => TAB_KEY[face] === key)
export function ResourceList({
  resources: inventory,
  ids,
  disabled,
  t,
  showOriginal,
  onToggleShowOriginal,
  onToggle,
  onView
}: {
  resources: ExtensionResource[]
  ids: string[]
  disabled: boolean
  t: ExtensionTranslate
  /** True while the authored text shows; the same state the detail dialog reads. */
  showOriginal: boolean
  onToggleShowOriginal: () => void
  onToggle: (row: ExtensionResource, enabled: boolean) => void
  onView: (row: ExtensionResource) => void
}): ReactNode {
  // Keep the first (validated) row if an older server returns duplicate ids. Duplicate React keys leave stale clickable nodes after filtering.
  const seen = new Set<string>()
  const resources = inventory.filter(row => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
  // Market shows only genuine market suites: a project-scan or user-hooks
  // configuration parent renders no card anywhere. Project children ride their
  // own face tabs below.
  const [requestedFace, setFace] = useState<ExtensionResource['face']>('market')
  // The row is the workspace's row, on the same layout, so the order and the
  // stow list a user sets in one place are the ones the other renders.
  const layoutMessages = useMemo<TabLayoutMessages>(
    () => ({
      load: (error: unknown) => t('tabLayoutLoadFailed', { error: error instanceof Error ? error.message : String(error) }),
      write: (error: unknown) => t('tabLayoutWriteFailed', { error: error instanceof Error ? error.message : String(error) })
    }),
    [t]
  )
  const { state: layoutState, move: applyTabMoveTo } = useTabLayout(layoutMessages)
  const layout = layoutState.layout
  // This surface's faces, in the shared order, with the active one always kept.
  const orderedFaces = visibleTabs(layout.order, layout, TAB_KEY[requestedFace])
    .map(faceOf)
    .filter((value): value is (typeof faces)[number] => value !== undefined)
  const face = orderedFaces.includes(requestedFace) ? requestedFace : (orderedFaces[0] ?? 'market')
  /** Stow or reveal one face, leaving the keys this surface cannot show alone. */
  /** Move one face by mapping the rendered positions back onto their keys. */
  const moveFace = useCallback(
    (from: number, to: number) => {
      const moving = orderedFaces[from]
      const landing = orderedFaces[to]
      if (moving === undefined || landing === undefined) return
      applyTabMoveTo(TAB_KEY[moving], TAB_KEY[landing])
    },
    [applyTabMoveTo, orderedFaces]
  )
  const id = useId()
  const selected = (row: ExtensionResource) => row.available && resourceSelected(row, ids)
  const rows = resources.filter(row => row.face === face && row.configuration === undefined)
  const displayName = (row: ExtensionResource) => (row.configuration === 'user-hooks' ? t('epUserHooks') : row.name)
  // One rule for every description on this surface, the same one the settings
  // panels resolve through: the translation when it exists, the authored text
  // otherwise, and the authored text under the panel-wide original view.
  const enabled = useTranslationEnabled()
  const displayDescription = (row: ExtensionResource) => displayText(row.translatedDescription, row.description, t, { original: !enabled || showOriginal })
  const controlled = (row: ExtensionResource) => row.available && row.control !== 'global-only' && row.followsSuite !== true && !disabled
  // The owner tag mirrors each settings face's own mapping: a market row is an
  // installed user-dimension suite (extension-inventory.ts), a panel entry with
  // no owning suite is the user's own file, and an MCP or LSP row with no owning
  // suite is a directly declared service. Hook rows keep their own card.
  const ownerLabel = (row: ExtensionResource): string => {
    // An instruction file names its root in the id, so the tag says which half of the
    // chain it belongs to instead of borrowing a suite's vocabulary.
    if (row.face === 'instructions')
      return row.id.startsWith('instructions:project/') ? t(labelOf('instructions')) + ' · ' + t('epScopeProject') : t(labelOf('instructions')) + ' · ' + t('epScopeGlobal')
    if (row.face === 'market') return t('panelSourceUser')
    // A style has no suite child row: its own source says whether a person wrote it or a
    // suite brought it. Falling through to the child-row test labelled every suite style
    // 用户, because a style never carries suiteResourceId.
    if (row.face === 'outputStyles') return row.source === 'user' ? t('panelSourceUser') : t('panelSourcePlugin')
    if (row.face === 'mcp') return row.suiteResourceId === undefined ? t('mcpDirect') : t('mcpPlugin')
    if (row.face === 'lsp') return row.suiteResourceId === undefined ? t('lspDirect') : t('lspPlugin')
    return row.suiteResourceId === undefined ? t('panelSourceUser') : t('panelSourcePlugin')
  }
  const hints = (row: ExtensionResource) =>
    row.control === 'global-only'
      ? row.unavailableReason === 'hook-event-partial'
        ? t('epHookEventPartial')
        : row.unavailableReason === 'hook-event-unsupported'
          ? t('epHookEventUnsupported')
          : t('epGlobalManaged')
      : row.unavailableReason === 'instructions-no-switch'
        ? t('epInstructionsNoSwitch')
        : row.unavailableReason === 'style-uncaptured'
          ? t('epStyleUncaptured')
          : (row.unavailableReason ?? t(row.configuration ? 'epConfigurationUnavailable' : 'epUnavailable'))
  // One entry per row; the renderer owns the toolbar, the collection and the card.
  const rowById = new Map(rows.map(row => [row.id, row]))
  const selectedById = (rowId: string): boolean => {
    const row = rowById.get(rowId)
    return row !== undefined && selected(row)
  }
  const entries = rows.map(row => ({
    id: row.id,
    name: displayName(row),
    hint: row.version,
    mono: row.face === 'commands',
    tag: ownerLabel(row),
    description: displayDescription(row),
    // A row with no switch still shows whether the host has it on.
    meta: row.control === 'global-only' ? row.source + ' · ' + t(selected(row) ? 'epOn' : 'epOff') : row.source,
    counts:
      row.face === 'market'
        ? faces
            // A face without a count noun is the market itself: the row is the market,
            // so it does not count itself.
            .flatMap(value => {
              const label = countOf(value)
              return label === undefined ? [] : [{ label: t(label), count: resources.filter(child => child.suiteResourceId === row.id && child.face === value).length }]
            })
            .filter(item => item.count > 0)
        : undefined,
    warning: !row.available || row.control === 'global-only' ? hints(row) : undefined,
    // A row the host manages globally has no switch of its own, and an instruction file
    // has none at all: the card says why instead.
    hideToggle: row.control === 'global-only' || row.unavailableReason === 'instructions-no-switch',
    // Off rows wear the quiet chrome; unavailable ones wear the warning chrome.
    state: !row.available ? (row.control === 'global-only' ? ('disabled' as const) : ('warning' as const)) : selected(row) ? ('active' as const) : ('disabled' as const),
    // The rail is colour only; this is what a screen reader hears. An instruction file
    // has no on/off switch, so it says whether the host injects it rather than borrowing
    // the vocabulary of the switches beside it.
    stateLabel:
      row.face === 'instructions'
        ? t(row.available ? 'epInstructionInjected' : 'epInstructionNotInjected')
        : !row.available
          ? t('stateUnavailable')
          : selected(row)
            ? t('enabledLabel')
            : t('disabledLabel'),
    // The switch's verb, so the control is not announced as the resource's name a second
    // time. Hidden rows have no switch to label.
    ...(row.control === 'global-only' || row.unavailableReason === 'instructions-no-switch' ? {} : { toggleLabel: selected(row) ? t('disable') : t('enable') })
  }))
  return (
    <div className={workspace.workspace}>
      <TabRail
        value={face}
        onChange={value => {
          if (faces.includes(value)) setFace(value)
        }}
        label={t('epTitle')}
        stepPreviousLabel={t('tabStepPrevious')}
        stepNextLabel={t('tabStepNext')}
        onReorder={moveFace}
        items={orderedFaces.map(value => ({ value, text: t(labelOf(value)), id: id + '-' + value, panelId: id + '-' + value + '-panel' }))}
      />
      {/* A preset holds switches for what a suite installs. The prompt layer has no switch
          to hold — an AGENTS.md file is injected because it exists — so this row is two tabs
          shorter than the workspace's by design, and says which two. */}
      <p className={panel.subtitle} data-preset-faces-note>
        {t('epFacesNote')}
      </p>
      <div className={panel.shell} role="tabpanel" id={id + '-' + face + '-panel'} aria-labelledby={id + '-' + face}>
        <ResourceSurface
          t={t}
          entries={entries}
          capabilities={{ toggle: true, counts: true }}
          searchLabel={t('epSearch')}
          searchPlaceholder={t('epSearchPlaceholder')}
          // The same facet the workspace tab offers, from the same table: whether a card is
          // switched on is what its rail and its state word already say, and this surface
          // and the settings page must not disagree about what a filter is.
          filters={surfaceProviderCuts(TAB_KEY[face], t, id => providerOf(rowById.get(id)))}
          beforeView={h(BilingualToggle, { t, showOriginal, onToggle: onToggleShowOriginal })}
          emptyText={t('epEmpty')}
          // A card opens the entry; the switch beside it toggles. The view action that used
          // to be an icon on every card is what the card click now does.
          onOpen={entryId => {
            const row = rowById.get(entryId)
            if (row !== undefined) onView(row)
          }}
          onToggle={(entryId, enabled) => {
            const row = rowById.get(entryId)
            if (row !== undefined) onToggle(row, enabled)
          }}
          isOn={entryId => selectedById(entryId)}
          isToggleDisabled={entryId => {
            const row = rowById.get(entryId)
            return row === undefined || !controlled(row)
          }}
        />
      </div>

      {faces
        .filter(value => value !== face)
        .map(value => (
          <div key={value} hidden id={id + '-' + value + '-panel'} role="tabpanel" aria-labelledby={id + '-' + value} />
        ))}
    </div>
  )
}
