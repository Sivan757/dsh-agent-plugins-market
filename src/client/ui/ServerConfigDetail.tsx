import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ServerConfigPayload, ServerPolicyPayload } from '../../contracts/market.js'
import { fetchServerConfig, saveServerConfig } from '../api.js'
import type { Translate } from '../index.js'
import { ServerConfigEditor } from './ServerConfigEditor.js'
import { composeServerDocument, fieldErrorsOf, parseServerConfig, parseServerDocument, policyDocumentOfDraft, policyDraftOfDocument, policyRequestOfDocuments, serverPolicyDocument, type ServerKind, type ServerPolicyDraft } from './server-form.js'
import css from './detail.module.css'
import { DetailFooterAction } from './DetailModal.js'
import { clientErrorMessage } from './error-message.js'

/**
 * One service's editor.
 *
 * The editor shows the document the specification seats a service in — the
 * portable definition under `mcpServers` plus this client's policy under the
 * `com.deepseek.harness` namespace — so every setting the client supports is
 * reachable as JSON. The form is a view over the same text and only writes the
 * half it owns, which is why a key the form has no control for survives an edit.
 */
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
  const [initialText, setInitialText] = useState<string>()
  const [serverKey, setServerKey] = useState('')
  const [editable, setEditable] = useState(false)
  const [valid, setValid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [policy, setPolicy] = useState<ServerPolicyPayload>()
  const [backend, setBackend] = useState<'builtin' | 'host'>()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>()
  // A late response from an earlier kind/id must not land on this editor, and
  // the reload after a save invalidates whatever read was still in flight.
  const requestToken = useRef(0)
  const dirty = text !== undefined && text !== initialText
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  /** The document's policy half, as the string drafts the timeout fields edit. */
  const policyDraft = (): ServerPolicyDraft => {
    if (kind !== 'mcp' || text === undefined) return { toolCallTimeoutMs: '', startupTimeoutMs: '' }
    try {
      return policyDraftOfDocument(parseServerDocument(text, serverKey).policy)
    } catch {
      return { toolCallTimeoutMs: '', startupTimeoutMs: '' }
    }
  }
  /** Write the timeout drafts back into the document's policy half. */
  const updatePolicy = (draft: ServerPolicyDraft): void => {
    if (text === undefined) return
    try {
      const document = parseServerDocument(text, serverKey)
      setText(composeServerDocument(serverKey, document.config, policyDocumentOfDraft(document.policy, draft)))
    } catch {
      /* an unparsable document stays as typed; the save reports why */
    }
  }

  /**
   * Read the service again and rebuild every derived value from the response.
   * `silent` keeps the editor mounted for the read-back that follows a save, so
   * the user stays in the section they were editing.
   */
  const load = async (silent = false): Promise<void> => {
    const token = ++requestToken.current
    setError(undefined)
    setFieldErrors(undefined)
    if (!silent) {
      setLoading(true)
      setText(undefined)
      setInitialText(undefined)
      setPolicy(undefined)
    }
    try {
      const result: ServerConfigPayload = await fetchServerConfig(kind, id)
      if (requestToken.current !== token) return
      const next = kind === 'mcp' ? composeServerDocument(result.key, result.config, serverPolicyDocument(result.policy)) : JSON.stringify(result.config, null, 2)
      setEditable(result.editable)
      setServerKey(result.key)
      setText(next)
      setInitialText(next)
      setPolicy(result.policy)
      setBackend(result.backend)
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
    setFieldErrors(undefined)
    try {
      if (kind === 'mcp') {
        const document = parseServerDocument(text ?? '', serverKey)
        const initial = initialText === undefined ? {} : parseServerDocument(initialText, serverKey).policy
        await saveServerConfig(kind, id, document.config, policyRequestOfDocuments(initial, document.policy))
      } else {
        await saveServerConfig(kind, id, parseServerConfig(text ?? ''))
      }
      // Read back so the policy view, the placeholders and the dirty baseline
      // all describe what was stored, not what the form remembered.
      await load(true)
      onSaved?.()
    } catch (reason) {
      setError(clientErrorMessage(t, reason))
      setFieldErrors(fieldErrorsOf(reason))
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
            serverKey,
            disabled: busy || !editable,
            onValidityChange: setValid,
            ...(policy === undefined ? {} : { policy }),
            policyDraft: policyDraft(),
            onPolicyDraftChange: updatePolicy,
            ...(backend === undefined ? {} : { backend }),
            ...(fieldErrors === undefined ? {} : { fieldErrors }),
            onChange: setText
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
