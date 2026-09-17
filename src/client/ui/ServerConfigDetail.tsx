import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ServerConfigPayload, ServerPolicyPayload } from '../../contracts/market.js'
import { fetchServerConfig, saveServerConfig } from '../api.js'
import type { Translate } from '../index.js'
import { ServerConfigEditor } from './ServerConfigEditor.js'
import { parseServerConfig, policyDraftOf, policyRequestOf, type ServerKind, type ServerPolicyDraft } from './server-form.js'
import css from './detail.module.css'
import { DetailFooterAction } from './DetailModal.js'
import { clientErrorMessage } from './error-message.js'

/** Loads complete configuration rather than editing the abbreviated status projection. */
export function ServerConfigDetail({
  kind,
  id,
  t,
  onSaved,
  onDirtyChange
}: {
  kind: ServerKind
  id: string
  t: Translate
  onSaved?: () => void
  onDirtyChange?: (dirty: boolean) => void
}): ReactNode {
  const [text, setText] = useState<string>()
  const [editable, setEditable] = useState(false)
  const [valid, setValid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [documentDirty, setDocumentDirty] = useState(false)
  const [policy, setPolicy] = useState<ServerPolicyPayload>()
  const [backend, setBackend] = useState<'builtin' | 'host'>()
  // The draft is the dialog's own state: the timeouts sit outside the JSON
  // document, and `initial` is what "dirty" and the save patch compare against.
  const [draft, setDraft] = useState<ServerPolicyDraft>()
  const [initialDraft, setInitialDraft] = useState<ServerPolicyDraft>()
  // A late response from an earlier kind/id must not land on this editor, and
  // the reload after a save invalidates whatever read was still in flight.
  const requestToken = useRef(0)
  const policyDirty = draft !== undefined && initialDraft !== undefined && (draft.toolCallTimeoutMs !== initialDraft.toolCallTimeoutMs || draft.startupTimeoutMs !== initialDraft.startupTimeoutMs)
  const dirty = documentDirty || policyDirty
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  /**
   * Read the service again and rebuild every derived value from the response.
   * `silent` keeps the editor mounted for the read-back that follows a save, so
   * the user stays in the section they were editing.
   */
  const load = async (silent = false): Promise<void> => {
    const token = ++requestToken.current
    setError(undefined)
    if (!silent) {
      setLoading(true)
      setText(undefined)
      setPolicy(undefined)
      setDraft(undefined)
      setInitialDraft(undefined)
    }
    try {
      const result: ServerConfigPayload = await fetchServerConfig(kind, id)
      if (requestToken.current !== token) return
      setEditable(result.editable)
      setText(result.config === undefined ? undefined : JSON.stringify(result.config, null, 2))
      setPolicy(result.policy)
      setBackend(result.backend)
      if (result.policy !== undefined) {
        const loaded = policyDraftOf(result.policy.toolCallTimeout.user, result.policy.startupTimeout.user)
        setDraft(loaded)
        setInitialDraft(loaded)
      }
      setDocumentDirty(false)
    } catch (reason) {
      if (requestToken.current === token) setError(String(reason))
    } finally {
      if (!silent && requestToken.current === token) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    return () => {
      requestToken.current += 1
    }
  }, [kind, id])

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await saveServerConfig(kind, id, parseServerConfig(text ?? ''), policyRequestOf(draft, initialDraft))
      // Read back so the policy view, the placeholders and the dirty baseline
      // all describe what was stored, not what the form remembered.
      await load(true)
      onSaved?.()
    } catch (reason) {
      setError(clientErrorMessage(t, reason))
    } finally {
      setBusy(false)
    }
  }
  return h(
    'section',
    null,
    error ? h('p', { role: 'alert', className: css.error }, error) : null,
    loading
      ? h('p', { role: 'status' }, t('loading'))
      : text === undefined
        ? null
        : h(ServerConfigEditor, {
            kind,
            text,
            t,
            disabled: busy || !editable,
            onValidityChange: setValid,
            ...(policy === undefined ? {} : { policy }),
            ...(draft === undefined ? {} : { policyDraft: draft, onPolicyDraftChange: setDraft }),
            ...(backend === undefined ? {} : { backend }),
            onChange: value => {
              setText(value)
              setDocumentDirty(true)
            }
          }),
    loading || (error && text === undefined)
      ? null
      : editable
        ? h(DetailFooterAction, {
            children: h(
              Button,
              {
                variant: 'primary',
                disabled: busy || !valid || !dirty,
                onClick: () => {
                  void save()
                }
              },
              busy ? t('loading') : t('save')
            )
          })
        : h('p', null, t('serverConfigReadOnly'))
  )
}
