/**
 * Creating one user hook: event, matcher, command, save.
 *
 * A hook is configuration the reader needs, not prose they read: the form is the
 * feature. The three fields are the whole entry, and saving appends to the
 * reader's own hook document without touching the entries already there.
 *
 * The dialog rides the same shell, the same field geometry, and the same footer
 * row as the service editors, so every create dialog in the workspace is one
 * shape seen from different tabs.
 *
 * @module features/hooks/HookCreateModal
 */
import { createElement as h, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { saveUserHook } from '../../api.js'
import { USER_HOOK_EVENTS, type UserHookEvent } from '../../../../market-contracts/src/contracts/user-hooks.js'
import { FormDialog } from '../../ui/DetailModal.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import type { Translate } from '../../i18n.js'
import css from '../../ui/form.module.css'

/** What the modal needs. */
export interface HookCreateModalProps {
  t: Translate
  /** Appends and closes; the panel refreshes so the new row appears. */
  onSaved: () => void
  onClose: () => void
}

/** The reader-facing name of each event, in the language in force. */
const EVENT_LABELS: Record<string, { zh: string; en: string }> = {
  SessionStart: { zh: '会话开始', en: 'session starts' },
  UserPromptSubmit: { zh: '用户发送消息', en: 'user sends a message' },
  PreToolUse: { zh: '工具调用前', en: 'before a tool call' },
  PostToolUse: { zh: '工具调用后', en: 'after a tool call' },
  PostToolUseFailure: { zh: '工具调用失败后', en: 'after a tool call fails' },
  Stop: { zh: '一轮回答结束', en: 'a turn of answering ends' },
  SubagentStart: { zh: '子代理启动', en: 'a subagent starts' },
  SubagentStop: { zh: '子代理结束', en: 'a subagent ends' },
  PreCompact: { zh: '上下文压缩前', en: 'before context is compacted' },
  SessionEnd: { zh: '会话结束', en: 'a session ends' }
}

export function HookCreateModal(props: HookCreateModalProps): ReactNode {
  const { t, onSaved, onClose } = props
  const zh = !String(t('localeProbeLang')).toLowerCase().startsWith('en')
  const [event, setEvent] = useState<UserHookEvent>('UserPromptSubmit')
  const [matcher, setMatcher] = useState('')
  const [command, setCommand] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const labelOf = (event: UserHookEvent): string => event + ' · ' + (zh ? (EVENT_LABELS[event]?.zh ?? '') : (EVENT_LABELS[event]?.en ?? ''))
  const save = (): void => {
    if (command.trim() === '' || saving) return
    setSaving(true)
    setError(undefined)
    saveUserHook({ event, command: command.trim(), ...(matcher.trim() === '' ? {} : { matcher: matcher.trim() }) })
      .then(() => {
        onSaved()
        onClose()
      })
      .catch(caught => setError(clientErrorMessage(t, caught)))
      .finally(() => setSaving(false))
  }
  return h(
    FormDialog,
    {
      onClose,
      title: t('hooksCreateTitle'),
      description: t('hooksCreateHint'),
      closeLabel: t('cancel'),
      ...(error === undefined ? {} : { alert: error }),
      actions: [
        h(Button, { key: 'cancel', variant: 'outline', onClick: onClose }, t('cancel')),
        h(Button, { key: 'save', variant: 'primary', disabled: saving || command.trim() === '', onClick: save }, t('hooksSave'))
      ]
    },
    h(
      'label',
      { className: css.field },
      h('span', null, t('hooksEventLabel')),
      h(
        'select',
        { value: event, 'aria-label': t('hooksEventLabel'), onChange: (event2: { target: HTMLSelectElement }) => setEvent(event2.target.value as UserHookEvent) },
        USER_HOOK_EVENTS.map(name => h('option', { key: name, value: name }, labelOf(name)))
      )
    ),
    h(
      'label',
      { className: css.field },
      h('span', null, t('hooksMatcherLabel')),
      h('input', {
        value: matcher,
        placeholder: 'Bash|Edit',
        'aria-label': t('hooksMatcherLabel'),
        onChange: (event2: { target: HTMLInputElement }) => setMatcher(event2.target.value)
      })
    ),
    h(
      'label',
      { className: css.field },
      h('span', null, t('hooksCommandLabel')),
      h('input', {
        value: command,
        placeholder: 'pnpm lint --fix',
        'aria-label': t('hooksCommandLabel'),
        onChange: (event2: { target: HTMLInputElement }) => setCommand(event2.target.value)
      })
    )
  )
}
