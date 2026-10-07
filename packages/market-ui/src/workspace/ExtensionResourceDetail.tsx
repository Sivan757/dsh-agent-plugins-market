import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { DetailModal, SettingsSizedDetails } from '../ui/DetailModal.js'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { SuiteDetailModal } from '../features/market/SuiteDetail.js'
import { McpDetailModal } from '../features/mcp/McpDetailModal.js'
import { LspDetailModal } from '../features/lsp/LspStatusPanel.js'
import { UserEntryDetailModal } from '../ui/UserEntryDetail.js'
import { fetchLspStatus, fetchMcpStatus, fetchUserPanelEntry, type LspStatusEntry, type McpStatusEntry, type UserPanelEntry } from '../api.js'
import type { Translate } from '../i18n.js'
import type { ExtensionDetailProps } from '../features/extension-presets/details.js'

export function ExtensionDetailView(props: ExtensionDetailProps): ReactNode {
  // A configuration row's identity is a wire id; every spoken name takes the
  // localized display name the presets list renders.
  const shownName = props.resource.configuration === 'user-hooks' ? props.t('epUserHooks') : props.resource.name
  const footer =
    props.onToggle === undefined
      ? undefined
      : h(Switch, {
          label: shownName,
          checked: props.checked === true,
          disabled: props.disabled === true,
          onChange: props.onToggle
        })
  return h(SettingsSizedDetails, { footer, children: h(ResourceDetail, { ...props, key: props.resource.id }) })
}
function ResourceDetail({ resource, t, onClose }: ExtensionDetailProps): ReactNode {
  const address = resource.detail
  const [entry, setEntry] = useState<UserPanelEntry>()
  const [mcp, setMcp] = useState<McpStatusEntry>()
  const [lsp, setLsp] = useState<LspStatusEntry>()
  const [backend, setBackend] = useState<'builtin' | 'host'>('builtin')
  const [error, setError] = useState('')
  const translate = t as Translate
  const panelKind = address.kind === 'panel' ? address.panel : undefined
  useEffect(() => {
    let alive = true
    const load = async () => {
      if (address.kind === 'panel') {
        const next = await fetchUserPanelEntry(address.panel, address.entryId, address.sessionId)
        if (alive) setEntry(next)
      } else if (address.kind === 'mcp') {
        const payload = await fetchMcpStatus(address.sessionId)
        const next = payload.entries.find(row => row.id === address.entryId)
        if (!next) throw new Error(t('epLoadFailed'))
        if (alive) {
          setMcp(next)
          setBackend(payload.backend ?? 'builtin')
        }
      } else if (address.kind === 'lsp') {
        const payload = await fetchLspStatus(false, address.sessionId)
        const next = payload.entries.find(row => row.id === address.entryId)
        if (!next) throw new Error(t('epLoadFailed'))
        if (alive) setLsp(next)
      }
    }
    void load().catch(reason => {
      if (alive) setError(String(reason))
    })
    return () => {
      alive = false
    }
  }, [address, t])
  if (address.kind === 'suite')
    return h(SuiteDetailModal, {
      sessionId: address.sessionId,
      sourceId: address.sourceId,
      suiteId: address.suiteId,
      t: translate,
      showOriginal: false,
      onClose,
      // The user-hooks configuration row localizes its identity instead of
      // translating the wire id, and explains an empty or invalid set of hook
      // files instead of an empty hooks section.
      ...(resource.configuration === 'user-hooks'
        ? { displayName: t('epUserHooks'), displayDescription: t('epUserHooksDescription'), emptyNote: t('epConfigurationUnavailable') }
        : {})
    })
  if (entry && panelKind) return h(UserEntryDetailModal, { sessionId: address.kind === 'panel' ? address.sessionId : undefined, entry, kind: panelKind, t: translate, onClose })
  if (lsp) return h(LspDetailModal, { entry: lsp, t: translate, onClose })
  if (mcp)
    return h(McpDetailModal, {
      entry: mcp,
      t: translate,
      backend,
      readOnly: true,
      onClose,
      onRefresh: async () => mcp,
      onRetry: async () => mcp,
      onReauthorize: async () => mcp
    })
  // The fallback keeps the localized display name the list row and the loaded
  // detail both show, instead of the raw wire id a configuration row carries.
  const shownName = resource.configuration === 'user-hooks' ? t('epUserHooks') : resource.name
  return h(DetailModal, { open: true, title: shownName, closeLabel: t('epClose'), onClose }, h('p', { role: error ? 'alert' : 'status' }, error || t('epLoading')))
}
