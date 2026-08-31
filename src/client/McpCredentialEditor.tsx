/**
 * Write-only credential editor for MCP `${ENV_NAME}` references.
 *
 * Read facts (configured / source / writable) come from the value-free
 * credentials wire; a typed value crosses the wire exactly once, inside
 * `credentials.set`, and never re-enters component state. Read-only
 * launch-environment credentials render guidance instead of a form that could
 * only fake success.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeCredential, setCredential, unsetCredential, type CredentialApi, type CredentialView } from './credentials.js'
import type { Translate } from './index.js'
import css from './mcp-credential.module.css'

export function McpCredentialEditor(props: { t: Translate; api?: CredentialApi; refs: string[] }): ReactNode {
  const { t, api, refs } = props
  const [views, setViews] = useState<Record<string, CredentialView>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const refKey = refs.join('|')

  useEffect(() => {
    let cancelled = false
    setViews({})
    setError(undefined)
    if (api === undefined || refs.length === 0) return () => {
      cancelled = true
    }
    void Promise.all(refs.map(async ref => [ref, await describeCredential(api, ref)] as const))
      .then(entries => {
        if (cancelled) return
        setViews(Object.fromEntries(entries.flatMap(([ref, view]) => (view === undefined ? [] : [[ref, view]]))))
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [api, refKey])

  if (refs.length === 0) return null
  const refresh = async (ref: string): Promise<void> => {
    if (api === undefined) return
    const view = await describeCredential(api, ref)
    if (view !== undefined) setViews(current => ({ ...current, [ref]: view }))
  }
  const save = async (ref: string): Promise<void> => {
    const value = drafts[ref]?.trim()
    if (api === undefined || value === undefined || value === '') return
    setBusy(ref)
    setError(undefined)
    try {
      await setCredential(api, ref, value)
      setDrafts(current => ({ ...current, [ref]: '' }))
      await refresh(ref)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(undefined)
    }
  }
  const unset = async (ref: string): Promise<void> => {
    if (api === undefined) return
    setBusy(ref)
    setError(undefined)
    try {
      await unsetCredential(api, ref)
      await refresh(ref)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(undefined)
    }
  }

  return h(
    'section',
    { className: css.form },
    h('h4', { className: css.head }, t('mcpCredentialTitle')),
    error === undefined ? null : h('div', { className: css.error }, error),
    refs.map(ref => {
      const view = views[ref]
      const refBusy = busy === ref
      return h(
        'div',
        { key: ref, className: css.row },
        h('code', { className: css.ref }, ref),
        view === undefined
          ? h('div', { className: css.note }, api === undefined ? t('mcpCredentialUnavailable') : t('loading'))
          : h(
              'div',
              { className: css.controls },
              h(
                'div',
                { className: css.facts },
                h('span', { className: view.configured ? css.factOk : css.factMiss }, view.configured ? t('mcpCredentialConfigured') : t('mcpCredentialMissing')),
                view.source === undefined ? null : h('span', { className: css.note }, view.source)
              ),
              view.writable
                ? h(
                    'div',
                    { className: css.editor },
                    h('input', {
                      className: css.input,
                      type: 'password',
                      autoComplete: 'new-password',
                      value: drafts[ref] ?? '',
                      placeholder: t('mcpCredentialPlaceholder'),
                      disabled: refBusy,
                      onChange: event => setDrafts(current => ({ ...current, [ref]: (event.target as HTMLInputElement).value }))
                    }),
                    h(
                      'div',
                      { className: css.actions },
                      h(Button, { variant: 'primary', size: 'sm', disabled: refBusy || (drafts[ref]?.trim() ?? '') === '', onClick: () => void save(ref) }, t('mcpCredentialSave')),
                      view.configured ? h(Button, { variant: 'ghost', size: 'sm', disabled: refBusy, onClick: () => void unset(ref) }, t('mcpCredentialUnset')) : null
                    )
                  )
                : h('div', { className: css.note }, t('mcpCredentialReadOnly'))
            )
      )
    })
  )
}
