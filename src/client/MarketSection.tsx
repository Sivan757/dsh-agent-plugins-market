/**
 * The Agent Plugins Market settings section.
 *
 * Layout: repository sources run along the TOP as chips (全部 first), with
 * edit-current / add / refresh-all controls on the right; below sit search,
 * status tabs, and the card grid. Colors ride the dsh --dsw-alias-* tokens
 * with light-mode fallbacks so the page follows the active theme.
 */
import { createElement as h, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { postAction, type OverviewData, type SuiteCardData } from './api.js'
import { loadOverview, invalidateOverview, startSourceProgressPolling, type SourceProgressState } from './features/market/market-resource.js'
import { deriveMarketViewModel, type MarketCategory, type MarketFilter } from './features/market/market-view-model.js'
import { SourceTab } from './features/market/SourceTab.js'
import { SourceEditorModal, type EditorState } from './features/market/SourceEditorModal.js'
import { InstallConfirmModal, type InstallConfirmState } from './features/market/InstallConfirmModal.js'
import { SuiteCard } from './features/market/SuiteCard.js'
import { StatusIcon } from './ui/StatusIcon.js'
import type { Translate } from './index.js'
import type { CredentialApi } from './credentials.js'
import { ErrorBoundary } from './ErrorBoundary.js'
import { SuiteDetailModal } from './SuiteDetail.js'
import { SearchFilterToolbar } from './SearchFilterToolbar.js'
import css from './market.module.css'

/** Host step keys -> translation keys, resolved against the active t(). */
const PROGRESS_STEP_LABELS: Record<string, string> = {
  cloning: 'progressCloning',
  downloading: 'progressDownloading',
  reading: 'progressReading'
}

export interface MarketSectionProps {
  t: Translate
  /** Host credentials wire used for write-only MCP env configuration. */
  credentials?: CredentialApi
  /** The host surface controls only outer spacing; data and actions stay shared. */
  mode?: 'settings' | 'page'
}

type Tab = MarketFilter
type Category = MarketCategory
type ViewMode = 'grid' | 'list'

interface ToastState {
  key: number
  message: string
}

interface ConfirmState {
  kind: 'uninstall' | 'removeSource'
  sourceId: string
  suiteId?: string
}

function progressStepLabel(t: Translate, step: string): string {
  const key = PROGRESS_STEP_LABELS[step]
  return key === undefined ? step : t(key as Parameters<Translate>[0])
}

/** Keep parameterized copy compatible with hosts whose bound translator ignores params. */
function interpolate(text: string, params: Record<string, unknown>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match))
}

export function MarketSection({ t, credentials, mode = 'settings' }: MarketSectionProps): ReactNode {
  const [overview, setOverview] = useState<OverviewData>(() => loadOverview().initial)
  const [loading, setLoading] = useState(() => loadOverview().revalidating)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [category, setCategory] = useState<Category>('all')
  const [view, setView] = useState<ViewMode>('grid')
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [toast, setToast] = useState<ToastState | undefined>(undefined)
  const [confirm, setConfirm] = useState<ConfirmState | undefined>(undefined)
  const [installConfirm, setInstallConfirm] = useState<InstallConfirmState | undefined>(undefined)
  const [editor, setEditor] = useState<EditorState>(undefined)
  const [detail, setDetail] = useState<{ sourceId: string; suiteId: string } | undefined>(undefined)
  const [progress, setProgress] = useState<SourceProgressState>({ step: undefined, error: undefined })

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
        setToast({ key: Date.now(), message: `${t('actionFail')}: ${error instanceof Error ? error.message : String(error)}` })
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
    setConfirm({ kind: 'uninstall', sourceId: suite.sourceId, suiteId: suite.suiteId })
  }, [])

  const confirmAction = useCallback(async () => {
    if (confirm === undefined) return
    if (confirm.kind === 'uninstall' && confirm.suiteId !== undefined) {
      await action(`u:${confirm.suiteId}`, 'uninstall', { sourceId: confirm.sourceId, suiteId: confirm.suiteId })
    } else if (confirm.kind === 'removeSource') {
      await action(`s:${confirm.sourceId}`, 'sources/remove', { id: confirm.sourceId })
      if (category === confirm.sourceId) setCategory('all')
    }
    setConfirm(undefined)
  }, [confirm, action, category])

  const selectedSource = category === 'all' ? undefined : overview.sources.find(source => source.id === category)

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
        'header',
        { className: css.header },
        h(
          'div',
          { className: css.titleRow },
          h('h2', { className: css.title }, t('nav')),
          h('div', { className: css.spacer }),
          h(
            'div',
            { className: css.searchGroup },
            h(Button, { variant: 'ghost', size: 'sm', title: t('addSource'), onClick: () => setEditor({ mode: 'add' }) }, '＋'),
            h(
              Button,
              {
                variant: 'ghost',
                size: 'sm',
                title: t('refreshAll'),
                onClick: () => {
                  void action('s:refresh:all', 'sources/refresh', {})
                }
              },
              '↻'
            )
          )
        ),
        h(
          'div',
          { className: css.marketControls },
          h(
            'div',
            { className: css.sourceTabsRow },
            h(
              'div',
              { className: css.sourceTabsScroll },
              h(SourceTab, {
                key: '__all__',
                t,
                active: category === 'all',
                label: `${t('tabAll')} ${overview.totals.all}`,
                onSelect: () => setCategory('all')
              }),
              ...[...overview.sources]
                .sort((a, b) => a.id.localeCompare(b.id))
                .map(source => {
                  const notes = source.scanNotes ?? []
                  const noteHint = notes.length === 0 ? undefined : `${t('scanNotes')}: ${notes.slice(0, 8).join(t('sourceErrorSeparator'))}`
                  const kindBadge = source.local === true ? t('sourceLocal') : source.kind === 'archive' ? t('sourceArchive') : source.adopted === true ? t('sourceAdopted') : undefined
                  return h(SourceTab, {
                    key: source.id,
                    t,
                    active: category === source.id,
                    label: `${source.id}${kindBadge === undefined ? '' : ` · ${kindBadge}`} ${source.suiteIds.length}${source.cloned === false || notes.length > 0 ? ' ⚠' : ''}`,
                    title: noteHint,
                    onSelect: () => setCategory(source.id),
                    onDelete: () => setConfirm({ kind: 'removeSource', sourceId: source.id }),
                    onEdit: selectedSource?.id === source.id ? () => setEditor({ mode: 'edit', source: source }) : undefined
                  })
                })
            )
          ),
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
              { id: 'all', label: t('tabAll'), count: scopeTotals.all, icon: h(StatusIcon, { kind: 'all' }), active: tab === 'all', onSelect: () => setTab('all') },
              {
                id: 'installed',
                label: t('tabInstalled'),
                count: scopeTotals.installed,
                icon: h(StatusIcon, { kind: 'installed' }),
                active: tab === 'installed',
                onSelect: () => setTab('installed')
              },
              {
                id: 'uninstalled',
                label: t('tabUninstalled'),
                count: scopeTotals.all - scopeTotals.installed,
                icon: h(StatusIcon, { kind: 'uninstalled' }),
                active: tab === 'uninstalled',
                onSelect: () => setTab('uninstalled')
              }
            ],
            view,
            gridLabel: t('grid'),
            listLabel: t('list'),
            onViewChange: nextView => setView(nextView)
          })
        )
      ),
      h(
        'main',
        { className: view === 'grid' ? css.grid : css.list },
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
                  onOpen: () => setDetail({ sourceId: suite.sourceId, suiteId: suite.suiteId }),
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
      confirm === undefined
        ? null
        : h(Modal, {
            open: true,
            onClose: () => setConfirm(undefined),
            title:
              confirm.kind === 'uninstall'
                ? t('uninstallConfirmTitle')
                : interpolate(t('removeSourceConfirmTitle', { sourceId: confirm.sourceId }), { sourceId: confirm.sourceId }),
            closeLabel: t('cancel'),
            description: confirm.kind === 'uninstall' ? t('uninstallConfirmDesc') : t('removeSourceConfirmDesc'),
            footer: h(
              'div',
              { className: css.modalFooter },
              h(Button, { variant: 'ghost', onClick: () => setConfirm(undefined) }, t('cancel')),
              h(
                Button,
                {
                  variant: 'primary',
                  onClick: () => {
                    void confirmAction()
                  }
                },
                t('confirmDelete')
              )
            )
          }),
      detail === undefined
        ? null
        : h(SuiteDetailModal, {
            t,
            credentials,
            sourceId: detail.sourceId,
            suiteId: detail.suiteId,
            onClose: () => setDetail(undefined)
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
                  setToast({ key: Date.now(), message: `${t('actionFail')}: ${error instanceof Error ? error.message : String(error)}` })
                  setProgress({ step: undefined, error: error instanceof Error ? error.message : String(error) })
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
            onRemove: async id => {
              setConfirm({ kind: 'removeSource', sourceId: id })
              setEditor(undefined)
            }
          })
    )
  })
}
