import { createElement as h, useCallback, useId, useMemo, useState, type ReactNode } from 'react'
import { Button, IconInfoOutlineMedium, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { type ExtensionResource } from '../../../../market-contracts/src/contracts/extension-presets.js'
import { CardCount, CardIdentity, CardWarning, ResourceCard, ResourceCollection, interactiveCardProps } from '../../ui/ResourceCard.js'
import { TabRail } from '../../ui/TabRail.js'
import { HookResourceCard } from '../../ui/HookResourceCard.js'
import { SearchFilterToolbar } from '../../ui/SearchFilterToolbar.js'
import { BilingualToggle } from '../../ui/BilingualToggle.js'
import { displayText } from '../../ui/translated-text.js'
import { useTranslationEnabled } from '../../ui/translation-enabled.js'
import { useWorkspaceView } from '../../ui/workspace-view.js'
import { resourceSelected } from './resource.js'
import type { ExtensionTranslate } from './types.js'
import rc from '../../ui/resource-card.module.css'
import css from './presets.module.css'
import panel from '../../ui/panel.module.css'
import workspace from '../../workspace/workspace.module.css'
import { TabStowControl } from '../../workspace/TabStowControl.js'
import { useTabLayout, type TabLayoutMessages } from '../../workspace/tab-layout-store.js'
import { visibleTabs, type WorkspaceTabKey } from '../../../../market-contracts/src/contracts/tab-layout.js'
import { hoverHint } from '../../ui/hover-hint.js'
const faces = ['market', 'skills', 'commands', 'agents', 'mcp', 'lsp', 'hooks'] as const
const labels = {
  market: 'workspaceTabMarket',
  skills: 'workspaceTabSkills',
  commands: 'workspaceTabCommands',
  agents: 'workspaceTabPersonas',
  mcp: 'workspaceTabMcp',
  lsp: 'workspaceTabLsp',
  hooks: 'epHooksTab'
} as const
const countLabels = { skills: 'surfaceSkills', commands: 'surfaceCommands', agents: 'surfaceAgents', mcp: 'surfaceMcp', lsp: 'surfaceLsp', hooks: 'surfaceHooks' } as const
/**
 * Each face's workspace tab key.
 *
 * The two lists name one collection differently: this surface's `agents` face is
 * the workspace's `personas` tab. The layout is shared, so the mapping has to be
 * stated once here rather than assumed.
 */
const TAB_KEY: Record<(typeof faces)[number], WorkspaceTabKey> = {
  market: 'market',
  skills: 'skills',
  commands: 'commands',
  agents: 'personas',
  mcp: 'mcp',
  lsp: 'lsp',
  hooks: 'hooks'
} as const
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
  const [managing, setManaging] = useState(false)
  // The row is the workspace's row, on the same layout, so the order and the
  // stow list a user sets in one place are the ones the other renders.
  const layoutMessages = useMemo<TabLayoutMessages>(
    () => ({
      load: (error: unknown) => t('tabLayoutLoadFailed', { error: error instanceof Error ? error.message : String(error) }),
      write: (error: unknown) => t('tabLayoutWriteFailed', { error: error instanceof Error ? error.message : String(error) })
    }),
    [t]
  )
  const { state: layoutState, stow: applyStowList, move: applyTabMoveTo } = useTabLayout(layoutMessages)
  const layout = layoutState.layout
  // This surface's faces, in the shared order, with the active one always kept.
  const orderedFaces = visibleTabs(layout.order, layout, TAB_KEY[requestedFace])
    .map(faceOf)
    .filter((value): value is (typeof faces)[number] => value !== undefined)
  const face = orderedFaces.includes(requestedFace) ? requestedFace : (orderedFaces[0] ?? 'market')
  /** Stow or reveal one face, leaving the keys this surface cannot show alone. */
  const stowFaces = useCallback(
    (next: readonly string[]) => {
      const mine = new Set<string>(faces.map(item => TAB_KEY[item]))
      const elsewhere = layout.hidden.filter(key => !mine.has(key))
      applyStowList([...elsewhere, ...next.filter(key => mine.has(key))])
    },
    [applyStowList, layout.hidden]
  )
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
  const [filter, setFilter] = useState('all'),
    [query, setQuery] = useState('')
  const [view, setView] = useWorkspaceView()
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
    if (row.face === 'market') return t('panelSourceUser')
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
      : (row.unavailableReason ?? t(row.configuration ? 'epConfigurationUnavailable' : 'epUnavailable'))
  // The Hooks face lists every event together: the stage travels on each card,
  // so no tab row hides the other events.
  const filtered = rows.filter(
    row =>
      (filter === 'all' || (filter === 'on') === selected(row)) &&
      // Both texts stay searchable: a reader who saw the translation can still
      // find the row after flipping to the authored text, and the reverse.
      (displayName(row) + ' ' + row.name + ' ' + (row.description ?? '') + ' ' + (row.translatedDescription ?? '') + ' ' + row.source).toLowerCase().includes(query.toLowerCase())
  )
  const stopClick = (event: import('react').MouseEvent) => event.stopPropagation()
  const stopKey = (event: import('react').KeyboardEvent) => event.stopPropagation()
  return (
    <div className={workspace.workspace}>
      <TabRail
        value={face}
        onChange={value => {
          if (faces.includes(value)) setFace(value)
        }}
        label={t('epTitle')}
        items={orderedFaces.map(value => ({ value, text: t(labels[value]), id: id + '-' + value, panelId: id + '-' + value + '-panel' }))}
        onReorder={moveFace}
        trailing={
          <TabStowControl
            t={t}
            tabs={orderedFaces.map(value => ({ key: TAB_KEY[value], label: t(labels[value]) }))}
            visible={orderedFaces.map(value => TAB_KEY[value])}
            hidden={layout.hidden.filter(key => orderedFaces.some(value => TAB_KEY[value] === key))}
            busy={layoutState.busy}
            error={layoutState.error}
            onSelect={key => {
              const next = faceOf(key as WorkspaceTabKey)
              if (next !== undefined) setFace(next)
            }}
            onStow={stowFaces}
            onReorder={moveFace}
            manageOpen={managing}
            onManageOpenChange={setManaging}
          />
        }
      />
      <div className={panel.shell} role="tabpanel" id={id + '-' + face + '-panel'} aria-labelledby={id + '-' + face}>
        <SearchFilterToolbar
          search={query}
          onSearchChange={setQuery}
          searchLabel={t('epSearch')}
          searchPlaceholder={t('epSearchPlaceholder')}
          filterId={id + '-filter'}
          filterLabel={t('epSearch')}
          filters={['all', 'on', 'off'].map(value => ({
            id: value,
            label: t(value === 'all' ? 'epAll' : value === 'on' ? 'epOn' : 'epOff'),
            count: rows.filter(row => value === 'all' || (value === 'on') === selected(row)).length,
            active: filter === value,
            onSelect: () => setFilter(value)
          }))}
          view={view}
          onViewChange={setView}
          toListLabel={t('epList')}
          toGridLabel={t('epGrid')}
          beforeView={h(BilingualToggle, { t, showOriginal, onToggle: onToggleShowOriginal })}
        />
        <div className={css.listRegion} role="tabpanel" id={id + '-filter-' + filter + '-panel'} aria-labelledby={id + '-filter-' + filter}>
          <ResourceCollection view={view}>
            {filtered.map(row => {
              const description = displayDescription(row)
              return row.face === 'hooks' ? (
                <HookResourceCard
                  key={row.id}
                  row={row}
                  t={t}
                  state={!row.available ? (row.control === 'global-only' ? 'disabled' : 'warning') : selected(row) ? 'active' : 'disabled'}
                  {...(row.followsSuite === true
                    ? {}
                    : { toggle: { selected: selected(row), disabled: !controlled(row), onChange: (enabled: boolean) => onToggle(row, enabled) } })}
                  onView={onView}
                />
              ) : (
                <ResourceCard
                  key={row.id}
                  data-resource-id={row.id}
                  surface={row.face === 'agents' ? 'personas' : row.face}
                  state={!row.available ? (row.control === 'global-only' ? 'disabled' : 'warning') : selected(row) ? 'active' : 'disabled'}
                  {...(controlled(row) ? { ...interactiveCardProps(() => onToggle(row, !selected(row))), 'aria-pressed': selected(row), 'aria-label': displayName(row) } : {})}
                >
                  <CardIdentity text={row.name} mono={row.face === 'commands'} version={row.version} tag={ownerLabel(row)} />
                  {description === undefined || description === '' ? null : hoverHint(description, h('p', { className: rc.rowBody + ' ' + rc.desc }, description))}
                  <div className={rc.rowFoot}>
                    {hoverHint(row.source, h('span', { className: rc.provenance }, row.source))}
                    {row.face === 'market' &&
                      faces
                        .filter(value => value !== 'market')
                        .map(value => {
                          const count = resources.filter(child => child.suiteResourceId === row.id && child.face === value).length
                          return count ? h(CardCount, { key: value, label: t(countLabels[value]), count }) : null
                        })}
                    {(!row.available || row.control === 'global-only') &&
                      h(CardWarning, {
                        text: t(row.control === 'global-only' ? 'epGlobalManagedShort' : 'epUnavailable'),
                        label: hints(row),
                        tone: row.control === 'global-only' ? 'quiet' : 'warning',
                        side: 'top',
                        portal: true,
                        interactive: true
                      })}
                  </div>
                  <div className={rc.rowActions} onClick={stopClick} onKeyDown={stopKey} onKeyUp={stopKey}>
                    <Button size="sm" variant="ghost" className={rc.iconBtn} aria-label={t('epView') + ' · ' + displayName(row)} onClick={() => onView(row)}>
                      <IconInfoOutlineMedium size={16} />
                    </Button>
                    {row.control === 'global-only' ? (
                      <Tag tone="quiet">{t(selected(row) ? 'epOn' : 'epOff')}</Tag>
                    ) : (
                      <span className={rc.switchWrap}>
                        <Switch checked={selected(row)} disabled={!controlled(row)} label={displayName(row)} onChange={on => onToggle(row, on)} />
                      </span>
                    )}
                  </div>
                </ResourceCard>
              )
            })}
          </ResourceCollection>
          {!filtered.length && (
            <div className={panel.empty} role="status">
              {t('epEmpty')}
            </div>
          )}
        </div>
        {['all', 'on', 'off']
          .filter(value => value !== filter)
          .map(value => (
            <div key={value} hidden id={id + '-filter-' + value + '-panel'} role="tabpanel" aria-labelledby={id + '-filter-' + value} />
          ))}
      </div>
      {faces
        .filter(value => value !== face)
        .map(value => (
          <div key={value} hidden id={id + '-' + value + '-panel'} role="tabpanel" aria-labelledby={id + '-' + value} />
        ))}
    </div>
  )
}
