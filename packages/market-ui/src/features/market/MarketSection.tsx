/**
 * The Agent Plugins Market settings section.
 *
 * Layout: repository sources run along the TOP as chips (全部 first), with
 * edit-current / add / refresh-all controls on the right; below sit search,
 * status tabs, and the card grid. Colors ride the dsh --dsw-alias-* tokens
 * with light-mode fallbacks so the page follows the active theme.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, IconRefreshOutlineMedium, Modal, RiskConfirmation, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { postAction, type OverviewData, type SuiteCardData } from '../../api.js'
import { loadOverview, peekOverview, invalidateOverview, startDescriptionRefresh, startSourceProgressPolling, type SourceProgressState } from './market-resource.js'
import { SourceTabsRow, type SourceTabItem } from '../../ui/SourceTabsRow.js'
import { SourceEditorModal, type EditorState } from './SourceEditorModal.js'
import { InstallConfirmModal, type InstallConfirmState } from './InstallConfirmModal.js'
import type { Translate } from '../../i18n.js'
import { ErrorBoundary } from '../../ErrorBoundary.js'
import { SuiteDetailModal } from './SuiteDetail.js'
import { ResourceSurface } from '../../ui/ResourceSurface.js'
import { BilingualToggle } from '../../ui/BilingualToggle.js'
import { useTranslationEnabled, useTranslationRefresh } from '../../ui/translation-enabled.js'
import { BusyIndicator } from '../../ui/panel.js'
import css from './market.module.css'
import panelCss from '../../ui/panel.module.css'
import { PanelHeader, PanelActions, ReadFailed } from '../../ui/panel.js'
import { displayText } from '../../ui/translated-text.js'
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

/** The source scope in force; `all` selects every source. */
type Category = string

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
  // Seeded from the cache without starting a request: the mount effect below is
  // the single owner of that request, and render must not race it.
  const [overview, setOverview] = useState<OverviewData>(() => peekOverview().initial)
  const [loading, setLoading] = useState(() => !peekOverview().cached)
  const [category, setCategory] = useState<Category>('all')
  // A failed read is a state, not a notification: the market keeps saying it until
  // the next read works, the same way every other panel does.
  const [readError, setReadError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [toast, setToast] = useState<ToastState | undefined>(undefined)
  const [confirm, setConfirm] = useState<ConfirmState | undefined>(undefined)
  const [installConfirm, setInstallConfirm] = useState<InstallConfirmState | undefined>(undefined)
  const [editor, setEditor] = useState<EditorState>(undefined)
  // The whole card record, so the detail dialog can offer the same install and
  // uninstall actions the card does.
  const [detail, setDetail] = useState<SuiteCardData | undefined>(undefined)
  const [progress, setProgress] = useState<SourceProgressState>({ step: undefined, error: undefined })
  // One reading mode for the whole market page: the switch lives here, so the
  // cards, the detail dialog, and both header rows flip together.
  const [showOriginal, setShowOriginal] = useState(false)
  const language = t('localeProbeLang')
  const languageRef = useRef(language)
  languageRef.current = language
  const [overviewLanguage, setOverviewLanguage] = useState<string | undefined>()
  const translationEnabled = useTranslationEnabled()
  const refreshSequence = useRef(0)
  // The irreversible uninstall is gated behind the host's risk acknowledgement.
  const [uninstallAck, setUninstallAck] = useState(false)

  /**
   * Read the overview into this panel's state.
   *
   * A plain read joins the shared request when one is in flight and starts a
   * fresh one otherwise, so a mount that follows a mount costs one request and
   * keeps the last answer for the next first paint. The shared cache is dropped
   * only when the answer itself changed, never merely because a component
   * mounted.
   * @param force - drop the shared cache first: the caller knows the stored
   * answer is no longer the answer, because a mutation landed or the locale the
   * server resolves text for changed.
   */
  const refresh = useCallback(
    async (force = false): Promise<void> => {
      const sequence = ++refreshSequence.current
      const requestedLanguage = languageRef.current
      if (force) invalidateOverview()
      try {
        const data = await loadOverview().promise
        if (refreshSequence.current !== sequence || languageRef.current !== requestedLanguage) return
        setOverview(data)
        setOverviewLanguage(requestedLanguage)
        setReadError(undefined)
      } catch (error) {
        if (refreshSequence.current === sequence) setReadError(clientErrorMessage(t, error))
      } finally {
        if (refreshSequence.current === sequence) setLoading(false)
      }
    },
    [t]
  )

  // The server resolves text in the host's locale preference, so a locale change
  // is a different answer rather than a revalidation of this one.
  useTranslationRefresh(t, () => refresh(true))

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Text translates off the read path, so the first response can carry upstream
  // text plus a count still in flight. Follow that count down and swap the
  // translated cards in; the panel is fully usable throughout.
  const pendingTranslations = overview.translationPending ?? 0
  useEffect(() => {
    if (pendingTranslations === 0) return
    if (overviewLanguage !== language) return
    const sequence = refreshSequence.current
    const handle = startDescriptionRefresh(setOverview, () => refreshSequence.current !== sequence || languageRef.current !== language)
    return () => {
      handle.stop()
    }
  }, [pendingTranslations, language, overviewLanguage])

  const action = useCallback(
    async (key: string, path: string, body: Record<string, unknown>): Promise<boolean> => {
      setBusy(key)
      try {
        await postAction(path, body)
        await refresh(true)
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
    const ordered = selectedSource === undefined ? sorted : [selectedSource, ...sorted.filter(source => source.id !== selectedSource.id)]
    return [
      { id: 'all', label: `${t('tabAll')} ${overview.totals.all}` },
      ...ordered.map(source => {
        const notes = source.scanNotes ?? []
        const noteHint = notes.length === 0 ? undefined : `${t('scanNotes')}: ${notes.slice(0, 8).join(t('sourceErrorSeparator'))}`
        return {
          id: source.id,
          label: `${source.id} ${source.suiteIds.length}`,
          ...(noteHint === undefined ? {} : { title: noteHint }),
          editable: true,
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

  // The renderer owns the toolbar, the search and the status tabs; this page
  // narrows the suites to the selected source and maps each one onto the shared
  // entry contract. The install or add-source button is the card's primary
  // action, the switch says whether an installed suite is enabled, and the
  // destructive uninstall stays in the detail dialog.
  const scoped = overview.suites.filter(suite => category === 'all' || suite.sourceId === category)
  const suiteById = new Map(scoped.map(suite => [`${suite.sourceId}/${suite.suiteId}`, suite]))
  const entries = scoped.map(suite => {
    const isRemote = suite.remoteUrl !== undefined
    const provenance = isRemote ? t('remoteRef') : suite.dimension === 'user' ? t('panelSourceUser') : t('panelSourcePlugin')
    const description = displayText(suite.translatedDescription, suite.description, t, {
      original: !translationEnabled || showOriginal || overviewLanguage !== language
    })
    const counts = (
      [
        [t('surfaceSkills'), suite.surfaces.skills],
        [t('surfaceMcp'), suite.surfaces.mcp],
        [t('surfaceHooks'), suite.surfaces.hooks],
        [t('surfaceCommands'), suite.surfaces.commands],
        [t('surfaceAgents'), suite.surfaces.agents],
        [t('surfaceLsp'), suite.surfaces.lsp]
      ] as Array<[string, number]>
    )
      .filter(([, count]) => count > 0)
      .map(([label, count]) => ({ label, count }))
    const mcpErrorCount = suite.mcpErrors?.length ?? 0
    const surfaceError = suite.errors.length > 0 ? `${t('errors')} ${suite.errors.length}` : mcpErrorCount > 0 ? `${t('mcpSection')} ${mcpErrorCount}` : undefined
    return {
      id: `${suite.sourceId}/${suite.suiteId}`,
      name: suite.name,
      ...(suite.version === null || suite.version === undefined ? {} : { version: suite.version }),
      tag: provenance,
      surface: 'market' as const,
      description: description === '' ? undefined : description,
      source: suite.sourceId,
      counts,
      ...(surfaceError === undefined ? {} : { warning: `⚠ ${surfaceError}` }),
      // Text the card does not render, so search still finds it.
      keywords: [suite.name, suite.description ?? '', ...suite.keywords].join(' '),
      // Three facts, three edges: running, installed but switched off, and not
      // installed at all. The last one used to paint the "off" grey, which made a
      // market of 971 uninstalled suites read as a wall of disabled ones.
      state: !suite.installed ? ('absent' as const) : suite.enabled ? ('active' as const) : ('disabled' as const),
      // The rail is colour only; this is what a screen reader hears.
      stateLabel: !suite.installed ? t('notInstalledLabel') : suite.enabled ? t('enabledLabel') : t('disabledLabel'),
      hideToggle: !suite.installed,
      toggleLabel: suite.enabled ? t('disable') : t('enable'),
      ...(suite.installed
        ? {
            actions: [
              {
                id: 'refresh',
                label: t('refresh'),
                icon: h(IconRefreshOutlineMedium),
                disabled: busy !== undefined,
                onSelect: () => {
                  void action(`r:${suite.suiteId}`, 'sources/refresh', { id: suite.sourceId })
                }
              }
            ]
          }
        : {
            primary: {
              label: isRemote ? t('addSource') : t('install'),
              ...(isRemote ? { title: suite.remoteUrl } : {}),
              disabled: busy !== undefined,
              onSelect: () => {
                const source = overview.sources.find(entry => entry.id === suite.sourceId)
                if (isRemote) {
                  if (suite.remoteUrl !== undefined) void action(`a:${suite.suiteId}`, 'sources/add', { url: suite.remoteUrl })
                  return
                }
                setInstallConfirm({
                  suite,
                  ...(source?.lockCommit === undefined ? {} : { lockCommit: source.lockCommit }),
                  ...(source?.local === true ? { localSource: true } : {})
                })
              }
            }
          })
    }
  })

  return h(ErrorBoundary, {
    fallback: error => h('div', { className: panelCss.empty }, `${t('actionFail')}: ${error.message}`),
    children: h(
      'div',
      { className: mode === 'page' ? `${css.market} ${css.pageMode}` : css.market },
      h(
        'div',
        { className: css.header },
        h(PanelHeader, {
          // The Market tab already names this page; the description is the part
          // that says something the tab does not.
          subtitle: t('navDescription'),
          actions: h(PanelActions, {
            addLabel: t('addSource'),
            onAdd: () => setEditor({ mode: 'add' }),
            refreshLabel: t('refreshAll'),
            onRefresh: () => {
              void action('s:refresh:all', 'sources/refresh', {})
            },
            busy: busy !== undefined
          })
        }),
        readError === undefined ? null : h(ReadFailed, { message: readError, retryLabel: t('readRetry'), onRetry: () => void refresh(true) }),
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
              )
        )
      ),
      // Keep the global mask until both the mutation and list refresh finish.
      busy !== undefined ? h(BusyIndicator, { overlay: true, label: t('panelWorking') }) : null,
      h(ResourceSurface, {
        t,
        entries,
        capabilities: { toggle: true, counts: true },
        searchLabel: t('searchPh'),
        searchPlaceholder: t('searchPh'),
        filters: [
          { id: 'installed', label: t('tabInstalled'), match: (entry: { id: string }) => suiteById.get(entry.id)?.installed === true },
          { id: 'uninstalled', label: t('tabUninstalled'), match: (entry: { id: string }) => suiteById.get(entry.id)?.installed !== true }
        ],
        beforeView: h(BilingualToggle, { t, showOriginal, onToggle: () => setShowOriginal(current => !current) }),
        toListLabel: t('switchToList'),
        toGridLabel: t('switchToGrid'),
        // A first run has one registered source and nothing cloned yet, so the
        // list is empty for the one reader who has no idea what to do next: name
        // the control that fills it instead of reporting a search that found
        // nothing. A filtered or searched miss keeps the matching wording.
        // A first run has one registered source and nothing cloned yet, so the
        // list is empty for the one reader who has no idea what to do next: name
        // the control that fills it instead of reporting a search that found
        // nothing. A filtered or searched miss keeps the matching wording.
        emptyText:
          readError !== undefined && overview.totals.all === 0 ? t('statusUnreadable') : loading ? t('loading') : overview.totals.all === 0 ? t('emptyNoSources') : t('empty'),
        onOpen: id => {
          const suite = suiteById.get(id)
          if (suite !== undefined) setDetail(suite)
        },
        onToggle: (id, enabled) => {
          const suite = suiteById.get(id)
          if (suite !== undefined) void action(`e:${suite.suiteId}`, 'set-enabled', { sourceId: suite.sourceId, suiteId: suite.suiteId, enabled })
        },
        isOn: id => suiteById.get(id)?.enabled === true,
        isToggleDisabled: () => busy !== undefined
      }),
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
                    deleteCheckout: event.target.checked
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
            showOriginal,
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
                  await refresh(true)
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
