import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { DetailModal, SettingsSizedDetails } from '../ui/DetailModal.js'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { SuiteDetailModal } from '../features/market/SuiteDetail.js'
import { McpDetailModal } from '../features/mcp/McpDetailModal.js'
import { LspDetailModal } from '../features/lsp/LspStatusPanel.js'
import { UserEntryDetailModal } from '../ui/UserEntryDetail.js'
import {
  fetchInstructions,
  fetchLspStatus,
  fetchMcpStatus,
  fetchUserPanelEntry,
  type InstructionsPayload,
  type LspStatusEntry,
  type McpStatusEntry,
  type UserPanelEntry
} from '../api.js'
import { InstructionDetail } from '../features/instructions/InstructionDetail.js'
import type { Translate } from '../i18n.js'
import { HookDetailModal } from '../ui/HookDetailModal.js'
import type { ExtensionDetailProps } from '../features/extension-presets/details.js'
import panelCss from '../ui/panel.module.css'

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
function ResourceDetail({ resource, t, showOriginal, onClose }: ExtensionDetailProps): ReactNode {
  const address = resource.detail
  const [entry, setEntry] = useState<UserPanelEntry>()
  const [mcp, setMcp] = useState<McpStatusEntry>()
  const [lsp, setLsp] = useState<LspStatusEntry>()
  const [backend, setBackend] = useState<'builtin' | 'host'>('builtin')
  const [chain, setChain] = useState<InstructionsPayload>()
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
      } else if (address.kind === 'instructions') {
        const payload = await fetchInstructions(address.sessionId)
        if (alive) setChain(payload)
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
  if (address.kind === 'hook') return h(HookDetailModal, { detail: address, t: translate, onClose })
  if (address.kind === 'suite')
    return h(SuiteDetailModal, {
      sessionId: address.sessionId,
      sourceId: address.sourceId,
      suiteId: address.suiteId,
      t: translate,
      // The dialog renders the manager's own view, so a suite opened from the
      // list shows the same description the card behind it shows.
      showOriginal: showOriginal === true,
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
  // An instruction file opens the same dialog the settings page uses, read-only: the manager
  // lists what a preset carries, and editing the file belongs to the page that owns it.
  if (address.kind === 'instructions') {
    const row = chain === undefined ? undefined : chain.rows.find(entry => [entry.scope, entry.directory, entry.candidate].join('/') === address.entryId)
    if (row === undefined) {
      // A chain that has answered is not still loading: the file this row was listed for is
      // no longer in it. Say so, instead of leaving the reader in a state that never ends.
      const answered = chain !== undefined
      return h(
        DetailModal,
        { open: true, title: resource.name, closeLabel: t('epClose'), onClose },
        h('p', { role: error !== '' || answered ? 'alert' : 'status', className: panelCss.detailProse }, error || t(answered ? 'epInstructionMissing' : 'epLoading'))
      )
    }
    return h(InstructionDetail, { t: translate, row, budget: chain?.budget ?? 0, onClose })
  }
  // The prompt layer: a style is one choice the footer's switch selects.
  if (address.kind === 'outputStyle') {
    return h(
      DetailModal,
      { open: true, title: resource.name, closeLabel: t('epClose'), onClose },
      resource.description === undefined ? null : h('p', { className: panelCss.detailProse }, resource.description),
      h('p', { className: panelCss.detailProse }, t('epStyleChoiceNote'))
    )
  }
  // The fallback keeps the localized display name the list row and the loaded
  // detail both show, instead of the raw wire id a configuration row carries.
  const shownName = resource.configuration === 'user-hooks' ? t('epUserHooks') : resource.name
  return h(DetailModal, { open: true, title: shownName, closeLabel: t('epClose'), onClose }, h('p', { role: error ? 'alert' : 'status' }, error || t('epLoading')))
}
