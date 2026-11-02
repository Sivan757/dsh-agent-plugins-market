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
import { PanelHeader, PanelActions, ReadFailed } from '../../ui/panel.js'
import { ResourceSurface } from '../../ui/ResourceSurface.js'
import { HookDetailModal } from '../../ui/HookDetailModal.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import css from '../mcp/mcp-status.module.css'

/** One hook's detail address, as the shared card opens it. */
type HookDetail = Extract<ExtensionDetail, { kind: 'hook' }>

/**
 * A hook command as a card shows it.
 *
 * The command is the row's identity, but an absolute interpreter path eats the line: the
 * one long value says where the script happens to live rather than what runs. This keeps
 * the leading words and shortens every absolute path to its last two segments.
 *
 * @param command - the authored command line.
 * @returns the same command with long paths abbreviated.
 */
function commandForCard(command: string): string {
  return command.replace(/((?:\/[^\s"']+){2,})/gu, path => {
    const segments = path.split('/').filter(Boolean)
    return segments.length <= 2 ? path : '…/' + segments.slice(-2).join('/')
  })
}

/**
 * The name a hook card leads with.
 *
 * A hook's identity for a reader is the script it runs, not the interpreter line that
 * invokes it: the command is an absolute path and it was the card's title, so every row led
 * with a mount point. This takes the last segment of the path the command runs, and falls
 * back to the command's first word when it runs no file.
 *
 * @param command - the authored command line.
 * @returns the script's file name, or the command's leading word.
 */
function scriptNameOf(command: string): string {
  const path = /(?:\/[^\s"']+)+/u.exec(command)?.[0]
  if (path !== undefined) return path.split('/').filter(Boolean).pop() ?? path
  return command.trim().split(/\s+/u)[0] ?? command
}

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
    error === undefined ? null : h(ReadFailed, { message: error, retryLabel: t('readRetry'), onRetry: refresh }),
    // The shared renderer draws the list; this panel only supplies entries and the detail.
    h(ResourceSurface, {
      t,
      entries: rows.map(row => ({
        id: row.id,
        // The script the row runs is what a reader recognizes; the command that invokes it
        // is the body. `name` on the payload is the command, so the title is derived here.
        name: row.detail.kind === 'hook' && row.detail.command !== undefined ? scriptNameOf(row.detail.command) : row.name,
        hint: row.detail.kind === 'hook' && row.detail.command !== undefined ? row.name : undefined,
        // The tag names the stage; the support verdict is the warning below it.
        tag: row.description,
        // The authored command is what this row is; the stage is the tag. A hook command
        // that points at a script is mostly an absolute path, so the card shows only the
        // command and the file it runs: the whole line lives in the detail's declaration row,
        // and a card body is one line to scan, not a mount point to read.
        description: row.detail.kind === 'hook' && row.detail.command !== undefined ? commandForCard(row.detail.command) : row.description,
        warning: limited(row) ? t(row.unavailableReason === 'hook-event-partial' ? 'hooksEventPartial' : 'hooksEventUnsupported') : undefined,
        meta: row.source,
        state: limited(row) ? ('warning' as const) : ('active' as const),
        // The rail is colour only; this is what a screen reader hears, and the
        // warning line on a limited row says why.
        stateLabel: limited(row) ? t('hookStateLimited') : t('hooksFilterSupported'),
        // This surface cannot switch a hook: the declaration belongs to its suite.
        hideToggle: true
      })),
      searchLabel: t('hooksPanelSearch'),
      searchPlaceholder: t('hooksPanelSearch'),
      // No tabs: "supported" equals "all" whenever nothing is limited, and the
      // card's own warning already says why a row is limited.
      emptyText: error !== undefined && rows.length === 0 ? t('statusUnreadable') : loading && rows.length === 0 ? t('loading') : t('hooksPanelEmpty'),
      onOpen: rowId => {
        const row = rows.find(item => item.id === rowId)
        if (row !== undefined) openDetail(row)
      }
    }),
    detail === undefined ? null : h(HookDetailModal, { detail, t, onClose: () => setDetail(undefined) })
  )
}
