import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { Button, IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../index.js'
import { changeTransport, parseServerConfig, serverFormCompatible, type ServerKind, type ServerConfig } from './server-form.js'
import css from './detail.module.css'

/** One JSON document backs both modes. Invalid JSON is retained, never silently converted or reset. */
export function ServerConfigEditor(props: {
  kind: ServerKind
  text: string
  onChange: (text: string) => void
  t: Translate
  disabled?: boolean
  onValidityChange?: (valid: boolean) => void
}): ReactNode {
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [issues, setIssues] = useState<Record<string, boolean>>({})
  let parsed: ServerConfig | undefined
  let parseError: string | undefined
  try {
    parsed = parseServerConfig(props.text)
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error)
  }
  // A `const` binding: the form body reads it from inside field callbacks, where
  // the narrowing of a reassignable binding would be discarded.
  const config = parsed
  const compatible = config !== undefined && serverFormCompatible(config, props.kind)
  const hasIssue = Object.values(issues).some(Boolean)
  const requiredValid =
    config !== undefined &&
    (props.kind === 'lsp'
      ? typeof config.command === 'string' &&
        config.command.trim() !== '' &&
        config.extensionToLanguage !== null &&
        typeof config.extensionToLanguage === 'object' &&
        Object.keys(config.extensionToLanguage).length > 0
      : config.type === 'stdio'
        ? typeof config.command === 'string' && config.command.trim() !== ''
        : ['sse', 'streamable-http'].includes(String(config.type)) && typeof config.url === 'string' && config.url.trim() !== '')
  const valid = compatible && !hasIssue && requiredValid
  useEffect(() => {
    props.onValidityChange?.(valid)
  }, [valid, props.onValidityChange])
  const update = (next: ServerConfig): void => props.onChange(JSON.stringify(next, null, 2))
  const field = (key: string, value: unknown): void => {
    const next = { ...config }
    if (value === undefined) delete next[key]
    else next[key] = value
    update(next)
  }
  const issue = (key: string, bad: boolean): void => {
    setIssues(current => {
      const next = { ...current, [key]: bad }
      return next
    })
  }
  const textField = (key: string, label: string, required = false): ReactNode =>
    h(
      'label',
      { className: css.field, key },
      label,
      h('input', {
        value: typeof config?.[key] === 'string' ? config[key] : '',
        required,
        'aria-label': label,
        onChange: (event: { target: HTMLInputElement }) => field(key, event.target.value === '' && !required ? undefined : event.target.value)
      })
    )
  const mapField = (key: string, label: string): ReactNode =>
    h(
      'div',
      { className: `${css.field} ${css.wide}`, key },
      h('span', null, label),
      h(StringRows, {
        key,
        label,
        t: props.t,
        map: true,
        value: config?.[key] as Record<string, string> | undefined,
        onChange: value => field(key, value),
        onIssue: bad => issue(key, bad)
      })
    )
  const type = typeof config?.type === 'string' ? config.type : 'stdio'
  const auth = (config?.auth ?? {}) as Record<string, unknown>
  return h(
    'div',
    { className: css.section },
    h(
      'div',
      { className: css.modes },
      (['form', 'json'] as const).map(value =>
        h(
          'button',
          {
            type: 'button',
            key: value,
            className: css.mode,
            'aria-pressed': mode === value,
            disabled: props.disabled || (value === 'json' && hasIssue),
            onClick: () => setMode(value)
          },
          props.t(value === 'form' ? 'detailForm' : 'detailJson')
        )
      )
    ),
    parseError ? h('div', { role: 'alert', className: css.error }, props.t('detailInvalidJson'), ' ', parseError) : null,
    mode === 'json'
      ? h('textarea', {
          className: css.raw,
          value: props.text,
          disabled: props.disabled,
          spellCheck: false,
          'aria-label': props.t('detailJson'),
          onChange: (event: { target: HTMLTextAreaElement }) => props.onChange(event.target.value)
        })
      : !compatible
        ? h('div', { role: 'alert', className: css.error }, props.t('detailUseJson'))
        : h(
            'fieldset',
            { disabled: props.disabled, className: css.form, style: { border: 0, margin: 0, padding: 0 } },
            props.kind === 'mcp'
              ? h(
                  'label',
                  { className: css.field },
                  props.t('detailTransport'),
                  h(
                    'select',
                    {
                      value: type,
                      'aria-label': props.t('detailTransport'),
                      disabled: hasIssue,
                      onChange: (event: { target: HTMLSelectElement }) => update(changeTransport(config, event.target.value))
                    },
                    ['stdio', 'streamable-http', 'sse'].map(value => h('option', { key: value, value }, value))
                  )
                )
              : null,
            props.kind === 'lsp' || type === 'stdio'
              ? [
                  textField('command', props.t('detailCommand'), true),
                  h(
                    'div',
                    { className: `${css.field} ${css.wide}`, key: 'args' },
                    h('span', null, props.t('detailArgs')),
                    h(StringRows, {
                      label: props.t('detailArgs'),
                      t: props.t,
                      map: false,
                      value: config.args as string[] | undefined,
                      onChange: value => field('args', value),
                      onIssue: bad => issue('args', bad)
                    })
                  ),
                  mapField('env', props.t('detailEnv'))
                ]
              : [textField('url', props.t('detailUrl'), true), mapField('headers', props.t('detailHeaders'))],
            props.kind === 'mcp' && type === 'stdio' ? textField('cwd', props.t('detailCwd')) : null,
            props.kind === 'mcp' && type !== 'stdio'
              ? h(
                  'div',
                  { className: css.field },
                  h(
                    'label',
                    null,
                    h('input', {
                      type: 'checkbox',
                    checked: auth.enabled !== false,
                      onChange: (event: { target: HTMLInputElement }) => field('auth', { ...auth, enabled: event.target.checked })
                    }),
                    ' OAuth'
                  ),
                  h(
                    'label',
                    { className: css.field },
                    props.t('detailScope'),
                    h('input', {
                      value: typeof auth.scope === 'string' ? auth.scope : '',
                      'aria-label': props.t('detailScope'),
                      onChange: (event: { target: HTMLInputElement }) => {
                      const next = { ...auth, scope: event.target.value }
                        field('auth', next)
                      }
                    })
                  )
                )
              : null,
            props.kind === 'lsp'
              ? [
                  mapField('extensionToLanguage', props.t('detailExtensions')),
                  ...(['initializationOptions', 'configuration'] as const).map(key =>
                    h(JsonField, { key, label: key, value: config[key], onChange: value => field(key, value), onIssue: bad => issue(key, bad) })
                  )
                ]
              : null
          )
  )
}

function StringRows(props: {
  label: string
  t: Translate
  map: boolean
  value?: Record<string, string> | string[]
  onChange: (value: Record<string, string> | string[]) => void
  onIssue: (bad: boolean) => void
}): ReactNode {
  const [rows, setRows] = useState<Array<[string, string]>>(() => (props.map ? Object.entries(props.value ?? {}) : ((props.value as string[]) ?? []).map(value => ['', value])))
  const [invalid, setInvalid] = useState(false)
  const change = (next: Array<[string, string]>): void => {
    setRows(next)
    const bad = props.map && (next.some(([key]) => key.trim() === '') || new Set(next.map(([key]) => key)).size !== next.length)
    setInvalid(bad)
    props.onIssue(bad)
    if (!bad) props.onChange(props.map ? Object.fromEntries(next) : next.map(([, value]) => value))
  }
  return h(
    'div',
    { className: css.rows },
    rows.map(([key, value], index) =>
      h(
        'div',
        { className: css.row, key: index },
        props.map
          ? h('input', {
              value: key,
              'aria-label': `${props.label} ${props.t('detailKey')} ${index + 1}`,
              onChange: (event: { target: HTMLInputElement }) => change(rows.map((row, i) => (i === index ? [event.target.value, row[1]] : row)))
            })
          : null,
        h('input', {
          value,
          'aria-label': `${props.label} ${props.t('detailValue')} ${index + 1}`,
          onChange: (event: { target: HTMLInputElement }) => change(rows.map((row, i) => (i === index ? [row[0], event.target.value] : row)))
        }),
        h(
          Button,
          {
            variant: 'ghost',
            size: 'sm',
            title: props.t('panelDelete'),
            'aria-label': `${props.t('panelDelete')} ${props.label} ${index + 1}`,
            onClick: () => change(rows.filter((_, i) => i !== index))
          },
          h(IconTrashOutline16)
        )
      )
    ),
    invalid ? h('span', { role: 'alert', className: css.error }, props.t('detailUniqueKeys')) : null,
    h(
      Button,
      { variant: 'ghost', size: 'sm', title: props.t('panelAdd'), 'aria-label': `${props.t('panelAdd')} ${props.label}`, onClick: () => change([...rows, ['', '']]) },
      h(IconPlusOutline16),
      props.t('panelAdd')
    )
  )
}

function JsonField(props: { label: string; value: unknown; onChange: (value: unknown) => void; onIssue: (bad: boolean) => void }): ReactNode {
  const [text, setText] = useState(props.value === undefined ? '' : JSON.stringify(props.value, null, 2))
  const [error, setError] = useState('')
  return h(
    'label',
    { className: `${css.field} ${css.wide}` },
    props.label,
    h('textarea', {
      value: text,
      rows: 4,
      'aria-label': props.label,
      onChange: (event: { target: HTMLTextAreaElement }) => {
        const next = event.target.value
        setText(next)
        try {
          const value: unknown = next.trim() === '' ? undefined : JSON.parse(next)
          setError('')
          props.onIssue(false)
          props.onChange(value)
        } catch (reason) {
          setError(String(reason))
          props.onIssue(true)
        }
      }
    }),
    error ? h('span', { role: 'alert', className: css.error }, error) : null
  )
}
