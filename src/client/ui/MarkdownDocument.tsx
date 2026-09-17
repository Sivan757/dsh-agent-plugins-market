import { createElement as h, type ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../index.js'
import { frontmatter } from '../features/personas/frontmatter.js'
import css from './detail.module.css'

/**
 * Render one document: its frontmatter verbatim in a mono block, as written,
 * above the rendered body.
 *
 * Showing the block as authored keeps the preview honest about what the file
 * says — a YAML tree would re-present the same keys in a shape the file never
 * has — and it is what the document's own reader shows.
 */
export function MarkdownDocument({ text, t }: { text: string; t: Translate }): ReactNode {
  let parsed: ReturnType<typeof frontmatter>
  try {
    parsed = frontmatter(text)
  } catch (error) {
    return h('div', { role: 'alert', className: css.error }, t('personaMetadataInvalid'), ' ', error instanceof Error ? error.message : String(error))
  }
  return h(
    'div',
    { className: css.preview },
    parsed.raw === '' ? null : h('pre', { className: css.frontmatter }, parsed.raw),
    h(MarkdownText, { text: parsed.body, labels: { code: { copyLabel: t('mdCodeCopy'), copiedLabel: t('mdCodeCopied') }, footnotes: t('mdFootnotes') } })
  )
}
