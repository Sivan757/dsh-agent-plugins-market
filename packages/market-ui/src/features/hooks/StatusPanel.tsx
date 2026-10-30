/**
 * The settings workspace's Hooks panel: the manager's event-grouped presentation
 * in read-only form. Rows come from the sessionless hooks overview route and
 * render through the shared tab row and hook card, whose support Tag stands in
 * for the switch this surface has no right to carry.
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import type { ExtensionTranslate } from '../../i18n.js'
import { fetchHooksOverview } from '../../api.js'
import type { ExtensionDetail, ExtensionResource } from '../../../../market-contracts/src/contracts/extension-presets.js'
import { PanelHeader, PanelActions } from '../../ui/panel.js'
import { ResourceSurface } from '../../ui/ResourceSurface.js'
import { HookDetailModal } from '../../ui/HookDetailModal.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import css from '../mcp/mcp-status.module.css'

/** One hook's detail address, as the shared card opens it. */
type HookDetail = Extract<ExtensionDetail, { kind: 'hook' }>

/** The configured command hooks of both sources, grouped by event, read-only. */
export function HooksStatusPanel({ t }: { t: ExtensionTranslate }): ReactNode {
  const [rows, setRows] = useState<ExtensionResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [detail, setDetail] = useState<HookDetail | undefined>(undefined)

  const refresh = (): void => {
    setLoading(true)
    setError(undefined)
    fetchHooksOverview()
      .then(next => setRows(next.rows))
      .catch(caught => setError(clientErrorMessage(t, caught)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
  }, [])

  const limited = (row: ExtensionResource): boolean => row.control === 'global-only'
  // One opener for the whole panel: the card reports the row, and the detail
  // comes from that row's own address, so no other hook can be opened here.
  const openDetail = (row: ExtensionResource): void => {
    if (row.detail.kind === 'hook') setDetail(row.detail)
  }

  return h(
    'div',
    { className: css.surface },
    h(PanelHeader, {
      subtitle: t('hooksPanelSubtitle'),
      actions: h(PanelActions, { refreshLabel: t('refresh'), onRefresh: refresh, busy: loading })
    }),
    error === undefined ? null : h('div', { className: css.error, role: 'status' }, error),
    // The shared renderer draws the list; this panel only supplies entries and the detail.
    h(ResourceSurface, {
      t,
      entries: rows.map(row => ({
        id: row.id,
        name: row.name,
        // The tag names the stage; the support verdict is the warning below it.
        tag: row.description,
        // The authored command is what this row is; the stage is the tag.
        description: row.detail.kind === 'hook' ? row.detail.command : row.description,
        warning: limited(row) ? t(row.unavailableReason === 'hook-event-partial' ? 'hooksEventPartial' : 'hooksEventUnsupported') : undefined,
        meta: row.source,
        state: limited(row) ? ('warning' as const) : ('active' as const),
        // This surface cannot switch a hook: the declaration belongs to its suite.
        hideToggle: true
      })),
      searchLabel: t('hooksPanelSearch'),
      searchPlaceholder: t('hooksPanelSearch'),
      // No tabs: "supported" equals "all" whenever nothing is limited, and the
      // card's own warning already says why a row is limited.
      emptyText: loading && rows.length === 0 ? t('loading') : t('hooksPanelEmpty'),
      onOpen: rowId => {
        const row = rows.find(item => item.id === rowId)
        if (row !== undefined) openDetail(row)
      }
    }),
    detail === undefined ? null : h(HookDetailModal, { detail, t, onClose: () => setDetail(undefined) })
  )
}
