import type { Context } from '@deepseek-ai/cordis'
import { scopeOf } from '@deepseek-ai/dsh-scope'

export interface BridgeToolRegistration {
  definition: { readonly name: string }
  serverName: string
  scope: object | undefined
}

const registrations = new WeakMap<Context, Set<BridgeToolRegistration>>()

/** Publish identity before tools/change can expose a new definition; remove it after unregistering. */
export function registerOwnedBridgeTool(ctx: Context, serverName: string, definition: { readonly name: string }, register: () => () => void): () => void {
  let entries = registrations.get(ctx.root)
  if (entries === undefined) registrations.set(ctx.root, (entries = new Set()))
  const entry = { definition, serverName, scope: scopeOf(ctx) }
  entries.add(entry)
  try {
    const unregister = register()
    return () => {
      unregister()
      entries.delete(entry)
    }
  } catch (error) {
    entries.delete(entry)
    throw error
  }
}

/** Exact definitions owned by bridge instances in this registration scope, independent of presentation mode. */
export function bridgeToolRegistrations(ctx: Context): BridgeToolRegistration[] {
  const scope = scopeOf(ctx)
  return [...(registrations.get(ctx.root) ?? [])].filter(entry => entry.scope === scope)
}
