import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import type { Translate } from '../../index.js'
import { fetchModelCatalog } from '../../api.js'
import type { ModelCatalogPayload } from '../../../contracts/market.js'
import css from '../../ui/panel.module.css'
import { readRoleFields, updateFrontmatter, updateRoleReasoning } from './frontmatter.js'

/** Structured controls edit the same frontmatter as the raw Markdown editor. */
export function RoleMetadataFields(props: { text: string; onChange: (text: string) => void; t: Translate; disabled?: boolean }): ReactNode {
  let fields: ReturnType<typeof readRoleFields>
  try {
    fields = readRoleFields(props.text)
  } catch (error) {
    return h('p', { className: css.editorError, role: 'alert' }, props.t('personaMetadataInvalid'), ' ', String(error instanceof Error ? error.message : error))
  }
  return h(RoleFields, { ...props, fields })
}

function RoleFields(props: { text: string; onChange: (text: string) => void; t: Translate; disabled?: boolean; fields: ReturnType<typeof readRoleFields> }): ReactNode {
  const { fields, t } = props
  const [providers, setProviders] = useState<ModelCatalogPayload['providers']>([])
  const [models, setModels] = useState<ModelCatalogPayload['models']>([])
  const [loading, setLoading] = useState(true)
  const [providerError, setProviderError] = useState(false)
  const [modelError, setModelError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [reasoning, setReasoning] = useState<{ route: string; value: ModelCatalogPayload['reasoning'] }>()
  const [effortError, setEffortError] = useState<string>()
  const qualified = providers.filter(entry => fields.model.startsWith(`${entry.id}/`)).sort((a, b) => b.id.length - a.id.length)[0]
  const provider = fields.provider || qualified?.id || ''
  const model = !fields.provider && qualified ? fields.model.slice(qualified.id.length + 1) : fields.model === 'inherit' ? '' : fields.model
  const route = JSON.stringify([provider, model])
  const hasRoute = provider !== '' && model !== ''
  // The executor applies only an exact provider + model pair. Anything else that is
  // stored on disk is ignored and the child inherits the session route, so the form
  // has to say so instead of presenting it as a working route.
  const storedModel = fields.model === 'inherit' ? '' : fields.model
  const ignoredRoute = (fields.provider === '') !== (storedModel === '') || (storedModel !== '' && qualified !== undefined)
  const effortLoading = hasRoute && reasoning?.route !== route && effortError !== route
  const efforts = reasoning?.route === route ? reasoning.value?.efforts ?? [] : []

  useEffect(() => {
    const controller = new AbortController()
    setProviderError(false)
    void fetchModelCatalog(undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setProviders(data.providers)
    }).catch(() => { if (!controller.signal.aborted) setProviderError(true) })
    return () => controller.abort()
  }, [revision])

  useEffect(() => {
    const controller = new AbortController()
    setModels([])
    setModelError(false)
    if (provider === '') { setLoading(false); return () => controller.abort() }
    setLoading(true)
    void fetchModelCatalog(provider, controller.signal).then(data => {
      if (!controller.signal.aborted) setModels(data.models)
    }).catch(() => { if (!controller.signal.aborted) setModelError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [provider, revision])

  useEffect(() => {
    const controller = new AbortController()
    setReasoning(undefined)
    setEffortError(undefined)
    if (!hasRoute) return () => controller.abort()
    void fetchModelCatalog(provider, controller.signal, model).then(data => {
      if (!controller.signal.aborted) setReasoning({ route, value: data.reasoning })
    }).catch(() => { if (!controller.signal.aborted) setEffortError(route) })
    return () => controller.abort()
  }, [provider, model, route, hasRoute, revision])

  const selectProvider = (value: string): void => {
    const next = updateFrontmatter(props.text, 'provider', value)
    props.onChange(updateRoleReasoning(updateFrontmatter(next, 'model', value === '' ? 'inherit' : ''), ''))
  }
  return h(
    'fieldset',
    { className: css.roleFields, disabled: props.disabled },
    h('legend', null, props.t('personaRuntimeConfig')),
    h('label', { className: css.editorLabel }, t('personaProvider'),
      h('select', { className: css.editorInput, 'aria-label': t('personaProvider'), value: provider, onChange: (event: { target: HTMLSelectElement }) => selectProvider(event.target.value) },
        h('option', { value: '' }, t('personaInherit')),
        provider !== '' && !providers.some(entry => entry.id === provider) ? h('option', { value: provider }, `${provider} (${t('personaUnavailable')})`) : null,
        providers.map(entry => h('option', { key: entry.id, value: entry.id }, entry.name))
      )
    ),
    h('label', { className: css.editorLabel }, t('personaModel'),
      h('select', { className: css.editorInput, 'aria-label': t('personaModel'), value: model, disabled: provider === '' || loading, onChange: (event: { target: HTMLSelectElement }) => props.onChange(updateRoleReasoning(updateFrontmatter(updateFrontmatter(props.text, 'provider', provider), 'model', event.target.value), '')) },
        h('option', { value: '', disabled: provider !== '' }, provider === '' ? t('personaInherit') : loading ? t('loading') : t('personaSelectModel')),
        model !== '' && !models.some(entry => entry.id === model) ? h('option', { value: model }, `${model} (${t('personaUnavailable')})`) : null,
        models.map(entry => h('option', { key: entry.id, value: entry.id }, entry.name))
      )
    ),
    h('label', { className: css.editorLabel }, t('personaReasoningEffort'),
      h('select', {
        className: css.editorInput,
        'aria-label': t('personaReasoningEffort'),
        value: fields.reasoningEffort,
        disabled: effortLoading,
        onChange: (event: { target: HTMLSelectElement }) => props.onChange(updateRoleReasoning(props.text, event.target.value))
      },
        h('option', { value: '' }, effortLoading ? t('loading') : t('personaEffortAutomatic')),
        fields.reasoningEffort !== '' && !efforts.some(effort => effort.id === fields.reasoningEffort)
          ? h('option', { value: fields.reasoningEffort }, `${fields.reasoningEffort} (${t(reasoning?.route === route ? 'personaUnavailable' : 'personaEffortSaved')})`)
          : null,
        efforts.map(effort => h('option', { key: effort.id, value: effort.id, title: effort.description }, reasoning?.value?.defaultEffort === effort.id ? `${effort.name} (${t('personaEffortModelDefault')})` : effort.name))
      )
    ),
    providerError || modelError || effortError === route ? h('div', { role: 'alert', className: css.editorError }, t('personaCatalogError'), h('button', { type: 'button', onClick: () => setRevision(value => value + 1) }, t('refresh'))) : null,
    ignoredRoute ? h('p', { className: css.editorWarning, role: 'status' }, t('personaRouteIgnored')) : null,
    h('p', { className: css.editorHint }, props.t('personaModelHint'))
  )
}
