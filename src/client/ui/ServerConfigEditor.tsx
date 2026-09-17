/**
 * One JSON document backs both modes — the form and the JSON textarea are two
 * views of the same value. Invalid JSON is retained, never silently converted
 * or reset, and the form's own guards (unique map keys) are reported in place.
 *
 * The body uses the editors' shared form language, so a service editor and a
 * document editor lay their fields out identically.
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { Button, IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ServerPolicyPayload, ServerTimeoutPolicy } from '../../contracts/market.js'
import type { Translate } from '../index.js'
import { changeTransport, parseServerConfig, serverFormCompatible, timeoutMsFromText, type ServerKind, type ServerConfig, type ServerPolicyDraft } from './server-form.js'
import { DetailRow, DetailRows } from './DetailRows.js'
import formCss from './form.module.css'
import css from './detail.module.css'

/** One JSON document backs both modes. Invalid JSON is retained, never silently converted or reset. */
export function ServerConfigEditor(props: {
  kind: ServerKind
  text: string
  onChange: (text: string) => void
  t: Translate
  disabled?: boolean
  onValidityChange?: (valid: boolean) => void
  /**
   * The service's name field, owned by the calling modal. When supplied it is
   * rendered on the control row above the mode-specific body — paired with the
   * MCP transport selector, since both are one-line identity fields.
   */
  nameField?: { label: string; control: ReactNode }
  /** The MCP policy behind the document: stored timeouts, suite declaration, effective values. */
  policy?: ServerPolicyPayload
  /** The timeouts as editable text, owned by the calling dialog; absent hides the advanced section. */
  policyDraft?: ServerPolicyDraft
  onPolicyDraftChange?: (draft: ServerPolicyDraft) => void
  /** The MCP mount backend; `host` cannot enforce a startup timeout. */
  backend?: 'builtin' | 'host'
}): ReactNode {
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [advancedOpen, setAdvancedOpen] = useState(false)
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
  // The advanced section is the MCP policy seat: the dialog owns the draft, so
  // an invalid or half-typed timeout stops the save from the same validity
  // signal the document fields use.
  const advanced = props.policy !== undefined && props.policyDraft !== undefined && props.onPolicyDraftChange !== undefined
  const policyValid =
    !advanced ||
    (timeoutMsFromText(props.policyDraft!.toolCallTimeoutMs) !== undefined && timeoutMsFromText(props.policyDraft!.startupTimeoutMs) !== undefined)
  const valid = compatible && !hasIssue && requiredValid && policyValid
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
  const textField = (key: string, label: string, required = false, full = false): ReactNode =>
    h(
      'label',
      { className: full ? `${formCss.field} ${formCss.full}` : formCss.field, key },
      h('span', null, label),
      h('input', {
        value: typeof config?.[key] === 'string' ? config[key] : '',
        required,
        'aria-label': label,
        onChange: (event: { target: HTMLInputElement }) => field(key, event.target.value === '' && !required ? undefined : event.target.value)
      })
    )
  const mapField = (key: string, label: string, addLabel: string, narrowKey = false): ReactNode =>
    h(StringRows, {
      key,
      label,
      addLabel,
      t: props.t,
      map: true,
      narrowKey,
      value: config?.[key] as Record<string, string> | undefined,
      onChange: value => field(key, value),
      onIssue: bad => issue(key, bad)
    })
  const type = typeof config?.type === 'string' ? config.type : 'stdio'
  const auth = (config?.auth ?? {}) as Record<string, unknown>
  const transportField =
    props.kind === 'mcp'
      ? h(
          'label',
          { className: formCss.field },
          h('span', null, props.t('detailTransport')),
          h(
            'select',
            {
              value: type,
              'aria-label': props.t('detailTransport'),
              disabled: hasIssue,
              onChange: (event: { target: HTMLSelectElement }) => {
                // The selector disappears when the document cannot be parsed;
                // this guard keeps an in-flight value from reaching `update`.
                if (config === undefined) return
                update(changeTransport(config, event.target.value))
              }
            },
            ['stdio', 'streamable-http', 'sse'].map(value => h('option', { key: value, value }, value))
          )
        )
      : null
  const identityRow =
    props.nameField === undefined
      ? null
      : props.kind === 'mcp'
        ? h(
            'div',
            { className: formCss.formGrid },
            h('label', { className: formCss.field }, h('span', null, props.nameField.label), props.nameField.control),
            transportField
          )
        : h('label', { className: formCss.field }, h('span', null, props.nameField.label), props.nameField.control)
  const advancedSection =
    props.kind !== 'mcp' || !advanced
      ? null
      : h(
          DetailRows,
          null,
          h(
            DetailRow,
            {
              name: props.t('mcpAdvanced'),
              summary: props.t('mcpAdvancedSummary'),
              open: advancedOpen,
              onToggle: () => setAdvancedOpen(value => !value)
            },
            h(
              'div',
              { className: formCss.form },
              h(TimeoutField, {
                label: props.t('mcpToolCallTimeout'),
                resolution: props.policy!.toolCallTimeout,
                value: props.policyDraft!.toolCallTimeoutMs,
                disabled: props.disabled === true,
                t: props.t,
                onChange: value => props.onPolicyDraftChange!({ ...props.policyDraft!, toolCallTimeoutMs: value })
              }),
              h(TimeoutField, {
                label: props.t('mcpStartupTimeout'),
                resolution: props.policy!.startupTimeout,
                value: props.policyDraft!.startupTimeoutMs,
                disabled: props.disabled === true,
                ...(props.backend === 'host' ? { blocked: props.t('mcpHostStartupUnsupported') } : {}),
                // The input is fixed on this backend, so a value stored while
                // the built-in client was active is offered a way out.
                ...(props.backend === 'host' && props.policy!.startupTimeout.user !== null
                  ? { clearLabel: props.t('mcpTimeoutClearLabel', { name: props.t('mcpStartupTimeout') }), onClear: () => props.onPolicyDraftChange!({ ...props.policyDraft!, startupTimeoutMs: '' }) }
                  : {}),
                t: props.t,
                onChange: value => props.onPolicyDraftChange!({ ...props.policyDraft!, startupTimeoutMs: value })
              })
            )
          )
        )
  return h(
    'div',
    { className: formCss.form },
    h(
      'div',
      { className: formCss.seg },
      (['form', 'json'] as const).map(value =>
        h(
          'button',
          {
            type: 'button',
            key: value,
            'aria-pressed': mode === value,
            disabled: props.disabled || (value === 'json' && hasIssue),
            onClick: () => setMode(value)
          },
          props.t(value === 'form' ? 'detailForm' : 'detailJson')
        )
      )
    ),
    // Identity fields stay visible in both modes: the name identifies the
    // document and the transport decides which keys the JSON may carry.
    identityRow,
    parseError ? h('div', { role: 'alert', className: css.error }, props.t('detailInvalidJson'), ' ', parseError) : null,
    mode === 'json'
      ? h(
          'label',
          { className: formCss.field },
          h('span', null, props.t('detailJsonConfig')),
          h('textarea', {
            className: formCss.jsonArea,
            value: props.text,
            disabled: props.disabled,
            spellCheck: false,
            'aria-label': props.t('detailJson'),
            onChange: (event: { target: HTMLTextAreaElement }) => props.onChange(event.target.value)
          })
        )
      : !compatible
        ? h('div', { role: 'alert', className: css.error }, props.t('detailUseJson'))
        : h(
            'fieldset',
            { disabled: props.disabled, className: formCss.form, style: { border: 0, margin: 0, padding: 0 } },
            props.nameField === undefined ? transportField : null,
            props.kind === 'lsp' || type === 'stdio'
              ? [
                  textField('command', props.t('detailCommand'), true, true),
                  h(StringRows, {
                    key: 'args',
                    label: props.t('detailArgs'),
                    addLabel: props.t('detailAddArgs'),
                    t: props.t,
                    map: false,
                    value: config.args as string[] | undefined,
                    onChange: value => field('args', value),
                    onIssue: bad => issue('args', bad)
                  }),
                  mapField('env', props.t('detailEnv'), props.t('detailAddEnv'), true)
                ]
              : [textField('url', props.t('detailUrl'), true, true), mapField('headers', props.t('detailHeaders'), props.t('detailAddHeaders'), true)],
            props.kind === 'mcp' && type === 'stdio' ? textField('cwd', props.t('detailCwd'), false, true) : null,
            props.kind === 'mcp' && type !== 'stdio'
              ? h(
                  'fieldset',
                  { className: `${formCss.fieldset} ${formCss.full}` },
                  h('legend', null, 'OAuth'),
                  h(
                    'label',
                    { className: formCss.inlineCheck },
                    h('input', {
                      type: 'checkbox',
                      checked: auth.enabled !== false,
                      onChange: (event: { target: HTMLInputElement }) => field('auth', { ...auth, enabled: event.target.checked })
                    }),
                    ' ',
                    props.t('oauthEnable')
                  ),
                  h(
                    'label',
                    { className: `${formCss.field} ${formCss.full}` },
                    h('span', null, props.t('detailScope')),
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
                  mapField('extensionToLanguage', props.t('detailExtensions'), props.t('detailAddExtensions'), true),
                  ...(['initializationOptions', 'configuration'] as const).map(key =>
                    h(JsonField, { key, label: key, value: config[key], onChange: value => field(key, value), onIssue: bad => issue(key, bad) })
                  )
                ]
              : null
          ),
    advancedSection
  )
}

/**
 * One advanced timeout field: raw milliseconds text, with the effective value
 * as its placeholder, a line naming where an inherited value comes from, and an
 * optional control that empties the field back to inheritance.
 */
function TimeoutField(props: {
  label: string
  resolution: ServerTimeoutPolicy
  value: string
  disabled: boolean
  /** Why the field cannot be used here; absent when it can. */
  blocked?: string | undefined
  /** Accessible name of the clear control; absent with `onClear`. */
  clearLabel?: string | undefined
  onClear?: (() => void) | undefined
  t: Translate
  onChange: (value: string) => void
}): ReactNode {
  const invalid = timeoutMsFromText(props.value) === undefined
  const hint = invalid
    ? props.t('mcpTimeoutInvalid')
    : props.value.trim() === ''
      ? `${props.t('mcpTimeoutInherit')} · ${props.resolution.suite === null ? props.t('mcpTimeoutFromDefault') : props.t('mcpTimeoutFromSuite')}`
      : props.t('mcpTimeoutUserSet')
  return h(
    'div',
    { className: `${formCss.field} ${formCss.full}` },
    h('span', null, props.label),
    h(
      'div',
      { className: formCss.fieldRow },
      h('input', {
        // A text field with a numeric keypad: a number field's value
        // sanitization blanks anything it cannot parse, which would read as
        // "inherit" and save the timeout away instead of showing the typo.
        type: 'text',
        inputMode: 'numeric',
        value: props.value,
        placeholder: String(props.resolution.effective),
        'aria-label': props.label,
        disabled: props.disabled || props.blocked !== undefined,
        onChange: (event: { target: HTMLInputElement }) => props.onChange(event.target.value)
      }),
      props.onClear === undefined
        ? null
        : h(
            Button,
            {
              variant: 'ghost',
              size: 'sm',
              type: 'button',
              disabled: props.disabled,
              ...(props.clearLabel === undefined ? {} : { 'aria-label': props.clearLabel }),
              onClick: props.onClear
            },
            props.t('mcpTimeoutClear')
          )
    ),
    h('span', { className: invalid ? formCss.footerError : formCss.hint }, hint),
    props.blocked === undefined ? null : h('span', { className: formCss.hint }, props.blocked)
  )
}

/** The row editor behind a string list (arguments) and a string map (env, headers, extensions). */
function StringRows(props: {
  label: string
  addLabel: string
  t: Translate
  map: boolean
  /** Key column at 26% rather than 34% (an extension mapping is a narrow key). */
  narrowKey?: boolean
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
  const keySlot = props.narrowKey === true ? formCss.rowKeyNarrow : formCss.rowKey
  return h(
    'div',
    { className: `${formCss.field} ${formCss.full}` },
    // The action that appends a row rides on the field's own label line, where
    // it costs no extra height and no bordered button above the list.
    h(
      'div',
      { className: formCss.rowHead },
      h('span', null, props.label),
      h(
        'button',
        {
          type: 'button',
          className: formCss.addIcon,
          title: props.addLabel,
          // The accessible name stays `<add> <what>`: it names the list the row
          // joins.
          'aria-label': `${props.t('panelAdd')} ${props.label}`,
          onClick: () => change([...rows, ['', '']])
        },
        h(IconPlusOutline16)
      )
    ),
    h(
      'div',
      { className: formCss.rows },
      rows.map(([key, value], index) =>
      h(
        'div',
        { className: formCss.row, key: index },
        props.map
          ? h('input', {
              className: keySlot,
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
          'button',
          {
            type: 'button',
            className: formCss.iconBtn,
            title: props.t('panelDelete'),
            'aria-label': `${props.t('panelDelete')} ${props.label} ${index + 1}`,
            onClick: () => change(rows.filter((_, i) => i !== index))
          },
          h(IconTrashOutline16)
        )
      )
    ),
      invalid ? h('span', { role: 'alert', className: formCss.footerError }, props.t('detailUniqueKeys')) : null
    )
  )
}

/** One free-form JSON field (an LSP's initialization options or configuration). */
function JsonField(props: { label: string; value: unknown; onChange: (value: unknown) => void; onIssue: (bad: boolean) => void }): ReactNode {
  const [text, setText] = useState(props.value === undefined ? '' : JSON.stringify(props.value, null, 2))
  const [error, setError] = useState('')
  return h(
    'label',
    { className: `${formCss.field} ${formCss.full}` },
    h('span', null, props.label),
    h('textarea', {
      className: formCss.jsonArea,
      value: text,
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
    error ? h('span', { role: 'alert', className: formCss.footerError }, error) : null
  )
}
