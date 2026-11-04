/**
 * Creating one user hook: describe it, adjust the proposal, save it.
 *
 * A hook is configuration the reader needs, not prose they read: the form is the feature, and
 * the model only fills it in. The event and the command both stay editable after a draft, and
 * saving appends to the reader's own hook document without touching the entries already there.
 *
 * @module features/hooks/HookCreateModal
 */
import { createElement as h, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { draftUserHook, saveUserHook } from '../../api.js'
import { USER_HOOK_EVENTS, type UserHookEvent } from '../../../../market-contracts/src/contracts/user-hooks.js'
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
  const [intent, setIntent] = useState('')
  const [event, setEvent] = useState<UserHookEvent>('UserPromptSubmit')
  const [matcher, setMatcher] = useState('')
  const [command, setCommand] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const labelOf = (event: UserHookEvent): string => event + (zh ? ' · ' + (EVENT_LABELS[event]?.zh ?? '') : ' · ' + (EVENT_LABELS[event]?.en ?? ''))
  const draft = (): void => {
    if (intent.trim() === '' || busy) return
    setBusy(true)
    setError(undefined)
    draftUserHook({ intent, locale: zh ? 'zh' : 'en' })
      .then(drafted => {
        setEvent(drafted.event)
        setCommand(drafted.command)
        setMatcher(drafted.matcher ?? '')
      })
      .catch(caught => {
        const code = typeof caught === 'object' && caught !== null ? (caught as { code?: unknown }).code : undefined
        setError(code === 'ai-provider-limited' ? t('aiDraftLimited') : clientErrorMessage(t, caught))
      })
      .finally(() => setBusy(false))
  }
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
    Modal,
    {
      open: true,
      onClose,
      title: t('hooksCreateTitle'),
      description: t('hooksCreateHint'),
      closeLabel: t('cancel'),
      footer: h(
        'div',
        { className: css.footer },
        error === undefined ? null : h('span', { className: css.footerError, role: 'alert' }, error),
        h('div', { className: css.grow }),
        h(Button, { variant: 'outline', onClick: onClose }, t('cancel')),
        h(Button, { variant: 'primary', disabled: saving || command.trim() === '', onClick: save }, t('hooksSave'))
      )
    },
    h(
      'div',
      { className: css.field },
      h('span', null, t('hooksIntentLabel')),
      h(
        'div',
        { className: css.aiField, 'data-ai-draft': 'hooks' },
        h('input', {
          value: intent,
          disabled: busy,
          placeholder: t('hooksCreatePlaceholder'),
          'aria-label': t('hooksIntentLabel'),
          onChange: (event2: { target: HTMLInputElement }) => setIntent(event2.target.value)
        }),
        h(Button, { variant: 'outline', size: 'sm', disabled: busy || intent.trim() === '', onClick: draft }, busy ? t('aiDraftBusy') : t('hooksDraftAi'))
      )
    ),
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
