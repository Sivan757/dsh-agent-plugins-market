import { createElement as h, useState, type ReactNode } from 'react'
import { Button, JsonTree, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ExtensionDetail, ExtensionHookRunResult } from '../../../market-contracts/src/contracts/extension-presets.js'
import type { Translate } from '../i18n.js'
import { runExtensionHook } from '../api.js'
import { DetailModal } from './DetailModal.js'
import { DetailRow, DetailRows } from './DetailRows.js'
import { jsonTreeLabels } from './json-tree-labels.js'
import { clientErrorMessage } from './error-message.js'
import css from './hook-detail.module.css'
import panel from './panel.module.css'

/** One dry run's own state: in flight, one bounded result, or the request's failure. */
type RunState = { status: 'running' } | { status: 'done'; result: ExtensionHookRunResult } | { status: 'failed'; message: string }

/**
 * The read-only declaration, then one on-demand dry run.
 *
 * The status card carries the full command. The declaration block repeats it as
 * its row's clipped preview, because that block shows one declaration as one
 * record and the row names the command that record runs.
 */
export function HookDetailModal({ detail, t, onClose }: { detail: Extract<ExtensionDetail, { kind: 'hook' }>; t: Translate; onClose: () => void }): ReactNode {
  const [run, setRun] = useState<RunState | undefined>(undefined)
  const [declarationOpen, setDeclarationOpen] = useState(false)
  const support = detail.support === 'supported' ? t('hooksFilterSupported') : t(detail.support === 'supported-partial' ? 'hooksEventPartial' : 'hooksEventUnsupported')
  const cell = (label: string, value: string) => h('div', { key: label }, h('dt', { className: panel.kvKey }, label), h('dd', { className: panel.kvValue }, value))
  // A rejected declaration carries no admitted hook, so it offers no run.
  const runnable = detail.command !== undefined && detail.hookIndex !== undefined
  const start = (): void => {
    setRun({ status: 'running' })
    runExtensionHook({
      sourceId: detail.sourceId,
      suiteId: detail.suiteId,
      event: detail.event,
      hookIndex: detail.hookIndex,
      ...(detail.sessionId === undefined ? {} : { sessionId: detail.sessionId })
    })
      .then(result => setRun({ status: 'done', result }))
      .catch(caught => setRun({ status: 'failed', message: clientErrorMessage(t, caught) }))
  }
  return h(
    DetailModal,
    {
      open: true,
      title: detail.provenance,
      closeLabel: t('mcpClose'),
      onClose,
      footer: h(Button, { variant: 'outline', onClick: onClose }, t('mcpClose'))
    },
    h(
      'div',
      { className: css.stack },
      h(
        'div',
        { className: css.card },
        h(
          'div',
          { className: css.cardTags },
          h(Tag, { tone: detail.support === 'supported' ? 'success' : detail.support === 'supported-partial' ? 'warning' : 'outline' }, support),
          h(Tag, { tone: 'outline' }, detail.event),
          detail.matcher === undefined ? null : h(Tag, { tone: 'outline' }, t('hookDetailMatcher') + ' ' + detail.matcher),
          h('span', { className: css.cardName }, detail.provenance)
        ),
        detail.command === undefined
          ? null
          : h('div', { className: css.pathLine }, h(StateDot, { state: 'done', className: css.pathDot }), h('code', { className: css.pathText }, detail.command))
      ),
      h(
        'section',
        { className: css.section },
        h('h3', { className: css.sectionTitle }, t('hookDetailOverview')),
        h(
          'dl',
          { className: panel.kvGrid },
          cell(t('hookDetailSource'), detail.provenance),
          cell(t('hookDetailEvent'), detail.event),
          cell(t('hookDetailMatcher'), detail.matcher ?? '*'),
          cell(t('hookDetailTimeout'), detail.timeoutSec === undefined ? t('hookRunTimeoutInherited') : t('hookDetailSeconds', { count: detail.timeoutSec })),
          cell(t('hookDetailPosition'), detail.hookIndex === undefined ? '—' : t('hookDetailPositionValue', { index: detail.hookIndex + 1 })),
          cell(t('hookDetailKind'), t('hookDetailKindCommand')),
          cell(t('hookDetailSuite'), detail.sourceId),
          cell(t('hookDetailRunDir'), t('hookDetailRunDirHome'))
        )
      ),
      h(
        'section',
        { className: css.section },
        h('h3', { className: css.sectionTitle }, t('hookDetailDeclaration')),
        // One declaration is one record, so it reads as one row: the event names
        // it, the command previews it, and the row opens on the JSON itself.
        h(
          DetailRows,
          null,
          h(DetailRow, {
            name: detail.event,
            summary: detail.command,
            open: declarationOpen,
            onToggle: () => setDeclarationOpen(current => !current),
            children: h(JsonTree, { data: declarationJson(detail), label: detail.event, copyable: true, labels: jsonTreeLabels(t) })
          })
        )
      ),
      detail.diagnostic === undefined
        ? null
        : h('section', { className: css.section }, h('h3', { className: css.sectionTitle }, t('hookDetailDiagnostic')), h('p', { className: css.status }, detail.diagnostic)),
      runnable
        ? h(
            'section',
            { className: css.section },
            h(
              'div',
              { className: css.sectionHead },
              h('h3', { className: css.sectionTitle }, t('hookDetailRunResult')),
              h(Button, { variant: 'primary', disabled: run?.status === 'running', onClick: start }, t('hookRunStart'))
            ),
            run === undefined ? h('p', { className: css.status }, t('hookRunIdle')) : resultBlock(run, t)
          )
        : null
    )
  )
}

/**
 * The declaration's own facts, assembled from the scanned fields.
 *
 * The wire carries the scanned declaration and never the file's raw bytes, so
 * the block reads as the declaration, not as a copy of its source. Address
 * fields and host-derived facts stay out: the block states what the declaration
 * says, not where it lives or what the host can run. The timeout states the
 * declared seconds under the scanned `timeout` key.
 */
function declarationJson(detail: Extract<ExtensionDetail, { kind: 'hook' }>): Record<string, unknown> {
  return {
    event: detail.event,
    ...(detail.matcher === undefined ? {} : { matcher: detail.matcher }),
    ...(detail.command === undefined ? {} : { command: detail.command }),
    ...(detail.timeoutSec === undefined ? {} : { timeout: detail.timeoutSec }),
    ...(detail.diagnostic === undefined ? {} : { diagnostic: detail.diagnostic })
  }
}

/** The server's stable failure codes read as sentences; any other error keeps its own words. */
function runErrorText(error: string, t: Translate): string {
  if (error === 'hook-run-unknown-declaration') return t('hookRunUnknownDeclaration')
  if (error === 'hook-run-no-command') return t('hookRunNoCommand')
  if (error === 'hook-run-shell-unavailable') return t('hookRunShellUnavailable')
  return error
}

/** One dry run's outcome: the status line first, then whichever stream the command wrote. */
function resultBlock(run: RunState, t: Translate): ReactNode {
  if (run.status === 'running') return h('p', { className: css.status, role: 'status' }, t('hookRunRunning'))
  if (run.status === 'failed') return h('p', { className: css.failure, role: 'alert' }, t('hookRunFailed') + ': ' + run.message)
  const { result } = run
  const line = [t('hookRunExit', { code: result.exitCode ?? '-' }), t('hookRunDuration', { ms: Math.round(result.durationMs) }), t('hookRunSynthetic')]
  if (result.timedOut) line.push(t('hookRunTimedOut'))
  if (result.truncated) line.push(t('hookRunTruncated'))
  const wrote = result.stdout !== '' || result.stderr !== ''
  return h(
    'div',
    { className: css.section },
    h(
      'p',
      { className: result.error === undefined ? css.status : css.failure, role: result.error === undefined ? 'status' : 'alert' },
      result.error === undefined ? line.join(' · ') : runErrorText(result.error, t)
    ),
    result.error === undefined ? null : h('p', { className: css.status }, line.join(' · ')),
    result.stdout === '' ? null : h('div', null, h('p', { className: css.streamLabel }, t('hookRunStdout')), h('pre', { className: panel.monoBlock }, result.stdout)),
    result.stderr === '' ? null : h('div', null, h('p', { className: css.streamLabel }, t('hookRunStderr')), h('pre', { className: panel.monoBlock }, result.stderr)),
    result.error !== undefined || wrote ? null : h('p', { className: css.status }, t('hookRunEmpty'))
  )
}
