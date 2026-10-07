import type { Agent } from '@deepseek-ai/dsh-agent'
import { finalExtension } from '@deepseek-ai/dsh-lsp'
import { scopeChainOf } from '@deepseek-ai/dsh-scope'

export interface ExtensionToolResource {
  resourceId: string
  suiteId?: string
}

export interface ExtensionMcpTool extends ExtensionToolResource {
  name: string
  /** Exact object supplied to ToolRuntime.register, not an inferred public-name prefix. */
  definition: { readonly name: string }
  /** Registration scope; undefined is global. Own-scope visibility is controlled by the mount owner. */
  scope: object | undefined
}

export interface ExtensionLspProvider extends ExtensionToolResource {
  extensions: readonly string[]
}

export interface ExtensionToolOwnership {
  mcpTools(): readonly ExtensionMcpTool[]
  lspProviders(): readonly ExtensionLspProvider[]
  ownsLspTool(): boolean
}

export interface ExtensionToolPolicy {
  ready(agent: Agent): boolean
  allows(agent: Agent, resourceId: string, suiteId?: string): boolean
}

export interface ExtensionToolGates {
  /** Refresh presentation after acknowledged selection changes or provider reconciliation. */
  refresh(): void
  /** Release only this agent's restrictions, guards and listener; shared servers remain untouched. */
  dispose(): void
}

/** Keep error-code and identity prefixes stable; suffixes explain recovery without granting permission. */
const DISABLED_SUFFIX = ' — unavailable in this session. Do not retry unchanged; if required, ask the user to check session readiness and enable this resource.'
const INVALID_FILE_PATH_SUFFIX = ' — pass the file_path string of the target file, for example "src/index.ts".'
const NO_PROVIDER_SUFFIX = ' — no mounted LSP provider serves this extension. If required, ask the user to configure one.'
const AMBIGUOUS_PROVIDER_SUFFIX =
  ' — more than one mounted LSP provider serves this extension. Ask the user to resolve the configuration to exactly one mounted provider before retrying.'

/**
 * Filter inherited extension tools and guard Native/PTC execution using the public rc.2 runtime.
 * Policy errors and unready sessions deny owned capabilities. Project MCP mounts in the agent's
 * own scope must also filter their wanted rows: host restrictions do not hide own-scope tools.
 */
export function attachExtensionToolGates(agent: Agent, ownership: ExtensionToolOwnership, policy: ExtensionToolPolicy): ExtensionToolGates {
  const tools = agent.ctx.tools
  let disposed = false
  let refreshing = false
  let deniedNames = ''
  let releaseRestriction: (() => void) | undefined
  const allows = (resource: ExtensionToolResource): boolean => {
    try {
      return policy.ready(agent) && policy.allows(agent, resource.resourceId, resource.suiteId)
    } catch {
      return false
    }
  }
  const lspAllowed = (): boolean => ownership.lspProviders().some(allows)
  const refresh = (): void => {
    if (disposed || refreshing) return
    refreshing = true
    try {
      const ancestors = scopeChainOf(agent).slice(1)
      const deny = new Set(
        ownership
          .mcpTools()
          .filter(entry => (entry.scope === undefined || ancestors.includes(entry.scope)) && tools.get(entry.name, ancestors[0]) === entry.definition && !allows(entry))
          .map(entry => entry.name)
      )
      if (ownership.ownsLspTool() && tools.get('lsp') !== undefined && !lspAllowed()) deny.add('lsp')
      const names = [...deny].sort()
      const signature = JSON.stringify(names)
      if (signature === deniedNames) return
      // Publish the signature before restrict/dispose emit unfiltered tools/change notifications.
      deniedNames = signature
      const previous = releaseRestriction
      releaseRestriction = names.length === 0 ? undefined : tools.restrict({ deny: names })
      previous?.()
    } finally {
      refreshing = false
    }
  }
  const releaseGuard = tools.guard(exec => {
    if (exec.agent !== agent) return undefined
    const definition = tools.get(exec.name, agent)
    const owned = ownership.mcpTools().find(entry => entry.definition === definition)
    if (owned !== undefined && !allows(owned)) return 'extension-resource-disabled: ' + owned.resourceId + DISABLED_SUFFIX
    if (exec.name !== 'lsp' || !ownership.ownsLspTool() || definition !== tools.get('lsp')) return undefined
    const args = exec.arguments
    if (typeof args !== 'object' || args === null || !('file_path' in args) || typeof args.file_path !== 'string')
      return 'extension-lsp-route-unavailable: invalid file_path' + INVALID_FILE_PATH_SUFFIX
    const extension = finalExtension(args.file_path)
    const providers = ownership.lspProviders().filter(provider => provider.extensions.includes(extension))
    if (providers.length === 0) return 'extension-lsp-route-unavailable: ' + extension + NO_PROVIDER_SUFFIX
    if (providers.length > 1) return 'extension-lsp-route-unavailable: ' + extension + AMBIGUOUS_PROVIDER_SUFFIX
    const provider = providers[0]!
    return allows(provider) ? undefined : 'extension-resource-disabled: ' + provider.resourceId + DISABLED_SUFFIX
  })
  const releaseListener = agent.ctx.on('tools/change', refresh)
  try {
    refresh()
  } catch (error) {
    releaseListener()
    releaseGuard()
    releaseRestriction?.()
    throw error
  }
  return {
    refresh,
    dispose() {
      if (disposed) return
      disposed = true
      releaseListener()
      releaseGuard()
      releaseRestriction?.()
    }
  }
}
