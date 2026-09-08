import type { ModelCatalogPayload } from '../contracts/market.js'

interface ModelCatalogHost {
  get?(name: string): unknown
}

interface LlmDirectory {
  listProviders(): Array<{ id: string; name?: string }>
  listModels(provider: string): Promise<Array<{ id: string; name?: string }>>
}

/** Resolve the live host registry on demand; a slow adapter cannot hold the HTTP request indefinitely. */
export async function readModelCatalog(host: ModelCatalogHost, provider?: string): Promise<ModelCatalogPayload> {
  const llm = host.get?.('llm') as LlmDirectory | undefined
  if (llm === undefined) throw new Error('DSH model service is unavailable')
  const providers = llm.listProviders().map(entry => ({ id: entry.id, name: entry.name ?? entry.id }))
  if (provider === undefined) return { providers, models: [] }
  if (!providers.some(entry => entry.id === provider)) throw new Error('DSH model provider is unavailable')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const models = await Promise.race([
      llm.listModels(provider),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DSH model directory timed out')), 10_000)
      })
    ])
    return { providers, models: models.map(entry => ({ id: entry.id, name: entry.name ?? entry.id })) }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
