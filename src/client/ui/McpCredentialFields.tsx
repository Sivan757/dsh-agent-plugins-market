/**
 * One MCP service's secrets as compact write-only rows, plus the helpers that
 * say which seats spend which reference.
 *
 * Read facts (configured / source / writable) come from the value-free
 * credentials wire; a typed value crosses the wire exactly once, on the save
 * gesture, and never re-enters component state — the host control keeps no
 * value to render back. A blank draft writes nothing, which is what keeps the
 * stored key instead of clearing it. A reference the launch environment
 * supplies is read-only: it renders guidance instead of a control that could
 * only fake success. The dialog hosting these rows stands outside any settings
 * form, so the commit gesture is the row's own save control rather than the
 * form-model's save — the one deliberate local piece.
 *
 * Two kinds of secret live in one block because the service carries both: a
 * named reference the credential store answers, and a literal the document
 * itself holds (redacted to `[redacted]` before it crosses the wire). The rows
 * are disclosures — one line each, opening onto the control that writes the
 * value — and the detail dialog and the service editor both render them, so a
 * secret reads the same wherever the service is on screen.
 *
 * @module client/McpCredentialFields
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { Button, SettingsSecretField } from '@deepseek-ai/dsh-client-ui-primitives'
import { REDACTED_VALUE } from '../../contracts/mcp.js'
import { describeCredential, setCredential, unsetCredential, type CredentialApi } from '../credentials.js'
import type { Translate } from '../index.js'
import { DetailRow, DetailRows } from './DetailRows.js'
import panelCss from './panel.module.css'

/** What the credentials wire last reported for the references this block shows. */
interface CredentialFacts {
  /** Per reference: whether any layer supplies a value; absent while unknown. */
  configured: Record<string, boolean>
  /** Per reference: whether `credentials/set` can affect it. */
  writable: Record<string, boolean>
  /** Whether the credentials service answered at all. */
  available: boolean
}

/** The empty facts a fresh mount starts from: nothing known, service presumed. */
const UNKNOWN_FACTS: CredentialFacts = { configured: {}, writable: {}, available: true }

/**
 * One secret a service carries. A reference is a name the credential store
 * answers; a literal is a value the document holds itself, which is why only
 * the surface that owns the document can replace it.
 */
export type McpSecretEntry =
  | {
      kind: 'reference'
      /** The `${NAME}` reference this row writes. */
      ref: string
      /** Where it is spent, as `<field label> <key>` entries. */
      usage?: string[]
    }
  | {
      kind: 'literal'
      /** The seat that holds it, named the way the editor labels that seat. */
      label: string
      /** Replace the value in the document; absent where this surface cannot write it. */
      onReplace?: (value: string) => void
      /** Drop the value from the document; absent where this surface cannot write it. */
      onClear?: () => void
    }

/** One row's expansion state, keyed by the secret it shows. */
function rowKey(secret: McpSecretEntry, index: number): string {
  return secret.kind === 'reference' ? `ref:${secret.ref}` : `literal:${secret.label}:${index}`
}

/** One literal secret's row: write-only replacement of the value in the document. */
function LiteralSecretRow(props: {
  t: Translate
  secret: Extract<McpSecretEntry, { kind: 'literal' }>
  open: boolean
  onToggle: () => void
}): ReactNode {
  const { t, secret } = props
  const [draft, setDraft] = useState('')
  const writable = secret.onReplace !== undefined
  return h(
    DetailRow,
    {
      name: secret.label,
      summary: t('mcpCredentialHidden'),
      open: props.open,
      onToggle: props.onToggle
    },
    writable
      ? h(
          'div',
          null,
          h(SettingsSecretField, {
            id: `mcp-credential-${props.secret.label.replace(/[^A-Za-z0-9_-]+/g, '-')}`,
            label: t('mcpCredentialReplace'),
            hint: t('mcpCredentialHiddenHint'),
            text: draft,
            disabled: false,
            configured: true,
            stateLabel: t('mcpCredentialHidden'),
            onEdit: setDraft
          }),
          h(
            'div',
            { className: panelCss.heroLine },
            h(
              Button,
              {
                variant: 'primary',
                size: 'sm',
                disabled: draft.trim() === '',
                onClick: () => {
                  const value = draft.trim()
                  if (value === '') return
                  setDraft('')
                  secret.onReplace?.(value)
                }
              },
              t('mcpCredentialReplace')
            ),
            h(
              Button,
              {
                variant: 'ghost',
                size: 'sm',
                onClick: () => {
                  setDraft('')
                  secret.onClear?.()
                }
              },
              t('mcpCredentialUnset')
            )
          )
        )
      : h('p', { role: 'note' }, t('mcpCredentialEditInEditor'))
  )
}

/** One reference's row: the write-only control bound to the credentials wire. */
function ReferenceSecretRow(props: {
  t: Translate
  api: CredentialApi
  secret: Extract<McpSecretEntry, { kind: 'reference' }>
  open: boolean
  onToggle: () => void
  facts: CredentialFacts
  onFact: (ref: string, fact: { configured?: boolean; writable?: boolean }) => void
}): ReactNode {
  const { t, api, secret, facts } = props
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const configured = facts.configured[secret.ref]
  const writable = facts.writable[secret.ref] ?? true
  const state = configured === undefined ? t('loading') : configured ? t('mcpCredentialConfigured') : t('mcpCredentialMissing')

  /** Push the staged literal across the wire once, then re-read the truth. */
  const save = async (): Promise<void> => {
    const value = draft.trim()
    if (value === '' || busy) return
    setBusy(true)
    try {
      await setCredential(api, secret.ref, value)
      // The stored key stays when the draft is blank; a write clears the draft
      // so the next save needs a fresh literal.
      setDraft('')
      const view = await describeCredential(api, secret.ref).catch(() => undefined)
      props.onFact(secret.ref, { configured: view?.configured === true })
    } catch {
      // The Host refused the write; the draft survives so the user can retry.
    } finally {
      setBusy(false)
    }
  }

  /** Drop the stored credential so the server mounts without it. */
  const unset = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await unsetCredential(api, secret.ref)
      const view = await describeCredential(api, secret.ref).catch(() => undefined)
      props.onFact(secret.ref, { configured: view?.configured === true })
    } catch {
      // The Host refused; the badge keeps what the wire last reported.
    } finally {
      setBusy(false)
    }
  }

  const body =
    configured !== undefined && !writable
      ? // A read-only reference is supplied by the launch environment: guidance
        // in place of a control that could only fake success.
        h('p', { role: 'note' }, `${secret.ref} — ${t('mcpCredentialReadOnly')}`)
      : h(
          'div',
          null,
          h(SettingsSecretField, {
            id: `mcp-credential-${secret.ref}`,
            label: secret.ref,
            hint: (secret.usage ?? []).join(' · '),
            text: draft,
            disabled: busy,
            configured: configured === true,
            stateLabel: state,
            onEdit: setDraft
          }),
          h(
            'div',
            { className: panelCss.heroLine },
            h(Button, { variant: 'primary', size: 'sm', disabled: busy || draft.trim() === '', onClick: () => { void save() } }, t('mcpCredentialSave')),
            configured === true ? h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => { void unset() } }, t('mcpCredentialUnset')) : null
          )
        )
  return h(
    DetailRow,
    {
      name: secret.ref,
      summary: (secret.usage ?? []).length === 0 ? state : `${state} · ${(secret.usage ?? []).join(' · ')}`,
      open: props.open,
      onToggle: props.onToggle
    },
    body
  )
}

/**
 * The secrets of one MCP service.
 * @param props - the translate, the credentials API, and the secrets to show.
 * A literal row without writers is a report: the surface that shows it does not
 * own the document it lives in.
 * @returns the rows, or nothing when the service carries no secret.
 */
export function McpCredentialFields(props: { t: Translate; api?: CredentialApi; secrets: McpSecretEntry[] }): ReactNode {
  const { t, api, secrets } = props
  const [facts, setFacts] = useState<CredentialFacts>(UNKNOWN_FACTS)
  const [open, setOpen] = useState<string>()
  const references = secrets.flatMap(secret => (secret.kind === 'reference' ? [secret.ref] : []))
  const refKey = references.join('|')

  useEffect(() => {
    let cancelled = false
    setFacts(UNKNOWN_FACTS)
    if (api === undefined || references.length === 0) return () => {
      cancelled = true
    }
    void Promise.all(references.map(async ref => [ref, await describeCredential(api, ref).catch(() => undefined)] as const))
      .then(entries => {
        if (cancelled) return
        setFacts({
          configured: Object.fromEntries(entries.flatMap(([ref, view]) => (view === undefined ? [] : [[ref, view.configured === true]]))),
          writable: Object.fromEntries(entries.flatMap(([ref, view]) => (view === undefined ? [] : [[ref, view.writable === true]]))),
          available: true
        })
      })
      .catch(() => {
        if (!cancelled) setFacts({ ...UNKNOWN_FACTS, available: false })
      })
    return () => {
      cancelled = true
    }
  }, [api, refKey])

  if (secrets.length === 0) return null
  const onFact = (ref: string, fact: { configured?: boolean; writable?: boolean }): void => {
    setFacts(current => ({
      ...current,
      configured: fact.configured === undefined ? current.configured : { ...current.configured, [ref]: fact.configured },
      writable: fact.writable === undefined ? current.writable : { ...current.writable, [ref]: fact.writable }
    }))
  }
  const referenceRows = secrets.flatMap(secret => (secret.kind === 'reference' ? [secret] : []))
  return h(
    'div',
    { className: panelCss.block },
    h('h4', { className: panelCss.blockHead }, t('mcpCredentialTitle')),
    referenceRows.length > 0 && !facts.available
      ? h('p', { role: 'status' }, t('mcpCredentialUnavailable'))
      : h(
          DetailRows,
          null,
          secrets.map((secret, index) => {
            const key = rowKey(secret, index)
            const toggle = (): void => setOpen(current => (current === key ? undefined : key))
            if (secret.kind === 'literal') return h(LiteralSecretRow, { key, t, secret, open: open === key, onToggle: toggle })
            if (api === undefined) return h(DetailRow, { key, name: secret.ref, summary: (secret.usage ?? []).join(' · '), expandable: false })
            return h(ReferenceSecretRow, { key, t, api, secret, open: open === key, onToggle: toggle, facts, onFact })
          })
        )
  )
}

/**
 * Every credential reference a server definition spends, and where:
 * `{ TOKEN: ['请求头 Authorization', …] }`. Headers and environment are the
 * seats the mount resolves, so those are the two the map names.
 */
export function credentialUsage(t: Translate, config: Record<string, unknown> | undefined): Record<string, string[]> {
  const usage: Record<string, string[]> = {}
  if (config === undefined) return usage
  for (const [field, label] of [
    ['headers', t('detailHeaders')],
    ['env', t('detailEnv')]
  ] as const) {
    const values = config[field]
    if (typeof values !== 'object' || values === null) continue
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g)) {
        const name = match[1]
        if (name === undefined) continue
        const entries = usage[name] ?? []
        entries.push(`${label} ${key}`)
        usage[name] = entries
      }
    }
  }
  return usage
}

/**
 * The seats whose value the wire redacted: a literal secret the document holds,
 * named by the field and key that carry it. References are not literals — the
 * redaction preserves them — so the two lists never describe one seat twice.
 */
export function literalSeats(t: Translate, config: Record<string, unknown> | undefined): Array<{ field: 'headers' | 'env'; key: string; label: string }> {
  const seats: Array<{ field: 'headers' | 'env'; key: string; label: string }> = []
  if (config === undefined) return seats
  for (const [field, label] of [
    ['headers', t('detailHeaders')],
    ['env', t('detailEnv')]
  ] as const) {
    const values = config[field]
    if (typeof values !== 'object' || values === null) continue
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (value === REDACTED_VALUE) seats.push({ field, key, label: `${label} ${key}` })
    }
  }
  return seats
}

/**
 * The reference a value *is*, when the value is nothing but one: `${TOKEN}`
 * or `${TOKEN:-}` read as the credential, while a value with anything else in
 * it — a URL query, a non-empty fallback — stays text.
 */
export function credentialRefOf(value: string): string | undefined {
  return /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-)?\}$/.exec(value)?.[1]
}
