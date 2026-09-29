import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ServerConfigPayload, ServerPolicyPayload } from '../../contracts/market.js'
import { addLspServer, addMcpServer, fetchServerConfig, saveServerConfig } from '../api.js'
import type { CredentialApi } from '../credentials.js'
import type { Translate } from '../index.js'
import { ServerConfigEditor } from './ServerConfigEditor.js'
import { composeServerDocument, fieldErrorsOf, parseServerConfig, parseServerDocument, policyDocumentOfDraft, policyDraftOfDocument, policyRequestOfDocuments, serverPolicyDocument, type ServerKind, type ServerPolicyDraft } from './server-form.js'
import css from './detail.module.css'
import { DetailFooterAction } from './DetailModal.js'
import { clientErrorMessage } from './error-message.js'

/** The document a new service starts from: the one field its transport requires. */
const NEW_DOCUMENT: Record<ServerKind, string> = {
  mcp: '{"type":"stdio","command":""}',
  lsp: '{"command":"","extensionToLanguage":{}}'
}

/** The name field's copy: one form, each kind's own wording. */
const NAME_COPY: Record<ServerKind, { label: 'mcpServerName' | 'lspServerName'; placeholder: 'mcpServerNamePh' | 'lspServerNamePh' }> = {
  mcp: { label: 'mcpServerName', placeholder: 'mcpServerNamePh' },
  lsp: { label: 'lspServerName', placeholder: 'lspServerNamePh' }
}

/**
 * One service's editor, for a service that exists and for one being created.
 *
 * The editor shows the document the specification seats a service in — the
 * portable definition under `mcpServers` plus this client's policy under the
 * `com.deepseek.harness` namespace — so every setting the client supports is
 * reachable as JSON. The form is a view over the same text and only writes the
 * half it owns, which is why a key the form has no control for survives an edit.
 *
 * Create mode differs in what only creating can: the service has no declaration
 * key yet, so the name is a field of the form, the document is the definition
 * itself, and the save adds a service instead of replacing one. Everything the
 * form shows and everything it checks is the same code.
 */
export function ServerConfigDetail({
  kind,
  id,
  create = false,
  t,
  credentials,
  onSaved,
  onDirtyChange
}: {
  kind: ServerKind
  /** The service's declaration key; absent while creating one. */
  id?: string
  /** Create mode: the name becomes a field and the save adds a new service. */
  create?: boolean
  t: Translate
  /** The host credential wire; the form configures MCP references through it. */
  credentials?: CredentialApi
  onSaved?: () => void
  onDirtyChange?: (dirty: boolean) => void
}): ReactNode {
  const [text, setText] = useState<string | undefined>(create ? NEW_DOCUMENT[kind] : undefined)
  const [initialText, setInitialText] = useState<string | undefined>(create ? NEW_DOCUMENT[kind] : undefined)
  const [name, setName] = useState('')
  const [serverKey, setServerKey] = useState('')
  const [editable, setEditable] = useState(create)
  const [valid, setValid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(!create)
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
   * the user stays in the section they were editing. A service being created has
   * nothing to read.
   */
  const load = async (silent = false): Promise<void> => {
    if (create || id === undefined) return
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
    if (create) return
    void load()
    return () => {
      requestToken.current += 1
    }
  }, [kind, id, create])

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setFieldErrors(undefined)
    try {
      if (create) {
        const config = parseServerConfig(text ?? '')
        if (kind === 'mcp') await addMcpServer(name.trim(), config)
        else await addLspServer(name.trim(), config)
      } else if (kind === 'mcp') {
        const document = parseServerDocument(text ?? '', serverKey)
        const initial = initialText === undefined ? {} : parseServerDocument(initialText, serverKey).policy
        await saveServerConfig(kind, id ?? '', document.config, policyRequestOfDocuments(initial, document.policy))
      } else {
        await saveServerConfig(kind, id ?? '', parseServerConfig(text ?? ''))
      }
      // Read back so the policy view, the placeholders and the dirty baseline
      // all describe what was stored, not what the form remembered.
      if (!create) await load(true)
      onSaved?.()
    } catch (reason) {
      setError(clientErrorMessage(t, reason))
      setFieldErrors(fieldErrorsOf(reason))
    } finally {
      setBusy(false)
    }
  }
  // Creating asks for the name the declaration key comes from, so an empty one
  // blocks the save; editing needs a change to save, as it always did.
  const saveable = valid && (create ? name.trim() !== '' : dirty)
  const nameCopy = NAME_COPY[kind]
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
            ...(credentials === undefined ? {} : { credentials }),
            ...(create
              ? {
                  nameField: {
                    label: t(nameCopy.label),
                    // A native control from the editors' own form sheet: the platform
                    // `Input` draws its own edge, which nested a second box inside the field.
                    control: h('input', {
                      value: name,
                      placeholder: t(nameCopy.placeholder),
                      'aria-label': t(nameCopy.label),
                      disabled: busy,
                      onChange: (event: { target: { value: string } }) => setName(event.target.value)
                    })
                  }
                }
              : {}),
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
                disabled: busy || !saveable,
                onClick: () => {
                  void save()
                }
              },
              busy ? t('loading') : t(create ? 'editorCreate' : 'save')
            )
          })
        : h('p', null, t('serverConfigReadOnly'))
  )
}
