/**
 * One MCP server's credential references as write-only `SettingsSecretField`
 * controls, plus the usage map that says where each reference is spent.
 *
 * Read facts (configured / source / writable) come from the value-free
 * credentials wire; a typed value crosses the wire exactly once, on the save
 * gesture, and never re-enters component state — the host control keeps no
 * value to render back. A blank draft writes nothing, which is what keeps the
 * stored key instead of clearing it. A reference the launch environment
 * supplies is read-only: it renders guidance instead of a control that could
 * only fake success. The modal hosting these fields stands outside any
 * settings form, so the commit gesture is the field's own save control rather
 * than the form-model's save — the one deliberate local piece.
 *
 * The detail dialog and the service editor both mount this block: a secret is
 * configured the same way wherever the reference that needs it is on screen.
 *
 * @module client/McpCredentialFields
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { Button, SettingsSecretField } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeCredential, setCredential, unsetCredential, type CredentialApi } from '../credentials.js'
import type { Translate } from '../index.js'
import panelCss from './panel.module.css'

/** What the credentials wire last reported for the references this card shows. */
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

/** One reference's write-only control bound to the credentials wire. */
function CredentialField(props: {
  t: Translate
  api: CredentialApi
  /** The `${ENV_NAME}` reference this control writes; `ref` is a reserved React prop. */
  credentialRef: string
  usage: string
  facts: CredentialFacts
  onFact: (ref: string, fact: { configured?: boolean; writable?: boolean }) => void
}): ReactNode {
  const { t, api, credentialRef, usage, facts } = props
  // The draft lives here and only here: the control reports what the user
  // types, the write pushes it across the wire once, and neither keeps a value
  // to render back.
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const configured = facts.configured[credentialRef]
  const writable = facts.writable[credentialRef] ?? true
  // A read-only reference is supplied by the launch environment: guidance in
  // place of a control that could only fake success.
  if (configured !== undefined && !writable) {
    return h('p', { role: 'note' }, `${credentialRef} — ${t('mcpCredentialReadOnly')}`)
  }

  /** Push the staged literal across the wire once, then re-read the truth. */
  const save = async (): Promise<void> => {
    const value = draft.trim()
    if (value === '' || busy) return
    setBusy(true)
    try {
      await setCredential(api, credentialRef, value)
      // The stored key stays when the draft is blank; a write clears the draft
      // so the next save needs a fresh literal.
      setDraft('')
      const view = await describeCredential(api, credentialRef).catch(() => undefined)
      props.onFact(credentialRef, { configured: view?.configured === true })
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
      await unsetCredential(api, credentialRef)
      const view = await describeCredential(api, credentialRef).catch(() => undefined)
      props.onFact(credentialRef, { configured: view?.configured === true })
    } catch {
      // The Host refused; the state badge keeps what the wire last reported.
    } finally {
      setBusy(false)
    }
  }

  return h(
    'div',
    null,
    h(SettingsSecretField, {
      id: `mcp-credential-${credentialRef}`,
      label: credentialRef,
      hint: usage,
      text: draft,
      disabled: busy,
      configured: configured === true,
      stateLabel: configured === undefined ? t('loading') : configured ? t('mcpCredentialConfigured') : t('mcpCredentialMissing'),
      onEdit: setDraft
    }),
    h(
      'div',
      { style: { display: 'flex', gap: '8px' } },
      h(Button, { variant: 'primary', size: 'sm', disabled: busy || draft.trim() === '', onClick: () => { void save() } }, t('mcpCredentialSave')),
      configured === true ? h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => { void unset() } }, t('mcpCredentialUnset')) : null
    )
  )
}

/**
 * The write-only credential controls of one MCP server.
 * @param props - the translate, the credentials API, the server's references,
 * and where each reference is used, shown as the field's hint.
 * @returns the fields, or nothing when the server declares no references.
 */
export function McpCredentialFields(props: {
  t: Translate
  api?: CredentialApi
  refs: string[]
  /** Where each reference is used, as `<field label> <key>` entries. */
  usage?: Record<string, string[]>
}): ReactNode {
  const { t, api, refs, usage } = props
  const [facts, setFacts] = useState<CredentialFacts>(UNKNOWN_FACTS)
  const refKey = refs.join('|')

  useEffect(() => {
    let cancelled = false
    setFacts(UNKNOWN_FACTS)
    if (api === undefined || refs.length === 0) return () => {
      cancelled = true
    }
    void Promise.all(refs.map(async ref => [ref, await describeCredential(api, ref).catch(() => undefined)] as const))
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

  if (refs.length === 0) return null
  if (api === undefined || !facts.available) {
    return h('p', { role: 'status' }, t('mcpCredentialUnavailable'))
  }
  const onFact = (ref: string, fact: { configured?: boolean; writable?: boolean }): void => {
    setFacts(current => ({
      ...current,
      configured: fact.configured === undefined ? current.configured : { ...current.configured, [ref]: fact.configured },
      writable: fact.writable === undefined ? current.writable : { ...current.writable, [ref]: fact.writable }
    }))
  }
  return h(
    'div',
    { className: panelCss.block },
    h('h4', { className: panelCss.blockHead }, t('mcpCredentialTitle')),
    refs.map(ref =>
      h(CredentialField, {
        key: ref,
        t,
        api,
        credentialRef: ref,
        usage: (usage?.[ref] ?? []).join(' · '),
        facts,
        onFact
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
 * The reference a value *is*, when the value is nothing but one: `${TOKEN}`
 * or `${TOKEN:-}` read as the credential, while a value with anything else in
 * it — a URL query, a non-empty fallback — stays text.
 */
export function credentialRefOf(value: string): string | undefined {
  return /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-)?\}$/.exec(value)?.[1]
}
