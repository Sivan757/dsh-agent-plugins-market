/**
 * A document's translation, read when the reader opens it.
 *
 * Translating a whole file is the largest thing this plugin asks a provider
 * for, and a reader who glances at a document should not pay for it: the
 * section starts closed and the first read happens on open. Once open it keeps
 * the shared translation poll running until every chunk has landed, which is
 * what lets the text fill in — a chunk already in the cache is there at once,
 * and one still in flight shows its authored paragraph until it arrives.
 * @module client/ui/DocumentTranslation
 */
import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { DetailRow } from './DetailRows.js'
import { MarkdownDocument } from './MarkdownDocument.js'
import { pollUntilTranslated } from './translation-settle.js'
import { localeIsChinese } from './bilingual-text.js'
import { useTranslationEnabled } from './translation-enabled.js'
import { clientErrorMessage } from './error-message.js'
import type { Translate } from '../index.js'
import type { DocumentTranslation } from '../../contracts/translation.js'
import css from './detail.module.css'

export interface DocumentTranslationViewProps {
  t: Translate
  /** One read of the entry this section belongs to; the caller owns which entry that is. */
  load: () => Promise<DocumentTranslation>
}

/**
 * The document's translated body, behind its own disclosure row.
 *
 * The section exists only where it can say something: with translation switched
 * off there is no translation to show, and under an interface language the
 * documents are already authored in it would offer the reader a copy of the page
 * they are on. Both are the same two conditions the rest of the plugin's
 * translation surfaces answer to.
 * @param props - the translator and the read that fetches this entry's translation.
 * @returns the disclosure row, or null where no translation would be shown.
 */
export function DocumentTranslationView({ t, load }: DocumentTranslationViewProps): ReactNode {
  // Subscribed rather than read once, so switching translation on brings the
  // section back without reopening the dialog.
  const enabled = useTranslationEnabled()
  const [open, setOpen] = useState(false)
  const [translation, setTranslation] = useState<DocumentTranslation | undefined>(undefined)
  const [failure, setFailure] = useState<unknown>(undefined)
  const settle = useRef<{ stop: () => void } | undefined>(undefined)
  // The caller rebuilds its read every render; keeping it in a ref is what lets
  // the effect below depend on the open state alone instead of re-reading on
  // every unrelated render of the dialog.
  const read = useRef(load)
  read.current = load

  useEffect(() => {
    if (!open) return
    let current = true
    setFailure(undefined)
    void (async () => {
      try {
        const first = await read.current()
        if (!current) return
        setTranslation(first)
        if (first.pending === 0) return
        // The first read is this section's own, so it happens now; the shared
        // poll only takes over the chunks still in flight behind it.
        settle.current = pollUntilTranslated({
          read: async () => {
            const next = await read.current()
            return { value: next, pending: next.pending }
          },
          report: value => {
            if (current) setTranslation(value)
          },
          isStopped: () => !current
        })
      } catch (reason) {
        if (current) setFailure(reason)
      }
    })()
    return () => {
      current = false
      settle.current?.stop()
      settle.current = undefined
    }
  }, [open])

  if (!enabled || !localeIsChinese(t)) return null
  const pending = translation !== undefined && translation.pending > 0
  return h(DetailRow, {
    name: t('translationDocToggle'),
    // The state rides the row's own note, so the reader learns that the text
    // below is still filling in — or never arrived — without a second line
    // appearing under the document.
    ...(failure !== undefined
      ? { summary: t('translationDocFailed') }
      : pending
        ? { summary: t('translationDocPending') }
        : {}),
    open,
    onToggle: () => setOpen(!open),
    children:
      failure === undefined
        ? translation === undefined
          ? t('loading')
          : h(MarkdownDocument, { text: translation.text, t })
        : h('p', { className: css.error }, clientErrorMessage(t, failure))
  })
}
