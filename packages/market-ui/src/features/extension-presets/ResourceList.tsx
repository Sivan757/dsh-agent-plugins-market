import { createElement as h, useId, useState, type ReactNode } from 'react'
import { Button, IconInfoOutlineMedium, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { type ExtensionResource } from '../../../../market-contracts/src/contracts/extension-presets.js'
import { CardCount, CardIdentity, CardWarning, ResourceCard, ResourceCollection, interactiveCardProps } from '../../ui/ResourceCard.js'
import { ResourceTabs } from '../../ui/ResourceTabs.js'
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
  const face = faces.includes(requestedFace) ? requestedFace : 'market'
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
      <ResourceTabs
        value={face}
        onChange={value => {
          if (faces.includes(value)) setFace(value)
        }}
        label={t('epTitle')}
        items={faces.map(value => ({ value, text: t(labels[value]), id: id + '-' + value, panelId: id + '-' + value + '-panel' }))}
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
