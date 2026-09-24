/**
 * The Agent Plugins Market settings section.
 *
 * Layout: repository sources run along the TOP as chips (全部 first), with
 * edit-current / add / refresh-all controls on the right; below sit search,
 * status tabs, and the card grid. Colors ride the dsh --dsw-alias-* tokens
 * with light-mode fallbacks so the page follows the active theme.
 */
import { createElement as h, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Modal, RiskConfirmation, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { postAction, type OverviewData, type SuiteCardData } from '../../api.js'
import { loadOverview, invalidateOverview, startSourceProgressPolling, type SourceProgressState } from '../../features/market/market-resource.js'
import { deriveMarketViewModel, type MarketCategory, type MarketFilter } from '../../features/market/market-view-model.js'
import { SourceTabsRow, type SourceTabItem } from '../../features/market/SourceTabsRow.js'
import { SourceEditorModal, type EditorState } from '../../features/market/SourceEditorModal.js'
import { InstallConfirmModal, type InstallConfirmState } from '../../features/market/InstallConfirmModal.js'
import { SuiteCard } from '../../features/market/SuiteCard.js'
import type { Translate } from '../../index.js'
import { ErrorBoundary } from '../../ErrorBoundary.js'
import { SuiteDetailModal } from './SuiteDetail.js'
import { SearchFilterToolbar } from '../../ui/SearchFilterToolbar.js'
import { BusyIndicator } from '../../ui/panel.js'
import css from './market.module.css'
import { useWorkspaceView } from '../../ui/workspace-view.js'
import { PanelHeader, PanelActions } from '../../ui/panel.js'
import { ResourceCollection } from '../../ui/ResourceCard.js'
import { clientErrorMessage } from '../../ui/error-message.js'

/** Host step keys -> translation keys, resolved against the active t(). */
const PROGRESS_STEP_LABELS: Record<string, string> = {
  cloning: 'progressCloning',
  downloading: 'progressDownloading',
  reading: 'progressReading'
}

export interface MarketSectionProps {
  t: Translate
  /** The host surface controls only outer spacing; data and actions stay shared. */
  mode?: 'settings' | 'page'
}

type Tab = MarketFilter
type Category = MarketCategory

interface ToastState {
  key: number
  message: string
}

interface ConfirmState {
  kind: 'uninstall' | 'removeSource'
  sourceId: string
  suiteId?: string
  /** removeSource only: also physically delete the managed checkout. */
  deleteCheckout: boolean
}

function progressStepLabel(t: Translate, step: string): string {
  const key = PROGRESS_STEP_LABELS[step]
  return key === undefined ? step : t(key as Parameters<Translate>[0])
}

export function MarketSection({ t, mode = 'settings' }: MarketSectionProps): ReactNode {
  const [overview, setOverview] = useState<OverviewData>(() => loadOverview().initial)
  const [loading, setLoading] = useState(() => loadOverview().revalidating)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [category, setCategory] = useState<Category>('all')
  const [view, setView] = useWorkspaceView()
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [toast, setToast] = useState<ToastState | undefined>(undefined)
  const [confirm, setConfirm] = useState<ConfirmState | undefined>(undefined)
  const [installConfirm, setInstallConfirm] = useState<InstallConfirmState | undefined>(undefined)
  const [editor, setEditor] = useState<EditorState>(undefined)
  // The whole card record, so the detail dialog can offer the same install and
  // uninstall actions the card does.
  const [detail, setDetail] = useState<SuiteCardData | undefined>(undefined)
  const [progress, setProgress] = useState<SourceProgressState>({ step: undefined, error: undefined })
  // The irreversible uninstall is gated behind the host's risk acknowledgement.
  const [uninstallAck, setUninstallAck] = useState(false)

  const refresh = useCallback(async () => {
    invalidateOverview()
    try {
      const data = await loadOverview().promise
      setOverview(data)
    } catch {
      setToast({ key: Date.now(), message: t('loadFail') })
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const action = useCallback(
    async (key: string, path: string, body: Record<string, unknown>): Promise<boolean> => {
      setBusy(key)
      try {
        await postAction(path, body)
        invalidateOverview()
        await refresh()
        return true
      } catch (error) {
        setToast({ key: Date.now(), message: `${t('actionFail')}: ${clientErrorMessage(t, error)}` })
        return false
      } finally {
        setBusy(undefined)
      }
    },
    [refresh, t]
  )

  const viewModel = useMemo(() => deriveMarketViewModel(overview, search, tab, category), [overview, search, tab, category])
  const { scopeTotals, filtered } = viewModel

  const openUninstall = useCallback((suite: SuiteCardData) => {
    setUninstallAck(false)
    setConfirm({ kind: 'uninstall', sourceId: suite.sourceId, suiteId: suite.suiteId, deleteCheckout: false })
  }, [])

  const confirmAction = useCallback(async () => {
    if (confirm === undefined) return
    if (confirm.kind === 'uninstall' && confirm.suiteId !== undefined) {
      await action(`u:${confirm.suiteId}`, 'uninstall', { sourceId: confirm.sourceId, suiteId: confirm.suiteId })
    } else if (confirm.kind === 'removeSource') {
      // deleteCheckout physically removes self-acquired checkouts (the host
      // still protects adopted/local directories), so the removed source
      // does not reappear as an "unmanaged checkout" entry.
      await action(`s:${confirm.sourceId}`, 'sources/remove', { id: confirm.sourceId, deleteCheckout: confirm.deleteCheckout })
      if (category === confirm.sourceId) setCategory('all')
    }
    setConfirm(undefined)
  }, [confirm, action, category])

  const selectedSource = category === 'all' ? undefined : overview.sources.find(source => source.id === category)

  // Chips read `全部` first, then the selected source, then every other source
  // by id: picking a source keeps it in view once the strip folds, and the
  // rest of the strip never reshuffles. Kind badges are limited to
  // `本地`/`压缩包`; an adopted checkout is an implementation detail, not a
  // user-facing state.
  const sourceItems = useMemo<SourceTabItem[]>(() => {
    const sorted = [...overview.sources].sort((a, b) => a.id.localeCompare(b.id))
    const ordered =
      selectedSource === undefined ? sorted : [selectedSource, ...sorted.filter(source => source.id !== selectedSource.id)]
    return [
      { id: 'all', label: `${t('tabAll')} ${overview.totals.all}` },
      ...ordered.map(source => {
        const notes = source.scanNotes ?? []
        const noteHint = notes.length === 0 ? undefined : `${t('scanNotes')}: ${notes.slice(0, 8).join(t('sourceErrorSeparator'))}`
        const kindBadge = source.local === true ? t('sourceLocal') : source.kind === 'archive' ? t('sourceArchive') : undefined
        return {
          id: source.id,
          label: `${source.id}${kindBadge === undefined ? '' : ` · ${kindBadge}`} ${source.suiteIds.length}${source.cloned === false || notes.length > 0 ? ' ⚠' : ''}`,
          ...(noteHint === undefined ? {} : { title: noteHint }),
          editable: selectedSource?.id === source.id,
          deletable: true
        }
      })
    ]
  }, [overview.sources, overview.totals.all, selectedSource, t])

  const adoptSource = useCallback(
    async (id: string) => {
      await action(`s:adopt:${id}`, 'sources/adopt', { id })
    },
    [action]
  )
  const unmanaged = overview.unmanaged ?? []

  return h(ErrorBoundary, {
    fallback: error => h('div', { className: css.empty }, `${t('actionFail')}: ${error.message}`),
    children: h(
      'div',
      { className: mode === 'page' ? `${css.market} ${css.pageMode}` : css.market },
      h(
        'div',
        { className: css.header },
        h(PanelHeader, { title: t('nav'), actions: h(PanelActions, { addLabel: t('addSource'), onAdd: () => setEditor({ mode: 'add' }), refreshLabel: t('refreshAll'), onRefresh: () => { void action('s:refresh:all', 'sources/refresh', {}) }, busy: busy !== undefined }) }),
        h(
          'div',
          { className: css.marketControls },
          h(SourceTabsRow, {
            t,
            items: sourceItems,
            activeId: category,
            onSelect: setCategory,
            onDelete: id => setConfirm({ kind: 'removeSource', sourceId: id, deleteCheckout: true }),
            onEdit: id => {
              const source = overview.sources.find(entry => entry.id === id)
              if (source !== undefined) setEditor({ mode: 'edit', source })
            }
          }),
          unmanaged.length === 0
            ? null
            : h(
                'div',
                { className: css.unmanagedRow },
                h('span', { className: css.unmanagedLabel }, t('unmanagedTitle')),
                ...unmanaged.map(entry =>
                  h(
                    'span',
                    { key: entry.id, className: css.unmanagedChip, title: entry.url ?? t('unmanagedNoRemote') },
                    h('span', { className: css.unmanagedChipName }, entry.id),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: css.unmanagedAdopt,
                        disabled: busy !== undefined,
                        title: t('unmanagedAdopt'),
                        onClick: () => {
                          void adoptSource(entry.id)
                        }
                      },
                      '＋'
                    )
                  )
                )
              ),
          h(SearchFilterToolbar, {
            search,
            searchLabel: t('searchPh'),
            searchPlaceholder: t('searchPh'),
            onSearchChange: setSearch,
            filters: [
              { id: 'all', label: t('tabAll'), count: scopeTotals.all, active: tab === 'all', onSelect: () => setTab('all') },
              {
                id: 'installed',
                label: t('tabInstalled'),
                count: scopeTotals.installed,
                active: tab === 'installed',
                onSelect: () => setTab('installed')
              },
              {
                id: 'uninstalled',
                label: t('tabUninstalled'),
                count: scopeTotals.all - scopeTotals.installed,
                active: tab === 'uninstalled',
                onSelect: () => setTab('uninstalled')
              }
            ],
            view,
            toListLabel: t('switchToList'),
            toGridLabel: t('switchToGrid'),
            onViewChange: nextView => setView(nextView)
          })
        )
      ),
      // Keep the global mask until both the mutation and list refresh finish.
      busy !== undefined ? h(BusyIndicator, { overlay: true, label: t('panelWorking') }) : null,
      h(
        ResourceCollection,
        { view },
        loading
          ? h('div', { className: css.empty }, t('loading'))
          : filtered.length === 0
            ? h('div', { className: css.empty }, tab === 'installed' ? t('installedEmpty') : t('empty'))
            : filtered.map(suite =>
                h(SuiteCard, {
                  key: `${suite.sourceId}/${suite.suiteId}`,
                  t,
                  suite,
                  busy: busy !== undefined,
                  onOpen: () => setDetail(suite),
                  onInstall: () => {
                    const source = overview.sources.find(entry => entry.id === suite.sourceId)
                    setInstallConfirm({
                      suite,
                      ...(source?.lockCommit === undefined ? {} : { lockCommit: source.lockCommit }),
                      ...(source?.local === true ? { localSource: true } : {})
                    })
                  },
                  onAddSource: () => {
                    if (suite.remoteUrl !== undefined) void action(`a:${suite.suiteId}`, 'sources/add', { url: suite.remoteUrl })
                  },
                  onToggle: () => {
                    void action(`e:${suite.suiteId}`, 'set-enabled', { sourceId: suite.sourceId, suiteId: suite.suiteId, enabled: !suite.enabled })
                  },
                  onRefresh: () => {
                    void action(`r:${suite.suiteId}`, 'sources/refresh', { id: suite.sourceId })
                  },
                  onUninstall: () => openUninstall(suite)
                })
              )
      ),
      toast === undefined ? null : h(Toast, { key: toast.key, text: toast.message, onDone: () => setToast(undefined) }),
      installConfirm === undefined
        ? null
        : h(InstallConfirmModal, {
            t,
            state: installConfirm,
            busy: busy !== undefined,
            onClose: () => setInstallConfirm(undefined),
            onConfirm: async () => {
              const ok = await action(`i:${installConfirm.suite.suiteId}`, 'install', {
                sourceId: installConfirm.suite.sourceId,
                suiteId: installConfirm.suite.suiteId
              })
              if (ok) setInstallConfirm(undefined)
              return ok
            }
          }),
      // Removing a source also chooses whether the managed checkout goes with
      // it, which is a choice rather than an acknowledgement, so it keeps the
      // plain confirm; uninstall has nothing to choose and takes the host's
      // risk acknowledgement instead.
      confirm !== undefined && confirm.kind === 'removeSource'
        ? h(Modal, {
            open: true,
            onClose: () => setConfirm(undefined),
            title: t('removeSourceConfirmTitle', { sourceId: confirm.sourceId }),
            closeLabel: t('cancel'),
            description: t('removeSourceConfirmDesc'),
            children: h(
              'label',
              { className: css.confirmCheck },
              h('input', {
                type: 'checkbox',
                checked: confirm.deleteCheckout,
                onChange: event =>
                  setConfirm({
                    ...confirm,
                    deleteCheckout: (event.target).checked
                  })
              }),
              confirm.deleteCheckout ? t('removeSourceDeleteFiles') : t('removeSourceKeepFiles')
            ),
            footer: h(
              'div',
              { className: css.modalFooter },
              h(Button, { variant: 'ghost', disabled: busy !== undefined, onClick: () => setConfirm(undefined) }, t('cancel')),
              h(
                Button,
                {
                  variant: 'primary',
                  disabled: busy !== undefined,
                  onClick: () => {
                    void confirmAction()
                  }
                },
                t('confirmDelete')
              )
            )
          })
        : null,
      h(RiskConfirmation, {
        open: confirm !== undefined && confirm.kind === 'uninstall',
        title: t('uninstallConfirmTitle'),
        description: t('uninstallConfirmDesc'),
        acknowledgeLabel: t('uninstallAcknowledge'),
        cancelLabel: t('cancel'),
        closeLabel: t('cancel'),
        confirmLabel: t('confirmDelete'),
        acknowledged: uninstallAck,
        disabled: busy !== undefined,
        onAcknowledgedChange: setUninstallAck,
        onCancel: () => setConfirm(undefined),
        onConfirm: () => {
          void confirmAction()
        }
      }),
      detail === undefined
        ? null
        : h(SuiteDetailModal, {
            t,
            sourceId: detail.sourceId,
            suiteId: detail.suiteId,
            onClose: () => setDetail(undefined),
            onInstall: () => {
              const source = overview.sources.find(entry => entry.id === detail.sourceId)
              setInstallConfirm({
                suite: detail,
                ...(source?.lockCommit === undefined ? {} : { lockCommit: source.lockCommit }),
                ...(source?.local === true ? { localSource: true } : {})
              })
              setDetail(undefined)
            },
            onUninstall: () => {
              openUninstall(detail)
              setDetail(undefined)
            }
          }),
      editor === undefined
        ? null
        : h(SourceEditorModal, {
            t,
            editor,
            busy: busy !== undefined,
            progress,
            onClose: () => setEditor(undefined),
            onSave: async ({ url, branch, kind, sha256 }) => {
              const key = editor.mode === 'edit' ? `s:edit:${editor.source.id}` : `s:add:${url}`
              const body: Record<string, unknown> = { url, local: kind === 'local', kind }
              if (branch !== '' && kind === 'git') body['branch'] = branch
              if (sha256 !== '' && kind === 'archive') body['sha256'] = sha256
              if (editor.mode === 'add') {
                setBusy(key)
                setProgress({ step: t('progressStarting'), error: undefined })
                const poll = startSourceProgressPolling(setProgress, step => progressStepLabel(t, step))
                try {
                  const payload = await postAction('sources/add', body)
                  const derived = (payload['source'] as { id?: string } | undefined)?.id
                  invalidateOverview()
                  await refresh()
                  setEditor(undefined)
                  if (derived !== undefined) setCategory(derived)
                  return true
                } catch (error) {
                  setToast({ key: Date.now(), message: `${t('actionFail')}: ${clientErrorMessage(t, error)}` })
                  setProgress({ step: undefined, error: clientErrorMessage(t, error) })
                  return false
                } finally {
                  poll.stop()
                  setBusy(undefined)
                }
              }
              const ok = await action(key, 'sources/update', { id: editor.source.id, ...body })
              if (ok) setEditor(undefined)
              return ok
            },
            onRemove: id => {
              setConfirm({ kind: 'removeSource', sourceId: id, deleteCheckout: true })
              setEditor(undefined)
            }
          })
    )
  })
}
