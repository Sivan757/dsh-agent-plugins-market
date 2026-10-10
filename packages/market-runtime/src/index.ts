/** Explicit cross-domain entry surface. Internal modules are not import targets for siblings. */
export { extensionResourceEnabled } from './application/extension-authorization.js'
export { exposesIndividualHooks } from './application/extension-hook-selection.js'
export { USER_HOOKS_SOURCE, USER_HOOKS_SUITE, loadUserHooksSuite } from './application/panels/user-hooks.js'
export { createPanelResources, pluginResourceId } from './application/panel-resources.js'
export { readExtensionSuiteDeclarations } from './application/extension-suite-declarations.js'
export type { ExtensionSuiteCandidate } from './application/extension-suite-selection.js'
export type { CatalogPort } from './catalog-port.js'
export type { PanelResourceStore } from './application/panel-resources.js'
export type { ResourceFilters } from './application/state/resource-filters.js'
export { RuntimeReconciler } from './runtime/core/reconciler.js'
export { ReconcileScheduler } from './runtime/core/reconcile-scheduler.js'
export { SurfaceToggleService } from './runtime/host/surface-toggle-service.js'
export { inspectToolRegistry, toolsServiceOf } from './runtime/host/tool-registry-observer.js'
export { mountAgentRoleTool } from './runtime/agents/agent-role-router.js'
export { mountUnlessAgentTeams } from './runtime/agents/agent-teams-seat.js'
export { mountTeammateRoleTool } from './runtime/agents/teammate-role-tool.js'
export { mountTeamCoordination } from './runtime/agents/team-coordination.js'
export { projectAgentRoles } from './application/project-agent-roles.js'
export { ExtensionRuntime, extensionWorkspace } from './runtime/host/extension-runtime.js'
export { attachExtensionToolGates } from './runtime/host/extension-tool-gates.js'
export type { ExtensionLspProvider, ExtensionMcpTool, ExtensionToolGates } from './runtime/host/extension-tool-gates.js'
export { ScopedExtensionContributors } from './runtime/host/scoped-contributors.js'
export { projectExtensionSuites, suiteOwnsResourceId } from './application/extension-suite-selection.js'
export { ResourceFilterService } from './runtime/host/resource-filter-service.js'
export { shellSeamOf } from './runtime/surfaces/dynamic-context.js'
export {
  HOOK_RUN_DEFAULT_TIMEOUT_SEC,
  HOOK_RUN_FAILED,
  HOOK_RUN_MAX_OUTPUT_CHARS,
  HOOK_RUN_MAX_TIMEOUT_MS,
  HOOK_RUN_NO_COMMAND,
  HOOK_RUN_SHELL_UNAVAILABLE,
  HOOK_RUN_UNKNOWN_DECLARATION,
  hookRunFailure,
  hookRunShellOf,
  hookRunStdin,
  runHookDryRun
} from './runtime/surfaces/hook-dry-run.js'
export type { HookDryRunOptions, HookRunShell, HookRunShellRequest, HookRunShellResult } from './runtime/surfaces/hook-dry-run.js'
export { LOCALE_SETTINGS_ENTRY, bindHostLocale, readHostLocalePreference, readLocalePreference, setHostLocaleSource } from './runtime/host/host-locale.js'
export type { HostLocaleKey, HostTranslate, LocaleSettingsSource } from './runtime/host/host-locale.js'
export { UserPanelSkillProvider, createUserPanelStores } from './runtime/panels/user-panels.js'
export { SourceAutoUpdater } from './runtime/core/source-auto-update.js'
export { collectMenuRowIdentities } from './runtime/host/menu-row-identities.js'
export type { ExtensionRouteService } from './extension-service.js'
export { readModelCatalog } from './runtime/host/model-catalog.js'
export type { McpMountFactory, RuntimeMounts, SharedMcpMountPort } from './adapter-contracts.js'
export { RetryScheduler, SerialPassQueue } from './runtime/core/mount-lifecycle.js'
export type { MountPluginHandle, PluginMountContext } from './runtime/core/mount-lifecycle.js'
export { causeMessages } from './runtime/host/failure-detail.js'
export { resolveDeclaredCommand } from './runtime/host/shell-path.js'
export { optionalService } from './runtime/core/context.js'
