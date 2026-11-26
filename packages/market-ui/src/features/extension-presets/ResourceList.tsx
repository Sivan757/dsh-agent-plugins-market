import { createElement as h, useCallback, useId, useMemo, useState, type ReactNode } from 'react'

import { type ExtensionResource } from '../../../../market-contracts/src/contracts/extension-presets.js'
import { TabRail } from '../../ui/TabRail.js'
import { ResourceSurface } from '../../ui/ResourceSurface.js'
import { BilingualToggle } from '../../ui/BilingualToggle.js'
import { useTranslationEnabled } from '../../ui/translation-enabled.js'
import { resourceSelected } from './resource.js'
import type { ExtensionTranslate } from './types.js'
import panel from '../../ui/panel.module.css'
import workspace from '../../workspace/workspace.module.css'
import { useTabLayout, type TabLayoutMessages } from '../../workspace/tab-layout-store.js'
import type { WorkspaceTabKey } from '../../../../market-contracts/src/contracts/tab-layout.js'
import { PRESET_FACES } from '../../workspace/tab-meta.js'
import { surfaceCuts } from '../../ui/surface-facets.js'
import { buildFaceEntry } from '../../ui/face-entry.js'
import { labelOf, PRESET_TAB_KEY, presetRowFacts, providerOf } from './row-facts.js'
// The faces, their labels and the noun each collection is counted in all come from
// the workspace's own metadata: this surface names one collection differently
// (`agents` here, `personas` in the workspace) and that difference lives in one
// field there rather than in four maps here.
const faces = PRESET_FACES

/**
 * One tab key back to this surface's face, when the surface has that tab.
 *
 * The mapping is the only authority consulted: a face whose name differs from its
 * tab key (`agents` against `personas`) is not a member of the tab-key list, so
 * testing that list first would silently drop the face.
 */
const faceOf = (key: WorkspaceTabKey): (typeof faces)[number] | undefined => (Object.keys(PRESET_TAB_KEY) as (typeof faces)[number][]).find(face => PRESET_TAB_KEY[face] === key)
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
  // A preset covers every face, so the manager lists every face: "stowed in the workspace" is a
  // display choice about the workspace tab strip, not a statement that the face has nothing to
  // configure. Stowing it there used to hide its rows from the preset editor too.
  const orderedFaces = layout.order
    .slice()
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
      applyTabMoveTo(PRESET_TAB_KEY[moving], PRESET_TAB_KEY[landing])
    },
    [applyTabMoveTo, orderedFaces]
  )
  const id = useId()
  const selected = (row: ExtensionResource) => row.available && resourceSelected(row, ids)
  const rows = resources.filter(row => row.face === face && row.configuration === undefined)
  // One rule for every description on this surface, the same one the settings
  // panels resolve through: the translation when it exists, the authored text
  // otherwise, and the authored text under the panel-wide original view.
  const enabled = useTranslationEnabled()
  const controlled = (row: ExtensionResource) => row.available && row.control !== 'global-only' && row.followsSuite !== true && !disabled
  // One entry per row; the renderer owns the toolbar, the collection and the card.
  const rowById = new Map(rows.map(row => [row.id, row]))
  const selectedById = (rowId: string): boolean => {
    const row = rowById.get(rowId)
    return row !== undefined && selected(row)
  }
  // The row's facts come from the adapter every preset surface shares, so the
  // manager and the suggestion dialog draw one card from one mapping.
  const factsOf = (row: ExtensionResource) => presetRowFacts({ t, row, resources, on: selected(row), showOriginal, translationEnabled: enabled })
  const entries = rows.map(row => buildFaceEntry(t, factsOf(row), 'resolve'))
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
      <div className={panel.shell} role="tabpanel" id={id + '-' + face + '-panel'} aria-labelledby={id + '-' + face}>
        <ResourceSurface
          t={t}
          entries={entries}
          capabilities={{ toggle: true, counts: true }}
          searchLabel={t('epSearch')}
          searchPlaceholder={t('epSearchPlaceholder')}
          // The same cuts the workspace tab offers, from the same table: the provider
          // facet, plus the market's state facet. This surface and the settings page must
          // not disagree about what a filter is.
          filters={surfaceCuts(PRESET_TAB_KEY[face], t, id => providerOf(rowById.get(id)))}
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
