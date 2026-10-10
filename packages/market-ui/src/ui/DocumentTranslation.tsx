/** Document reading state with a caller-owned header and body layout. */
import { createElement as h, Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconCompareSplitOutlineMedium,
  IconDeliverDocMedium,
  IconGlobeOutlineMedium,
  IconLoadingOutlineMedium,
  IconWarningOutlineMedium,
  SegmentedTabs,
  type IconProps
} from '@deepseek-ai/dsh-client-ui-primitives'
import { MarkdownDocument } from './MarkdownDocument.js'
import { pollUntilTranslated } from './translation-settle.js'
import { localeIsChinese } from './bilingual-text.js'
import { useTranslationEnabled } from './translation-enabled.js'
import { clientErrorMessage } from './error-message.js'
import type { Translate } from '../i18n.js'
import type { DocumentTranslation } from '../../../market-contracts/src/contracts/translation.js'
import { readingMode, useReadingMode, type ReadingMode } from './reading-mode.js'
import controls from './document-translation.module.css'
export interface DocumentTranslationViewProps {
  t: Translate
  original: string | undefined
  /** Closed rows never read translations. */
  open?: boolean
  originalLoading?: boolean
  originalError?: string | undefined
  retryOriginal?: (() => void) | undefined
  load: (retry?: boolean) => Promise<DocumentTranslation>
  /** Compose header actions and body in one React tree, without DOM insertion. */
  render?: (parts: { controls: ReactNode; body: ReactNode }) => ReactNode
}

export function DocumentTranslationView({
  t,
  original,
  open = true,
  originalLoading = false,
  originalError,
  retryOriginal,
  load,
  render
}: DocumentTranslationViewProps): ReactNode {
  const enabled = useTranslationEnabled()
  const target = localeIsChinese(t) ? 'zh' : 'en'
  const id = useId()
  const mode = useReadingMode()
  const [answer, setAnswer] = useState<{ original: string; target: string; value: DocumentTranslation }>()
  const [failure, setFailure] = useState<unknown>()
  const [attempt, setAttempt] = useState(0)
  const [requesting, setRequesting] = useState(false)
  const retryRequested = useRef(false)
  const read = useRef(load)
  read.current = load
  const active = open && enabled && mode !== 'original' && original !== undefined && !originalLoading && originalError === undefined
  const translation = answer?.original === original && answer?.target === target ? answer.value : undefined

  useEffect(() => {
    if (!active || original === undefined) return
    let current = true
    let settle: { stop: () => void } | undefined
    setFailure(undefined)
    setRequesting(true)
    const report = (value: DocumentTranslation): void => {
      if (current) setAnswer({ original, target, value })
    }
    void (async () => {
      try {
        const retry = retryRequested.current
        retryRequested.current = false
        const first = await read.current(retry || undefined)
        if (!current) return
        setRequesting(false)
        report(first)
        if (first.pending > 0)
          settle = pollUntilTranslated({
            read: async () => {
              const value = await read.current()
              return { value, pending: value.pending }
            },
            report,
            isStopped: () => !current,
            onError: reason => {
              if (current) setFailure(reason)
            }
          })
      } catch (reason) {
        if (current) {
          setRequesting(false)
          setFailure(reason)
        }
      }
    })()
    return () => {
      current = false
      settle?.stop()
    }
  }, [active, original, target, attempt])

  const translatedFailure =
    active && !requesting ? (failure !== undefined ? clientErrorMessage(t, failure) : (translation?.failed ?? 0) > 0 ? t('translationFailed') : undefined) : undefined
  const error = open ? (originalError ?? translatedFailure) : undefined
  const busy = open && (originalLoading || (active && error === undefined && (requesting || translation === undefined || translation.pending > 0)))
  const retry = (): void => {
    if (originalError !== undefined) retryOriginal?.()
    else {
      retryRequested.current = true
      setFailure(undefined)
      setAttempt(value => value + 1)
    }
  }
  const displayedMode = enabled ? mode : 'original'
  const bodyText = !active || translation === undefined ? original : mode === 'bilingual' ? (translation.bilingualText ?? translation.text) : translation.text
  const iconLabel = (value: ReadingMode, Icon: (props: IconProps) => ReactNode, label: string): ReactNode => {
    const selected = value === displayedMode
    const status = selected && error !== undefined ? error + ' ' + t('translationRetry') : selected && busy ? t('translationLoading') : label
    const displayedIcon =
      selected && busy ? h(IconLoadingOutlineMedium, { size: 16 }) : selected && error !== undefined ? h(IconWarningOutlineMedium, { size: 16 }) : h(Icon, { size: 16 })
    return h(
      'span',
      { className: controls.iconLabel, title: status, 'data-reading-mode': value, 'aria-busy': (selected && busy) || undefined },
      h(
        'span',
        { className: selected && busy ? controls.spinner : controls.icon, 'aria-hidden': true, 'data-translation-spinner': (selected && busy) || undefined },
        displayedIcon
      ),
      h('span', { className: controls.srOnly }, label)
    )
  }
  const toolbar = h(
    'div',
    { className: controls.toolbar, 'data-document-translation-controls': true },
    enabled
      ? h(SegmentedTabs<ReadingMode>, {
          className: controls.tabs,
          value: mode,
          onChange: value => {
            if (value === mode && error !== undefined) retry()
            else readingMode.set(value)
          },
          label: t('translationViewLabel'),
          items: [
            { value: 'original', id: id + '-original', panelId: id + '-original-panel', label: iconLabel('original', IconDeliverDocMedium, t('translationViewOriginal')) },
            {
              value: 'translated',
              id: id + '-translated',
              panelId: id + '-translated-panel',
              label: iconLabel('translated', IconGlobeOutlineMedium, t('translationViewTranslated'))
            },
            {
              value: 'bilingual',
              id: id + '-bilingual',
              panelId: id + '-bilingual-panel',
              label: iconLabel('bilingual', IconCompareSplitOutlineMedium, t('translationViewBilingual'))
            }
          ]
        })
      : busy
        ? h('span', { className: controls.spinner, 'data-translation-spinner': true, 'aria-hidden': true }, h(IconLoadingOutlineMedium, { size: 16 }))
        : error !== undefined
          ? h(Button, { size: 'sm', title: error, onClick: retry, icon: h(IconWarningOutlineMedium, { size: 16 }) }, t('translationRetry'))
          : null,
    busy || error !== undefined ? h('span', { role: 'status', className: controls.srOnly, 'aria-label': error ?? t('translationLoading') }) : null
  )
  const body = open
    ? h(
        'div',
        { id: id + '-' + displayedMode + '-panel', role: 'tabpanel', 'aria-labelledby': enabled ? id + '-' + displayedMode : undefined, 'data-document-view': displayedMode },
        bodyText === undefined ? null : h(MarkdownDocument, { text: bodyText, t })
      )
    : null
  return render ? render({ controls: toolbar, body }) : h(Fragment, null, toolbar, body)
}
