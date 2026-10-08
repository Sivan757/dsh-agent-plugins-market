import { createElement as h, type ReactNode } from 'react'
import type { ExtensionDetail } from '../../../market-contracts/src/contracts/extension-presets.js'
import type { Translate } from '../i18n.js'
import { DetailModal } from './DetailModal.js'
import { DetailRows } from './DetailRows.js'
import css from './panel.module.css'

/** Both surfaces show the same read-only server-derived Hook declaration. */
export function HookDetailModal({ detail, t, onClose }: { detail: Extract<ExtensionDetail, { kind: 'hook' }>; t: Translate; onClose: () => void }): ReactNode {
  const support = detail.support === 'supported' ? t('hooksFilterSupported') : t(detail.support === 'supported-partial' ? 'hooksEventPartial' : 'hooksEventUnsupported')
  const field = (label: string, value: string) => h('div', { key: label }, h('dt', { className: css.kvKey }, label), h('dd', { className: css.kvValue }, value))
  return h(
    DetailModal,
    { open: true, title: detail.provenance, closeLabel: t('mcpClose'), onClose },
    h(
      DetailRows,
      null,
      h(
        'dl',
        { className: css.kvGrid },
        field(t('hookDetailEvent'), detail.event),
        field(t('hookDetailSource'), detail.provenance),
        field(t('hookDetailSupport'), support),
        field(t('hookDetailMatcher'), detail.matcher ?? '*'),
        detail.timeoutSec === undefined ? null : field(t('hookDetailTimeout'), t('hookDetailSeconds', { count: detail.timeoutSec }))
      )
    ),
    detail.command === undefined ? null : h(DetailRows, { label: t('hookDetailCommand') }, h('pre', { className: css.monoBlock }, detail.command)),
    detail.diagnostic === undefined ? null : h(DetailRows, { label: t('hookDetailDiagnostic') }, h('p', { className: css.detailProse }, detail.diagnostic))
  )
}
