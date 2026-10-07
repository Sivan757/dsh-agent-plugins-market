import { createElement as h, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  Input,
  Menu,
  Modal,
  Tooltip,
  Toast,
  IconSettingsOutlineMedium,
  IconPlusOutlineMedium,
  IconCloseOutlineMedium,
  IconEllipsisOutlineMedium,
  IconRefreshOutlineMedium
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  parseExtensionName,
  parseExtensionPresetTransfer,
  serializeExtensionPresetTransfer,
  type ExtensionPresetInput,
  type ExtensionPresetLibrary,
  type ExtensionResource
} from '../../../contracts/extension-presets.js'
import type { LocaleKey } from '../../locales.js'
import type { ExtensionPresetLocaleKey } from '../../locales-extension-presets.js'
import { ResourceList } from './ResourceList.js'
import type { RenderExtensionDetail } from './details.js'
import { useExtensionWindow } from './use-window.js'
import { resourceSelected, toggleResource, uniquePresetName } from './resource.js'
import css from './presets.module.css'
import { AgentExtensionIcon } from '../../ui/AgentExtensionIcon.js'
import sourceCss from '../../ui/source-strip.module.css'
import panelCss from '../../ui/panel.module.css'
import rc from '../../ui/resource-card.module.css'

export type ExtensionTranslate = (key: ExtensionPresetLocaleKey | LocaleKey, params?: Record<string, unknown>) => string
export interface ExtensionPresetEntryProps {
  sessionId: string
  t: ExtensionTranslate
  renderDetail: RenderExtensionDetail
}

export function ExtensionPresetEntry(props: ExtensionPresetEntryProps): ReactNode {
  return h(SessionEntry, { ...props, key: props.sessionId })
}
function SessionEntry({ sessionId, t, renderDetail }: ExtensionPresetEntryProps): ReactNode {
  const { data, error, mutate, retry } = useExtensionWindow(sessionId)
  const [menu, setMenu] = useState(false),
    [manager, setManager] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<ExtensionPresetInput>({ name: '', enabledIds: [] })
  const draftRef = useRef(draft),
    draftRevision = useRef(0)
  const [dirty, setDirty] = useState(false),
    [libraryDraft, setLibraryDraft] = useState(false)
  const [feedback, setFeedback] = useState(''),
    [writes, setWrites] = useState(0)
  const [toast, setToast] = useState<{ id: number; text: string; success: boolean }>()
  const sequence = useRef(0)
  const [actionsOpen, setActionsOpen] = useState(false),
    [help, setHelp] = useState(false)
  const [naming, setNaming] = useState<'save' | 'default' | 'rename' | null>(null),
    [newName, setNewName] = useState('')
  const [deletingId, setDeletingId] = useState<string>()
  const [detail, setDetail] = useState<ExtensionResource>()
  const [clipboard, setClipboard] = useState<'copy' | 'paste' | null>(null),
    [clipText, setClipText] = useState('')
  const [leave, setLeave] = useState<{ action: () => void }>()
  const [replacement, setReplacement] = useState<{ presetId: string | null }>()
  const globalIds = () => data?.resources.filter(row => row.available && row.control !== 'global-only' && row.globalEnabled !== false).map(row => row.id) ?? []
  const setLocal = (next: ExtensionPresetInput) => {
    draftRef.current = next
    setDraft(next)
  }
  const loadEditor = (library: ExtensionPresetLibrary, id: string | null = null) => {
    const preset = library.presets.find(p => p.id === id)
    draftRevision.current = library.revision
    setEditing(preset?.id ?? null)
    setLibraryDraft(false)
    setDirty(false)
    setLocal({ name: preset?.name ?? '', enabledIds: preset ? [...preset.enabledIds] : globalIds() })
    setFeedback('')
  }
  const report = async (operation: () => Promise<unknown>, success = t('epSaved')) => {
    const token = ++sequence.current
    setWrites(value => value + 1)
    setFeedback(t('epSaving'))
    try {
      await operation()
      if (token === sequence.current) {
        setFeedback(success)
        if (!manager) setToast({ id: token, text: success, success: true })
      }
    } catch (reason) {
      if (token === sequence.current) {
        const text = t('epFailed') + ' ' + String(reason)
        setFeedback(text)
        if (!manager) setToast({ id: token, text, success: false })
      }
    } finally {
      setWrites(value => value - 1)
    }
  }
  const transition = (action: () => void) => {
    if (writes > 0) return
    if (dirty) {
      setLeave({ action })
      return
    }
    action()
  }
  const dismiss = () => transition(() => setManager(false))
  const saveNamed = (next: ExtensionPresetInput) => {
    if (!editing) return
    setDirty(true)
    void report(async () => {
      await mutate('update', { id: editing, ...next }, draftRevision)
      if (draftRef.current === next) setDirty(false)
    })
  }
  const patch = (row: ExtensionResource, enabled: boolean) => {
    if (!row.available || row.control === 'global-only') return
    let ids = toggleResource(row, draftRef.current.enabledIds, enabled)
    if (row.face === 'market')
      for (const child of data?.resources ?? []) {
        if (child.suiteResourceId === row.id && child.available && child.control !== 'global-only') ids = toggleResource(child, ids, enabled)
      }
    const next = { ...draftRef.current, enabledIds: ids }
    setLocal(next)
    if (editing) saveNamed(next)
    else {
      setLibraryDraft(true)
      setDirty(true)
    }
  }
  const openManager = () => {
    if (!data || manager) return
    setMenu(false)
    loadEditor(data.library, data.state.selection.presetId)
    setManager(true)
    try {
      if (localStorage.getItem('dsh-extension-guide:' + data.workspace) !== 'seen') setHelp(true)
    } catch {
      setHelp(true)
    }
  }
  const closeHelp = () => {
    try {
      if (data) localStorage.setItem('dsh-extension-guide:' + data.workspace, 'seen')
    } catch {
      /* The guide remains available when storage is blocked. */
    }
    setHelp(false)
  }
  const select = (presetId: string | null) => {
    setMenu(false)
    if (data?.state.selection.modified) {
      setReplacement({ presetId })
      return
    }
    void report(() => mutate('select', { presetId }))
  }
  const beginName = (mode: 'save' | 'default' | 'rename') => {
    setActionsOpen(false)
    setNewName(mode === 'rename' ? draft.name : uniquePresetName(draft.name || t('epCustom'), data?.library.presets.map(p => p.name) ?? []))
    setNaming(mode)
  }
  const save = () => {
    if (writes > 0) return
    let name: string
    try {
      name = parseExtensionName(newName)
    } catch {
      setFeedback(t('epInvalid'))
      return
    }
    const mode = naming
    if (mode === 'rename') {
      const next = { ...draftRef.current, name }
      setLocal(next)
      setNaming(null)
      saveNamed(next)
      return
    }
    const before = new Set(data?.library.presets.map(p => p.id))
    void report(async () => {
      let next = await mutate('create', { name, enabledIds: draftRef.current.enabledIds })
      const created = next.library.presets.find(p => !before.has(p.id))
      if (!created) throw new Error(t('epLoadFailed'))
      // Publish the successful save before attempting the separate default mutation.
      loadEditor(next.library, created.id)
      setNaming(null)
      if (mode === 'default') {
        next = await mutate('default', { id: created.id })
        draftRevision.current = next.library.revision
      }
    })
  }
  const copy = async () => {
    if (!editing) return
    const text = serializeExtensionPresetTransfer(draftRef.current)
    try {
      await navigator.clipboard.writeText(text)
      setFeedback(t('epCopied'))
    } catch {
      setClipText(text)
      setClipboard('copy')
    }
  }
  const importText = (text: string) => {
    let input: ExtensionPresetInput
    try {
      input = parseExtensionPresetTransfer(text)
    } catch {
      setFeedback(t('epInvalid'))
      return
    }
    const name = uniquePresetName(input.name, data?.library.presets.map(p => p.name) ?? [])
    const before = new Set(data?.library.presets.map(p => p.id))
    void report(async () => {
      const next = await mutate('create', { ...input, name })
      loadEditor(next.library, next.library.presets.find(p => !before.has(p.id))?.id)
      setClipboard(null)
    })
  }
  const paste = async () => {
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      setClipText('')
      setClipboard('paste')
      return
    }
    importText(text)
  }
  const defaultSelected = !libraryDraft && data?.library.defaultPresetId === editing
  const setDefault = () => {
    if (libraryDraft) {
      beginName('default')
      return
    }
    void report(async () => {
      const next = await mutate('default', { id: editing })
      draftRevision.current = next.library.revision
    })
  }
  const unready = data?.status?.ready === false
  const name = unready
    ? t('epNotReady')
    : data
      ? (data.state.selection.presetName ?? t('epGlobal')) + (data.state.selection.modified ? ' · ' + t('epModified') : '')
      : t(error ? 'epLoadFailed' : 'epLoading')
  const savedDirty = dirty && !libraryDraft
  const duplicate = data?.library.presets.some(p => p.name === newName.trim() && (naming !== 'rename' || p.id !== editing)) === true
  const editableClipboard = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]')
  return (
    <span>
      <Menu
        open={menu}
        onClose={() => setMenu(false)}
        portal
        side="top"
        dense
        selection="check"
        selectedId={unready || data?.state.selection.modified ? undefined : (data?.state.selection.presetId ?? 'global')}
        anchor={
          <Tooltip label={t('epTitle') + ' · ' + name} side="top">
            <span>
              <Button
                variant="ghost"
                size="sm"
                className={css.entryButton}
                aria-label={name}
                aria-haspopup="menu"
                aria-expanded={menu}
                disabled={manager}
                onClick={() => setMenu(value => !value)}
              >
                <AgentExtensionIcon />
              </Button>
            </span>
          </Tooltip>
        }
        footer={[{ id: 'manage', label: t('epManage'), icon: <IconSettingsOutlineMedium />, disabled: !data }]}
        items={[
          { type: 'label', id: 'heading', text: t('epTitle') },
          { id: 'global', label: t('epGlobal'), icon: <IconRefreshOutlineMedium />, disabled: !data || data.busy || unready || writes > 0 },
          ...(data?.library.presets.map(p => ({ id: p.id, label: p.name, icon: <AgentExtensionIcon size={16} />, disabled: data.busy || unready || writes > 0 })) ?? []),

          ...(unready
            ? [
                { type: 'label' as const, id: 'not-ready', text: t('epNotReady') + ' ' + (data.status?.error ?? '') },
                ...(data.status?.recoverable ? [{ id: 'recover', label: t('epRecover'), disabled: data.busy || writes > 0 }] : [])
              ]
            : []),
          ...(data?.busy ? [{ type: 'label' as const, id: 'busy', text: t('epBusy') }] : []),
          ...(error
            ? [
                { type: 'label' as const, id: 'error', text: t('epLoadFailed') + ' ' + error },
                { id: 'retry', label: t('epRetry') }
              ]
            : [])
        ]}
        onSelect={id =>
          id === 'manage' ? openManager() : id === 'retry' ? retry() : id === 'recover' ? void report(() => mutate('recover', {})) : select(id === 'global' ? null : id)
        }
      />
      {toast && <Toast key={toast.id} text={toast.text} tone={toast.success ? 'success' : undefined} holdMs={toast.success ? 3000 : 10000} onDone={() => setToast(undefined)} />}
      {manager && data && (
        <Modal
          open
          title={t('epManageTitle')}
          closeLabel={t('epClose')}
          className={css.modal}
          contentClassName={css.modalContent}
          onClose={dismiss}
          footer={
            <div className={css.footer}>
              <div className={css.footerContext}>
                <Button variant="ghost" size="sm" onClick={() => setHelp(true)}>
                  {t('epHelp')}
                </Button>
              </div>
              <Button size="sm" variant="outline" disabled={writes > 0 || savedDirty || defaultSelected} onClick={setDefault}>
                {defaultSelected ? t('epIsDefault') : t('epDefault')}
              </Button>
              <Button size="sm" variant="primary" disabled={writes > 0 || savedDirty} onClick={libraryDraft ? () => beginName('save') : dismiss}>
                {libraryDraft ? t('epSave') : t('epDone')}
              </Button>
            </div>
          }
        >
          <div
            className={css.managerBody + ' ' + panelCss.shell}
            tabIndex={0}
            onKeyDown={event => {
              if (!(event.ctrlKey || event.metaKey) || event.altKey || editableClipboard(event.target) || window.getSelection()?.toString()) return
              if (event.key.toLowerCase() === 'c' && editing) {
                event.preventDefault()
                void copy()
              }
              if (event.key.toLowerCase() === 'v' && !writes) {
                event.preventDefault()
                transition(() => void paste())
              }
            }}
            onCopy={event => {
              if (editableClipboard(event.target) || window.getSelection()?.toString() || !editing) return
              event.preventDefault()
              event.clipboardData.setData('text/plain', serializeExtensionPresetTransfer(draftRef.current))
              setFeedback(t('epCopied'))
            }}
            onPaste={event => {
              if (editableClipboard(event.target) || window.getSelection()?.toString() || writes) return
              const text = event.clipboardData.getData('text/plain')
              if (!text) return
              event.preventDefault()
              transition(() => importText(text))
            }}
          >
            <div className={css.planBar}>
              <div className={css.planStrip + ' ' + sourceCss.sourceTabsBoxLine} role="group" aria-label={t('epTitle')}>
                <div className={sourceCss.sourceTabsRow}>
                  <div className={!editing && !libraryDraft ? sourceCss.srcTabOn : sourceCss.srcTab}>
                    <button
                      type="button"
                      className={sourceCss.srcTabMain}
                      aria-pressed={!editing && !libraryDraft}
                      disabled={writes > 0 || savedDirty}
                      onClick={() => transition(() => loadEditor(data.library))}
                    >
                      {t('epGlobal')}
                      {data.library.defaultPresetId === null ? ' · ' + t('epDefaultMarker') : ''}
                    </button>
                  </div>
                  {data.library.presets.map(p => (
                    <div className={editing === p.id ? sourceCss.srcTabOn : sourceCss.srcTab} key={p.id}>
                      <button
                        type="button"
                        className={sourceCss.srcTabMain}
                        aria-pressed={editing === p.id}
                        disabled={writes > 0 || savedDirty}
                        onClick={() => transition(() => loadEditor(data.library, p.id))}
                      >
                        {p.name}
                        {data.library.defaultPresetId === p.id ? ' · ' + t('epDefaultMarker') : ''}
                      </button>
                      <span className={sourceCss.srcTabControls}>
                        <button
                          type="button"
                          className={sourceCss.srcTabDel}
                          aria-label={t('epDelete') + ' ' + p.name}
                          disabled={writes > 0 || dirty}
                          onClick={() => setDeletingId(p.id)}
                        >
                          <IconCloseOutlineMedium size={12} />
                        </button>
                      </span>
                    </div>
                  ))}
                  {libraryDraft && (
                    <div className={sourceCss.srcTabOn}>
                      <button type="button" className={sourceCss.srcTabMain} aria-pressed>
                        {t('epDraft')} ·
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <button type="button" className={rc.iconBtn} aria-label={t('epSaveAs')} title={t('epSaveAs')} disabled={writes > 0 || savedDirty} onClick={() => beginName('save')}>
                <IconPlusOutlineMedium />
              </button>
              <Menu
                open={actionsOpen}
                onClose={() => setActionsOpen(false)}
                portal
                compact
                align="end"
                anchor={
                  <Button size="sm" variant="ghost" aria-label={t('epActions')} aria-haspopup="menu" aria-expanded={actionsOpen} onClick={() => setActionsOpen(value => !value)}>
                    <IconEllipsisOutlineMedium size={16} />
                  </Button>
                }
                items={[
                  { id: 'rename', label: t('epRename'), disabled: !editing || writes > 0 || dirty },
                  { id: 'copy', label: t('epCopy'), disabled: !editing },
                  { id: 'paste', label: t('epPaste'), disabled: writes > 0 }
                ]}
                onSelect={id => {
                  setActionsOpen(false)
                  if (id === 'rename') beginName('rename')
                  else if (id === 'copy') void copy()
                  else
                    transition(() => {
                      setClipText('')
                      setClipboard('paste')
                    })
                }}
              />
            </div>
            <div className={css.inlineStatus + ' ' + panelCss.subtitle} role="status">
              <span>{feedback || t(libraryDraft ? 'epDraftHint' : editing ? 'epAutosaveHint' : 'epGlobalHint')}</span>
              {savedDirty && writes === 0 && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      draftRevision.current = data.library.revision
                      saveNamed(draftRef.current)
                    }}
                  >
                    {t('epRetry')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => loadEditor(data.library, editing)}>
                    {t('epDiscard')}
                  </Button>
                </>
              )}
            </div>
            <ResourceList resources={data.resources} ids={draft.enabledIds} disabled={false} t={t} onToggle={patch} onView={setDetail} />
          </div>
        </Modal>
      )}
      <Modal
        open={naming !== null}
        title={t(naming === 'rename' ? 'epRename' : 'epSave')}
        closeLabel={t('epClose')}
        onClose={() => {
          if (!writes) setNaming(null)
        }}
        footer={
          <>
            <Button onClick={() => setNaming(null)} disabled={writes > 0}>
              {t('epCancel')}
            </Button>
            <Button variant="primary" disabled={writes > 0 || !newName.trim() || duplicate} onClick={save}>
              {t(naming === 'default' ? 'epSaveDefault' : naming === 'rename' ? 'epRename' : 'epSave')}
            </Button>
          </>
        }
      >
        <Input
          data-modal-autofocus
          aria-label={t('epName')}
          value={newName}
          maxLength={80}
          aria-invalid={duplicate}
          onChange={event => setNewName(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && !duplicate && newName.trim()) save()
          }}
        />
        {duplicate && <p role="alert">{t('epDuplicate')}</p>}
        {feedback.startsWith(t('epFailed')) && <p role="alert">{feedback}</p>}
      </Modal>
      <Modal
        open={deletingId !== undefined}
        title={t('epDelete')}
        description={t('epDeleteConfirm')}
        closeLabel={t('epClose')}
        onClose={() => {
          if (!writes) setDeletingId(undefined)
        }}
        footer={
          <Button
            disabled={writes > 0}
            onClick={() =>
              void report(async () => {
                const next = await mutate('delete', { id: deletingId })
                if (deletingId === editing) loadEditor(next.library)
                else draftRevision.current = next.library.revision
                setDeletingId(undefined)
              })
            }
          >
            {t('epDelete')}
          </Button>
        }
      />
      <Modal
        open={clipboard !== null}
        title={t(clipboard === 'copy' ? 'epCopy' : 'epPaste')}
        description={t(clipboard === 'copy' ? 'epCopyFallback' : 'epPasteHint')}
        closeLabel={t('epClose')}
        onClose={() => {
          if (!writes) setClipboard(null)
        }}
        footer={
          clipboard === 'paste' ? (
            <Button disabled={writes > 0 || !clipText.trim()} onClick={() => importText(clipText)}>
              {t('epImport')}
            </Button>
          ) : undefined
        }
      >
        <textarea
          className={css.clipboardText}
          aria-label={t(clipboard === 'copy' ? 'epCopy' : 'epPaste')}
          value={clipText}
          readOnly={clipboard === 'copy'}
          onChange={event => setClipText(event.target.value)}
          onFocus={event => {
            if (clipboard === 'copy') event.target.select()
          }}
        />
        {feedback && <p role="status">{feedback}</p>}
      </Modal>
      <Modal
        open={help}
        title={t('epHelp')}
        closeLabel={t('epClose')}
        onClose={closeHelp}
        footer={
          <Button variant="primary" onClick={closeHelp}>
            {t('epGotIt')}
          </Button>
        }
      >
        <p>{t('epGuide')}</p>
        <p>{t('epLibraryHint')}</p>
        <p>{t('epClipboardHelp')}</p>
      </Modal>
      <Modal
        open={leave !== undefined}
        title={t('epDiscard')}
        description={t('epDiscardHint')}
        closeLabel={t('epClose')}
        onClose={() => setLeave(undefined)}
        footer={
          <>
            <Button onClick={() => setLeave(undefined)}>{t('epCancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const action = leave?.action
                setLeave(undefined)
                setDirty(false)
                action?.()
              }}
            >
              {t('epDiscardContinue')}
            </Button>
          </>
        }
      />
      <Modal
        open={replacement !== undefined}
        title={t('epReplace')}
        description={t('epReplaceHint')}
        closeLabel={t('epClose')}
        onClose={() => setReplacement(undefined)}
        footer={
          <Button
            disabled={writes > 0}
            onClick={() => {
              if (replacement) {
                const presetId = replacement.presetId
                setReplacement(undefined)
                void report(() => mutate('select', { presetId }))
              }
            }}
          >
            {t('epReplace')}
          </Button>
        }
      />
      {detail
        ? renderDetail({
            resource: detail,
            t,
            onClose: () => setDetail(undefined),
            checked: detail.available && resourceSelected(detail, draft.enabledIds),
            disabled: !detail.available || detail.control === 'global-only',
            onToggle: enabled => patch(detail, enabled)
          })
        : null}
    </span>
  )
}
