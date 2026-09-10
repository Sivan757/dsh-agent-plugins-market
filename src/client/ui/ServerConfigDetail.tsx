import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { fetchServerConfig, saveServerConfig } from '../api.js'
import type { Translate } from '../index.js'
import { ServerConfigEditor } from './ServerConfigEditor.js'
import { parseServerConfig, type ServerKind } from './server-form.js'
import css from './detail.module.css'
import { DetailFooterAction } from './DetailModal.js'

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
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => {
    let active = true
    setLoading(true)
    setText(undefined)
    setError(undefined)
    setDirty(false)
    void fetchServerConfig(kind, id)
      .then(result => {
        if (!active) return
        setEditable(result.editable)
        setText(result.config === undefined ? undefined : JSON.stringify(result.config, null, 2))
      })
      .catch(reason => {
        if (active) setError(String(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [kind, id])
  const save = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await saveServerConfig(kind, id, parseServerConfig(text ?? ''))
      setDirty(false)
      onSaved?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
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
            onChange: value => {
              setText(value)
              setDirty(true)
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
