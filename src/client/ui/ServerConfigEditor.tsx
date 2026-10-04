/**
 * One JSON document backs both modes — the form and the JSON textarea are two
 * views of the same value. Invalid JSON is retained, never silently converted
 * or reset, and the form's own guards (unique map keys) are reported in place.
 *
 * The body uses the editors' shared form language, so a service editor and a
 * document editor lay their fields out identically.
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { Button, IconPlusOutlineMedium, IconShieldOutlineMedium, IconTrashOutlineMedium, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ServerPolicyPayload, ServerTimeoutPolicy } from '../../contracts/market.js'
import type { CredentialApi } from '../credentials.js'
import type { Translate } from '../index.js'
import { McpCredentialFields, credentialRefOf, credentialUsage, literalSeats, type McpSecretEntry } from './McpCredentialFields.js'
import { REDACTED_VALUE } from '../../contracts/mcp.js'
import { changeTransport, composeServerDocument, parseServerConfig, parseServerDocument, rowsFromPastedText, serverFormCompatible, timeoutMsFromText, type ServerKind, type ServerConfig, type ServerPolicyDraft } from './server-form.js'
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
  /** The declaration key this service carries; MCP documents are keyed by it. */
  serverKey?: string
  /** Reasons the API rejected a save, keyed by the editor field they belong to. */
  fieldErrors?: Record<string, string>
  /**
   * The host credential wire. MCP references are configured through it, so the
   * form offers the secret where the reference is written instead of leaving
   * the `${NAME}` syntax as the only thing on screen.
   */
  credentials?: CredentialApi
}): ReactNode {
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [issues, setIssues] = useState<Record<string, boolean>>({})
  let parsed: ServerConfig | undefined
  let policy: Record<string, unknown> = {}
  let parseError: string | undefined
  try {
    if (props.kind === 'mcp') {
      const document = parseServerDocument(props.text, props.serverKey ?? '')
      parsed = document.config
      policy = document.policy
    } else {
      parsed = parseServerConfig(props.text)
    }
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
  // The advanced section holds the optional inputs: what a service rarely needs
  // plus the client policy. The dialog owns the timeout draft, so an invalid or
  // half-typed timeout stops the save from the same validity signal the
  // document fields use.
  const timeouts = props.policy !== undefined && props.policyDraft !== undefined && props.onPolicyDraftChange !== undefined
  // The timeout drafts belong to the form view; while the JSON view is showing
  // them hidden, a draft it cannot parse must not block a save the user cannot
  // see a reason for. Switching back to the form re-applies the check.
  const policyValid =
    mode === 'json' ||
    !timeouts ||
    (timeoutMsFromText(props.policyDraft!.toolCallTimeoutMs) !== undefined && timeoutMsFromText(props.policyDraft!.startupTimeoutMs) !== undefined)
  const valid = compatible && !hasIssue && requiredValid && policyValid
  useEffect(() => {
    props.onValidityChange?.(valid)
  }, [valid, props.onValidityChange])
  // The form edits one half of the document; the other half rides along, so a
  // policy written in JSON survives a form edit and the definition survives a
  // policy edit.
  const update = (next: ServerConfig): void => props.onChange(props.kind === 'mcp' ? composeServerDocument(props.serverKey ?? '', next, policy) : JSON.stringify(next, null, 2))
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
  /** The example a server's own documentation shows for this field. */
  const placeholderFor = (key: string): string | undefined => {
    if (key === 'command') return props.t('detailCommandPh')
    if (key === 'url') return props.t('detailUrlPh')
    return undefined
  }
  /** The API's reason for one field, when it rejected a save. */
  const fieldError = (key: string): ReactNode => (props.fieldErrors?.[key] === undefined ? null : h('span', { className: formCss.footerError }, props.fieldErrors[key]))
  const textField = (key: string, label: string, required = false, full = false): ReactNode => {
    const placeholder = placeholderFor(key)
    return h(
      'label',
      { className: full ? `${formCss.field} ${formCss.full}` : formCss.field, key },
      h(
        'span',
        null,
        label,
        required ? h('span', { key: 'required', className: formCss.required, title: props.t('detailRequired'), 'aria-hidden': true }, '*') : null
      ),
      h('input', {
        value: typeof config?.[key] === 'string' ? config[key] : '',
        required,
        ...(placeholder === undefined ? {} : { placeholder }),
        'aria-label': label,
        onChange: (event: { target: HTMLInputElement }) => field(key, event.target.value === '' && !required ? undefined : event.target.value)
      }),
      fieldError(key)
    )
  }
  const mapField = (key: string, label: string, addLabel: string, narrowKey = false, references = false): ReactNode =>
    h(StringRows, {
      key,
      label,
      addLabel,
      t: props.t,
      map: true,
      narrowKey,
      references,
      value: config?.[key] as Record<string, string> | undefined,
      onChange: value => field(key, value),
      onIssue: bad => issue(key, bad),
      ...(props.fieldErrors?.[key] === undefined ? {} : { error: props.fieldErrors[key] })
    })
  const type = typeof config?.type === 'string' ? config.type : 'stdio'
  // The secrets this definition carries: the references it spends, and the
  // literals the wire redacted. Only MCP resolves the credential seam, so only
  // an MCP document has this block.
  const credentialUse = props.kind === 'mcp' && config !== undefined ? credentialUsage(props.t, config) : {}
  /** Write one map seat of this document, or drop it when the value is undefined. */
  const writeSeat = (seat: 'headers' | 'env', key: string, value: string | undefined): void => {
    const current = { ...((config?.[seat] as Record<string, string> | undefined) ?? {}) }
    if (value === undefined) delete current[key]
    else current[key] = value
    field(seat, Object.keys(current).length === 0 ? undefined : current)
  }
  const secretEntries: McpSecretEntry[] = Object.entries(credentialUse).map(([ref, usage]) => ({ kind: 'reference', ref, usage }))
  if (props.kind === 'mcp') {
    for (const seat of literalSeats(props.t, config))
      secretEntries.push({ kind: 'literal', label: seat.label, onReplace: value => writeSeat(seat.field, seat.key, value), onClear: () => writeSeat(seat.field, seat.key, undefined) })
  }
  const transportField =
    props.kind === 'mcp'
      ? h(
          'div',
          { className: formCss.field },
          h('span', null, props.t('detailTransport')),
          h(
            'div',
            { className: formCss.seg, role: 'group', 'aria-label': props.t('detailTransport') },
            ['stdio', 'streamable-http', 'sse'].map(value =>
              h(
                'button',
                {
                  type: 'button',
                  key: value,
                  'aria-pressed': type === value,
                  disabled: hasIssue,
                  onClick: () => {
                    // The control reads the document it renders; this guard keeps
                    // an in-flight value from reaching `update`.
                    if (config === undefined) return
                    update(changeTransport(config, value))
                  }
                },
                value
              )
            )
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
  /**
   * The advanced disclosure: one seat for the optional inputs. A stdio server
   * offers its working directory there, and both transports offer the client
   * timeouts when the calling dialog supplies the policy.
   */
  const advancedFields: ReactNode[] = []
  if (config !== undefined && type === 'stdio') {
    advancedFields.push(textField('cwd', props.t('detailCwd'), false, true))
  }
  if (timeouts) {
    advancedFields.push(
      h(TimeoutField, {
        key: 'toolCallTimeout',
        label: props.t('mcpToolCallTimeout'),
        resolution: props.policy!.toolCallTimeout,
        value: props.policyDraft!.toolCallTimeoutMs,
        disabled: props.disabled === true,
        t: props.t,
        onChange: value => props.onPolicyDraftChange!({ ...props.policyDraft!, toolCallTimeoutMs: value })
      }),
      h(TimeoutField, {
        key: 'startupTimeout',
        label: props.t('mcpStartupTimeout'),
        resolution: props.policy!.startupTimeout,
        value: props.policyDraft!.startupTimeoutMs,
        disabled: props.disabled === true,
        ...(props.backend === 'host' ? { blocked: props.t('mcpHostStartupUnsupported') } : {}),
        // The input is fixed on this backend, so a value stored while the
        // built-in client was active is offered a way out.
        ...(props.backend === 'host' && props.policy!.startupTimeout.user !== null
          ? { clearLabel: props.t('mcpTimeoutClearLabel', { name: props.t('mcpStartupTimeout') }), onClear: () => props.onPolicyDraftChange!({ ...props.policyDraft!, startupTimeoutMs: '' }) }
          : {}),
        t: props.t,
        onChange: value => props.onPolicyDraftChange!({ ...props.policyDraft!, startupTimeoutMs: value })
      })
    )
  }
  // The advanced section is a view over the document's own optional seats, so
  // the JSON view — which shows the whole document — does not repeat it.
  const advancedSection =
    props.kind !== 'mcp' || advancedFields.length === 0 || mode === 'json'
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
            h('div', { className: formCss.form }, advancedFields)
          )
        )
  return h(
    'div',
    { className: `${formCss.form} ${formCss.editorBody}` },
    h(SegmentedControl<'form' | 'json'>, {
      id: 'server-config-mode',
      value: mode,
      options: [
        { value: 'form', label: props.t('detailForm') },
        { value: 'json', label: props.t('detailJson') }
      ],
      // An issue locks both segments: leaving the form would hide the very
      // document the error describes, and the issue can only exist while in
      // form view.
      disabled: props.disabled || hasIssue,
      // The editor body is the panel both tabs control.
      label: props.t('detailJsonConfig'),
      onChange: setMode,
      // Layout only: the host control draws its own track and indicator, and
      // the track class meant for the hand-rolled groups below would leave its
      // segments content-sized inside a stretched track.
      className: formCss.segSelf
    }),
    // Identity fields stay visible in both modes: the name identifies the
    // document and the transport decides which keys the JSON may carry.
    identityRow,
    // Each transport configures a different set of fields, so the choice carries
    // its own explanation — on its own line, where it cannot push one column of
    // the identity row taller than the other.
    mode === 'form' && props.kind === 'mcp' && config !== undefined
      ? h('span', { className: `${formCss.hint} ${formCss.full}` }, props.t(type === 'stdio' ? 'transportHintStdio' : type === 'sse' ? 'transportHintSse' : 'transportHintHttp'))
      : null,
    parseError ? h('div', { role: 'alert', className: css.error }, props.t('detailInvalidJson'), ' ', parseError) : null,
    mode === 'json'
      ? h(
          'label',
          { className: `${formCss.field} ${formCss.jsonField}` },
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
                  // Only MCP resolves the credential seam, so only an MCP
                  // environment reads its references as credentials.
                  mapField('env', props.t('detailEnv'), props.t('detailAddEnv'), true, props.kind === 'mcp')
                ]
              : [textField('url', props.t('detailUrl'), true, true), mapField('headers', props.t('detailHeaders'), props.t('detailAddHeaders'), true, true)],
            props.kind === 'lsp'
              ? [
                  mapField('extensionToLanguage', props.t('detailExtensions'), props.t('detailAddExtensions'), true),
                  ...(['initializationOptions', 'configuration'] as const).map(key =>
                    h(JsonField, { key, label: key, value: config[key], onChange: value => field(key, value), onIssue: bad => issue(key, bad) })
                  )
                ]
              : null
          ),
    // The secrets the document carries, one collapsed row each: a reference is
    // written through the credential store, a literal through the document this
    // editor owns. The JSON view carries the document itself, so it needs none.
    secretEntries.length === 0 || mode === 'json'
      ? null
      : h(McpCredentialFields, {
          t: props.t,
          ...(props.credentials === undefined ? {} : { api: props.credentials }),
          secrets: secretEntries
        }),
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
  // An empty field inherits the placeholder's value silently; only a rejected
  // value and a value the user set themselves need a line of their own.
  const hint = invalid ? props.t('mcpTimeoutInvalid') : props.value.trim() === '' ? undefined : props.t('mcpTimeoutUserSet')
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
    hint === undefined ? null : h('span', { className: invalid ? formCss.footerError : formCss.hint }, hint),
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
  /** A value that is one credential reference renders as the credential it names. */
  references?: boolean
  value?: Record<string, string> | string[]
  onChange: (value: Record<string, string> | string[]) => void
  onIssue: (bad: boolean) => void
  /** The API's reason for this field, when a save was rejected. */
  error?: string
}): ReactNode {
  const [rows, setRows] = useState<Array<[string, string]>>(() => (props.map ? Object.entries(props.value ?? {}) : ((props.value as string[]) ?? []).map(value => ['', value])))
  const [invalid, setInvalid] = useState(false)
  /** Rows the user sent back to the text field from their credential chip. */
  const [textRows, setTextRows] = useState<ReadonlySet<number>>(() => new Set())
  const change = (next: Array<[string, string]>): void => {
    setRows(next)
    const bad = props.map && (next.some(([key]) => key.trim() === '') || new Set(next.map(([key]) => key)).size !== next.length)
    setInvalid(bad)
    props.onIssue(bad)
    if (!bad) props.onChange(props.map ? Object.fromEntries(next) : next.map(([, value]) => value))
  }
  const keySlot = props.narrowKey === true ? formCss.rowKeyNarrow : formCss.rowKey
  /**
   * One row's value cell. A value that is nothing but a credential reference
   * reads as the credential it names: the reference syntax is a document
   * detail, the secret is configured in the block below, and the raw text stays
   * reachable from the chip for anyone who wants to see or change it.
   */
  const valueCell = (index: number, value: string): ReactNode => {
    // A value the wire redacted is a secret the document holds: it reads as one
    // rather than as an editable `[redacted]` string, and the credential block
    // is where it is replaced or dropped.
    if (value === REDACTED_VALUE) {
      return h(
        'span',
        { className: `${formCss.credChip} ${formCss.credStatic}`, title: props.t('mcpCredentialHidden') },
        h(IconShieldOutlineMedium),
        h('span', { className: formCss.credChipName }, props.t('mcpCredentialHidden'))
      )
    }
    const reference = props.references === true && !textRows.has(index) ? credentialRefOf(value) : undefined
    if (reference === undefined) {
      return h('input', {
        value,
        'aria-label': `${props.label} ${props.t('detailValue')} ${index + 1}`,
        onChange: (event: { target: HTMLInputElement }) => change(rows.map((row, i) => (i === index ? [row[0], event.target.value] : row))),
        // A block copied out of a README becomes one row per line.
        onPaste: (event: ClipboardEvent) => {
          const pasted = event.clipboardData?.getData('text/plain') ?? ''
          if (!pasted.includes('\n')) return
          const parsed = rowsFromPastedText(pasted, props.map)
          if (parsed.length === 0) return
          event.preventDefault()
          change([...rows.filter(([key, value]) => key !== '' || value !== ''), ...parsed])
        }
      })
    }
    return h(
      'button',
      {
        type: 'button',
        className: formCss.credChip,
        // The document text stays one hover away; the chip is the reading.
        title: value,
        'aria-label': `${props.t('mcpCredentialRef')} ${reference}`,
        onClick: () => setTextRows(current => new Set(current).add(index))
      },
      h(IconShieldOutlineMedium),
      h('span', { className: formCss.credChipName }, reference)
    )
  }
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
        h(IconPlusOutlineMedium)
      )
    ),
    // An empty list is a starting point, not an empty space: the row itself is
    // the control that adds the first line, and it says so.
    rows.length === 0
      ? h(
          'button',
          { type: 'button', className: formCss.emptyRows, onClick: () => change([['', '']]) },
          props.map ? props.t('detailEmptyRowsMap') : props.t('detailEmptyRowsList')
        )
      : null,
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
        valueCell(index, value),
        h(
          'button',
          {
            type: 'button',
            className: formCss.iconBtn,
            title: props.t('panelDelete'),
            'aria-label': `${props.t('panelDelete')} ${props.label} ${index + 1}`,
            onClick: () => change(rows.filter((_, i) => i !== index))
          },
          h(IconTrashOutlineMedium)
        )
      )
    ),
      invalid ? h('span', { role: 'alert', className: formCss.footerError }, props.t('detailUniqueKeys')) : null,
      props.error === undefined ? null : h('span', { role: 'alert', className: formCss.footerError }, props.error)
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
