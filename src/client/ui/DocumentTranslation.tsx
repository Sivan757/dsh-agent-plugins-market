/** Expanded-document reader: three modes over one host Markdown renderer. */
import { createElement as h, Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button, IconCompareSplitOutlineMedium, IconDeliverDocMedium, IconGlobeOutlineMedium, SegmentedTabs, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { MarkdownDocument } from './MarkdownDocument.js'
import { pollUntilTranslated } from './translation-settle.js'
import { localeIsChinese } from './bilingual-text.js'
import { useTranslationEnabled } from './translation-enabled.js'
import { clientErrorMessage } from './error-message.js'
import type { Translate } from '../index.js'
import type { DocumentTranslation } from '../../contracts/translation.js'
import css from './detail.module.css'
import controls from './document-translation.module.css'

type ReadingMode = 'original' | 'translated' | 'bilingual'
export interface DocumentTranslationViewProps {
  t: Translate
  original: string
  /** Reads only this expanded document; never accepts arbitrary client text. */
  load: () => Promise<DocumentTranslation>
}

/** Mount only inside an expanded document. The first translation read starts on mount. */
export function DocumentTranslationView({ t, original, load }: DocumentTranslationViewProps): ReactNode {
  const enabled = useTranslationEnabled()
  const target = localeIsChinese(t) ? 'zh' : 'en'
  const id = useId()
  const [mode, setMode] = useState<ReadingMode>('bilingual')
  const [answer, setAnswer] = useState<{ original: string; target: string; value: DocumentTranslation }>()
  const [failure, setFailure] = useState<unknown>()
  const [attempt, setAttempt] = useState(0)
  const read = useRef(load)
  read.current = load
  const active = enabled && mode !== 'original'
  const translation = answer?.original === original && answer.target === target ? answer.value : undefined

  useEffect(() => {
    if (!active) return
    let current = true
    let settle: { stop: () => void } | undefined
    setFailure(undefined)
    const report = (value: DocumentTranslation): void => {
      if (current) setAnswer({ original, target, value })
    }
    void (async () => {
      try {
        const first = await read.current()
        if (!current) return
        report(first)
        if (first.pending > 0) {
          settle = pollUntilTranslated({
            read: async () => {
              const value = await read.current()
              return { value, pending: value.pending }
            }, report, isStopped: () => !current,
            onError: reason => { if (current) setFailure(reason) }
          })
        }
      } catch (reason) {
        if (current) setFailure(reason)
      }
    })()
    return () => { current = false; settle?.stop() }
  }, [active, original, target, attempt])

  // Loading and provider failures keep the authored document readable.
  const body = !active || translation === undefined ? original
    : mode === 'bilingual' ? (translation.bilingualText ?? translation.text) : translation.text
  const displayedMode = enabled ? mode : 'original'
  const iconLabel = (Icon: (props: IconProps) => ReactNode, label: string): ReactNode =>
    h('span', { className: controls.iconLabel, title: label },
      h('span', { className: controls.icon, 'aria-hidden': true }, h(Icon, { size: 16 })),
      h('span', { className: controls.srOnly }, label)
    )
  return h(Fragment, null,
    enabled ? h('div', { className: controls.toolbar, 'data-document-translation-controls': true },
      h(SegmentedTabs<ReadingMode>, {
        className: controls.tabs, value: mode, onChange: setMode, label: t('translationViewLabel'),
        items: [
          { value: 'original', id: id + '-original', panelId: id + '-original-panel', label: iconLabel(IconDeliverDocMedium, t('translationViewOriginal')) },
          { value: 'translated', id: id + '-translated', panelId: id + '-translated-panel', label: iconLabel(IconGlobeOutlineMedium, t('translationViewTranslated')) },
          { value: 'bilingual', id: id + '-bilingual', panelId: id + '-bilingual-panel', label: iconLabel(IconCompareSplitOutlineMedium, t('translationViewBilingual')) }
        ]
      })
    ) : null,
    h('div', { id: id + '-' + displayedMode + '-panel', role: 'tabpanel', 'aria-labelledby': enabled ? id + '-' + displayedMode : undefined, 'data-document-view': displayedMode },
      active && failure !== undefined ? h('div', { className: css.error, role: 'status' },
        h('p', null, clientErrorMessage(t, failure)),
        h(Button, { onClick: () => setAttempt(value => value + 1) }, t('translationRetry'))
      ) : null,
      active && failure === undefined && (translation === undefined || translation.pending > 0) ? h('p', { role: 'status' }, t('loading')) : null,
      h(MarkdownDocument, { text: body, t })
    )
  )
}
