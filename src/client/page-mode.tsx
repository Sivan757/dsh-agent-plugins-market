/**
 * Legacy Web page-mode adapter.
 *
 * Current DSH compositions expose `settings.section`; older compositions that
 * predate that slot can still host a top-level market panel through the DOM
 * shell used by the original page-mode integration. The adapter is deliberately
 * guarded by the live settings-slot state so one composition never renders two
 * market surfaces.
 */
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MarketSection } from './MarketSection.js'
import { shouldUseLegacyPageMode } from './page-mode-selection.js'
import type { Translate } from './index.js'
import type { CredentialApi } from './credentials.js'
import css from './market.module.css'

/** Browser-side inputs required by the legacy page-mode adapter. */
export interface LegacyPageModeOptions {
  /** Current namespace-bound translator. */
  t: Translate
  /** Host credentials wire used for write-only MCP env configuration. */
  credentials?: CredentialApi
  /** Whether the host has mounted a live `settings.section` declaration. */
  isSettingsSurfaceAvailable: () => boolean
  /** Optional locale revision subscription supplied by newer hosts. */
  subscribeLocale?: (listener: () => void) => () => void
}

const ACTIVE_ATTRIBUTE = 'data-dsh-agent-plugins-market-page'
const VIEW_ATTRIBUTE = 'data-dsh-agent-plugins-market-page-view'
const ENTRY_ATTRIBUTE = 'data-dsh-agent-plugins-market-entry'
const SURFACE_EVENT = 'dsh-agent-plugins-market-settings-surface'
const PANEL_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'agent-plugins-market'

/** Notify the page adapter that the settings-slot capability changed. */
export const LEGACY_PAGE_MODE_SURFACE_EVENT = SURFACE_EVENT
const SIDEBAR_COLUMN_SELECTOR = '[data-pane="sidebar"], [class*="sidebarCol"]'
const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const SIDEBAR_CONTEXT_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'

/**
 * Mount the page-mode fallback and its sidebar entry.
 *
 * The fallback remains dormant when the settings surface is present. It also
 * remains a no-op in non-browser runtimes or shells that expose neither the
 * sidebar nor the conversation column.
 *
 * @param options - page-mode dependencies and host capability probe.
 * @returns disposer that removes the injected entry, panel, listeners, and
 * active document marker.
 */
export function mountLegacyPageMode(options: LegacyPageModeOptions): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}

  let stopped = false
  let open = false
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  let entry: HTMLButtonElement | undefined
  let entryLabel: HTMLSpanElement | undefined
  let observer: MutationObserver | undefined

  const setActive = (next: boolean): void => {
    open = next
    if (open && !options.isSettingsSurfaceAvailable()) {
      document.documentElement.setAttribute(ACTIVE_ATTRIBUTE, '')
      document.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE)
    }
  }

  const removeView = (): void => {
    setActive(false)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }

  const renderView = (): void => {
    if (root === undefined) return
    root.render(h(MarketSection, { t: options.t, credentials: options.credentials, mode: 'page' }))
  }

  const updateEntryCopy = (): void => {
    if (entryLabel === undefined || entry === undefined) return
    const label = options.t('nav')
    entryLabel.textContent = label
    entry.title = label
    entry.setAttribute('aria-label', label)
  }

  const ensureView = (): void => {
    if (stopped || options.isSettingsSurfaceAvailable()) {
      removeView()
      return
    }
    const column = conversationColumn()
    if (!shouldUseLegacyPageMode(options.isSettingsSurfaceAvailable(), column !== undefined)) {
      removeView()
      return
    }
    if (column === undefined) return
    if (container !== undefined && container.isConnected) return
    root?.unmount()
    container?.remove()
    container = document.createElement('div')
    container.setAttribute(VIEW_ATTRIBUTE, '')
    container.className = css.pageView
    column.appendChild(container)
    root = createRoot(container)
    renderView()
  }

  const ensureEntry = (): void => {
    if (stopped || options.isSettingsSurfaceAvailable()) {
      entry?.remove()
      return
    }
    const rootElement = sidebarRoot()
    const anchor = rootElement === undefined ? undefined : newSessionButton(rootElement)
    if (rootElement === undefined || anchor === undefined || anchor.parentElement === null) return
    if (entry === undefined) {
      entry = createEntry(() => { setActive(!open); ensureView() })
      entryLabel = entry.querySelector<HTMLSpanElement>('[data-dsh-agent-plugins-market-label]') ?? undefined
      updateEntryCopy()
    }
    if (entry.parentElement !== anchor.parentElement || entry.previousSibling !== anchor) {
      anchor.insertAdjacentElement('afterend', entry)
    }
  }

  const observeShell = (): void => {
    if (stopped || observer !== undefined || options.isSettingsSurfaceAvailable()) return
    observer = new MutationObserver(ensure)
    observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true })
  }

  const stopObservingShell = (): void => {
    observer?.disconnect()
    observer = undefined
  }

  const ensure = (): void => {
    if (stopped) return
    if (options.isSettingsSurfaceAvailable()) {
      stopObservingShell()
      removeView()
      entry?.remove()
      return
    }
    observeShell()
    ensureView()
    ensureEntry()
  }

  const onLocale = (): void => {
    updateEntryCopy()
    renderView()
  }
  const onSurfaceChange = (): void => { ensure() }
  const unsubscribeLocale = options.subscribeLocale?.(onLocale)
  const onPanelActivate = (event: Event): void => {
    const detail = (event as CustomEvent<string>).detail
    if (detail !== PANEL_NAME && open) setActive(false)
  }
  const onSidebarContextClick = (event: MouseEvent): void => {
    if (!open) return
    const target = event.target
    if (!(target instanceof HTMLElement) || target.closest(SIDEBAR_CONTEXT_SELECTOR) === null) return
    setActive(false)
  }

  document.addEventListener(PANEL_EVENT, onPanelActivate)
  document.addEventListener(SURFACE_EVENT, onSurfaceChange)
  document.addEventListener('click', onSidebarContextClick, true)
  queueMicrotask(ensure)

  return () => {
    stopped = true
    unsubscribeLocale?.()
    document.removeEventListener(PANEL_EVENT, onPanelActivate)
    document.removeEventListener(SURFACE_EVENT, onSurfaceChange)
    document.removeEventListener('click', onSidebarContextClick, true)
    stopObservingShell()
    entry?.remove()
    removeView()
  }
}

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>(SIDEBAR_COLUMN_SELECTOR)
  if (column === null) return undefined
  return column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
    ?? (column.firstElementChild as HTMLElement | null)
    ?? undefined
}

function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child instanceof HTMLButtonElement) return child
  }
  return undefined
}

function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

function createEntry(onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute(ENTRY_ATTRIBUTE, '')
  button.className = css.pageEntry
  button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>'
  const label = document.createElement('span')
  label.dataset.dshAgentPluginsMarketLabel = ''
  button.append(label)
  button.addEventListener('click', onClick)
  return button
}
