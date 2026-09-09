import type { ModelCatalogPayload } from '../contracts/market.js'

interface ModelCatalogHost {
  get?(name: string): unknown
}

interface LlmDirectory {
  listProviders(): Array<{ id: string; name?: string }>
  listModels(provider: string): Promise<Array<{ id: string; name?: string }>>
  resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{ id: string; name?: string; reasoning?: ModelCatalogPayload['reasoning'] }>
}

/** Read providers, model identities, or one exact model's reasoning options with a bounded adapter wait. */
export async function readModelCatalog(host: ModelCatalogHost, provider?: string, model?: string): Promise<ModelCatalogPayload> {
  const llm = host.get?.('llm') as LlmDirectory | undefined
  if (llm === undefined) throw new Error('DSH model service is unavailable')
  if (model !== undefined && provider === undefined) throw new Error('A model requires a provider')
  const providers = llm.listProviders().map(entry => ({ id: entry.id, name: entry.name ?? entry.id }))
  if (provider === undefined) return { providers, models: [] }
  if (!providers.some(entry => entry.id === provider)) throw new Error('DSH model provider is unavailable')
  let timer: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController()
  try {
    return await Promise.race([
      (async (): Promise<ModelCatalogPayload> => {
        if (model === undefined) {
          const models = await llm.listModels(provider)
          return { providers, models: models.map(entry => ({ id: entry.id, name: entry.name ?? entry.id })) }
        }
        const resolved = await llm.resolveModelInfo(provider, model, controller.signal)
        return {
          providers,
          models: [{ id: resolved.id, name: resolved.name ?? resolved.id }],
          reasoning: {
            efforts: (resolved.reasoning?.efforts ?? []).map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description })
            })),
            ...(resolved.reasoning?.defaultEffort === undefined ? {} : { defaultEffort: resolved.reasoning.defaultEffort })
          }
        }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error('DSH model directory timed out'))
        }, 10_000)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
