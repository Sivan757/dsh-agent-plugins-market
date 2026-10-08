/** Extension inventory reuses catalog/panel status queries and preserves their full-detail identities. */
import { basename } from 'node:path'
import type { CatalogPort as Catalog } from '../../../market-runtime/src/index.js'
import type { PanelResourceStore } from '../../../market-runtime/src/index.js'
import { HOOK_EVENT_HOST_SUPPORT, hookResourceId, type ExtensionResource } from '../../../market-contracts/src/contracts/extension-presets.js'
import type { UserPanelEntryWire, UserPanelKind } from '../../../market-contracts/src/contracts/market.js'
import { SUITE_SURFACE_KEYS, type Suite, type SuiteSurfaceKey } from '../../../market-contracts/src/model/types.js'
import { USER_MCP_SOURCE, USER_MCP_SUITE } from '../../../market-mcp/src/index.js'
import type { McpSuiteOverrides } from '../../../market-mcp/src/index.js'
import { qualifiedSuiteId } from '../../../market-catalog/src/index.js'
import { deriveServerName } from '../../../market-mcp/src/index.js'
import type { ExtensionSuiteCandidate } from '../../../market-runtime/src/index.js'
import { USER_HOOKS_SOURCE, USER_HOOKS_SUITE } from '../../../market-runtime/src/index.js'
import { DIRECT_LSP_SUITE_ID } from '../../../market-lsp/src/index.js'

/** User-owned configuration is not a market offering. Its direct MCP servers have no suite parent. */
const isOwnedSentinel = (sourceId: string, id: string): boolean =>
  (sourceId === USER_MCP_SOURCE && id === USER_MCP_SUITE) || (sourceId === USER_HOOKS_SOURCE && id === USER_HOOKS_SUITE)

/** Classification does not change the identifiers used by existing preset and session records. */
function localConfiguration(suite: Suite): Pick<ExtensionResource, 'configuration' | 'name'> | undefined {
  if (suite.sourceId === USER_HOOKS_SOURCE && suite.id === USER_HOOKS_SUITE) return { configuration: 'user-hooks', name: 'User Hooks' }
  if (suite.dimension === 'project') return { configuration: 'project', name: suite.sourceId === 'native' ? basename(suite.root) : suite.manifest.name }
  return undefined
}

export interface ExtensionInventoryPorts {
  catalog: Pick<Catalog, 'overview' | 'mcpStatus' | 'lspStatus'>
  panels: Record<UserPanelKind, Pick<PanelResourceStore, 'list'>>
}

/** Shared options every mode honours. */
interface ExtensionInventoryBaseOptions {
  sessionId?: string
  mcpSessionControl?: boolean
  /** Legacy mode: installed/local suites without validated declarations. */
  projectSuites?: readonly Suite[]
}
/** Candidate mode: the override data must be explicit, because a missing value would read as "enabled". */
export interface ExtensionInventoryCandidateOptions extends ExtensionInventoryBaseOptions {
  /** Validated declarations from the parse owner; `validSurfaces` is the availability evidence. */
  candidates: readonly ExtensionSuiteCandidate[]
  /** Per-suite MCP overrides, keyed by resource id. Required: absence is never "on". */
  mcpOverrides: ReadonlyMap<string, McpSuiteOverrides>
  /** LSP server ids the user disabled, in the identity the LSP rows use. Required for the same reason. */
  lspDisabledIds: ReadonlySet<string>
}
/** Legacy mode: no candidates, so no validated-surface or override data exists. */
export interface ExtensionInventoryLegacyOptions extends ExtensionInventoryBaseOptions {
  candidates?: undefined
  mcpOverrides?: undefined
  lspDisabledIds?: undefined
}
export type ExtensionInventoryOptions = ExtensionInventoryCandidateOptions | ExtensionInventoryLegacyOptions

/** Suite panel ids are JSON tuples, not display names or flattened command identifiers. */
export function suiteResourceOwner(entry: UserPanelEntryWire): string | undefined {
  if (entry.origin !== 'plugin' || entry.id === undefined) return undefined
  try {
    const value: unknown = JSON.parse(entry.id)
    if (Array.isArray(value) && value.length === 4 && typeof value[0] === 'string' && typeof value[1] === 'string') {
      return 'market:' + value[0] + '/' + value[1]
    }
  } catch {
    /* Invalid provenance remains unavailable instead of guessing its owner. */
  }
  return undefined
}

/**
 * The composed global switch for one panel entry.
 *
 * Only a candidate's validated declaration can say whether an entry the panel
 * reports as off is an ordinary disabled consumer (selectable per session) or an
 * invalid one (not selectable at all). Without a candidate the panel's own verdict
 * is the whole answer, which is the legacy behaviour.
 */
function candidateEntryVerdict(
  candidate: ExtensionSuiteCandidate,
  kind: 'skills' | 'commands' | 'agents',
  name: string,
  panelDisabled: boolean
): { available: boolean; globalEnabled: boolean } {
  // An ordinary disabled consumer stays selectable per session; a surface that failed
  // validation, or an entry the declaration does not actually carry, does not.
  const selectable = candidate.validSurfaces[kind] === true && declaresResource(candidate, kind, name)
  // The panel's own flag cannot stand in for the parent switch: it reports one entry's
  // combined state, so a suite that is off globally must be composed in explicitly or
  // its entries would read as globally enabled.
  return { available: selectable, globalEnabled: selectable && globalSurfaceEnabled(candidate, kind) && !panelDisabled }
}
/** The composed global switch for one surface of one candidate suite. */
function globalSurfaceEnabled(candidate: ExtensionSuiteCandidate, kind: SuiteSurfaceKey): boolean {
  const { suite, validSurfaces } = candidate
  return suite.enabled && validSurfaces[kind] === true && suite.activeSurfaces?.[kind] === true
}
/**
 * A candidate is displayable while any surface or its system prompt validated; a
 * candidate the parser rejected contributes nothing to select.
 */
function candidateAvailable(candidate: ExtensionSuiteCandidate): boolean {
  const { suite, validSurfaces } = candidate
  return SUITE_SURFACE_KEYS.some(key => validSurfaces[key] === true) || (suite.systemPrompt !== undefined && suite.systemPrompt !== '')
}
/** Whether the validated declaration really carries the entry the panel reported. */
function declaresResource(candidate: ExtensionSuiteCandidate, kind: 'skills' | 'commands' | 'agents', name: string): boolean {
  return kind === 'skills' ? candidate.suite.skills.some(skill => skill.name === name) : (candidate.suite.resources?.[kind] ?? []).some(resource => resource.name === name)
}
export async function readExtensionInventory(ports: ExtensionInventoryPorts, options: ExtensionInventoryOptions = {}): Promise<ExtensionResource[]> {
  // A caller outside the type system could still name candidates without the override
  // data. Absence there would read as "enabled", so it is refused rather than guessed.
  if (options.candidates !== undefined && (options.mcpOverrides === undefined || options.lspDisabledIds === undefined))
    throw new Error('extension-inventory-override-data-required')
  const [overview, mcp, lsp, skills, commands, agents] = await Promise.all([
    ports.catalog.overview(),
    ports.catalog.mcpStatus(),
    ports.catalog.lspStatus(),
    ports.panels.skills.list(true),
    ports.panels.commands.list(true),
    ports.panels.agents.list(true)
  ])
  const rows: ExtensionResource[] = []
  for (const suite of overview.suites) {
    if (!suite.installed || suite.dimension !== 'user') continue
    rows.push({
      id: 'market:' + suite.sourceId + '/' + suite.suiteId,
      face: 'market',
      name: suite.name,
      source: suite.sourceId,
      description: suite.description,
      ...(suite.version === undefined ? {} : { version: suite.version }),
      available: suite.enabled !== false,
      counts: SUITE_SURFACE_KEYS.filter(key => suite.surfaces[key] > 0).map(key => ({ label: key, count: suite.surfaces[key] })),
      detail: { kind: 'suite', sourceId: suite.sourceId, suiteId: suite.suiteId }
    })
  }
  const candidates = options.candidates ?? []
  const candidateOwners = new Map(candidates.map(candidate => ['market:' + candidate.suite.sourceId + '/' + candidate.suite.id, candidate]))
  const rowById = new Map(rows.map(row => [row.id, row]))
  for (const candidate of candidates) {
    const { suite } = candidate
    // Direct MCP entries have no parent. User hooks retain a local configuration control, not a market card.
    if (suite.sourceId === USER_MCP_SOURCE && suite.id === USER_MCP_SUITE) continue
    const owner = 'market:' + suite.sourceId + '/' + suite.id
    const usable = candidateAvailable(candidate)
    const globalEnabled = usable && suite.enabled && SUITE_SURFACE_KEYS.some(key => globalSurfaceEnabled(candidate, key))
    // One suite is one row. The overview row stays the display authority — its name and
    // description carry the panel's translation — while the validated declaration
    // supplies availability and the switch.
    const existing = rowById.get(owner)
    if (existing !== undefined) {
      existing.available = usable
      existing.globalEnabled = globalEnabled
      Object.assign(existing, localConfiguration(suite))
      continue
    }
    // A project suite the overview never listed still needs its row.
    const row: ExtensionResource = {
      id: owner,
      face: 'market',
      name: suite.manifest.name,
      ...localConfiguration(suite),
      source: suite.sourceId,
      description: suite.manifest.description,
      available: usable,
      globalEnabled,
      counts: SUITE_SURFACE_KEYS.filter(key => suite.surfaces[key] > 0).map(key => ({ label: key, count: suite.surfaces[key] })),
      detail: { kind: 'suite', sourceId: suite.sourceId, suiteId: suite.id, ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }) }
    }
    rows.push(row)
    rowById.set(owner, row)
  }
  for (const suite of options.projectSuites ?? []) {
    const owner = 'market:' + suite.sourceId + '/' + suite.id
    // Candidate validation already owns this resource; legacy discovery cannot append or override it.
    if (rowById.has(owner)) continue
    const row: ExtensionResource = {
      id: owner,
      face: 'market',
      name: suite.manifest.name,
      ...localConfiguration(suite),
      source: suite.sourceId,
      available: suite.enabled,
      description: suite.manifest.description,
      counts: SUITE_SURFACE_KEYS.filter(key => suite.surfaces[key] > 0).map(key => ({ label: key, count: suite.surfaces[key] })),
      detail: { kind: 'suite', sourceId: suite.sourceId, suiteId: suite.id, ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }) }
    }
    rows.push(row)
    rowById.set(owner, row)
  }
  const projectOwners = new Set((options.projectSuites ?? []).map(suite => 'market:' + suite.sourceId + '/' + suite.id))
  const address = (owner: string | undefined) => (owner !== undefined && projectOwners.has(owner) && options.sessionId !== undefined ? { sessionId: options.sessionId } : {})
  const parents = new Map(rows.map(row => [row.id, row.available]))
  // The user's own hook declarations are configuration rows, not suite children:
  // one row per declared command hook, grouped by event, carrying the host's
  // support verdict for that event. A supported event's rows select like any
  // other resource; a partial or registered-only event's rows stay read-only
  // with the reason, so the Hooks tab registers the declaration without
  // pretending the host runs it.
  for (const suite of options.projectSuites ?? []) {
    if (suite.hooks === undefined) continue
    const provenance = suite.sourceId === USER_HOOKS_SOURCE && suite.id === USER_HOOKS_SUITE ? 'user-hooks' : suite.manifest.name
    const supportedEvents = suite.hooks.events
    for (const [event, groups] of Object.entries(supportedEvents)) {
      const support = HOOK_EVENT_HOST_SUPPORT[event] ?? 'registered-only'
      const selectable = support === 'supported'
      let index = 0
      for (const group of groups) {
        for (const hook of group.hooks) {
          // The position is the identity the row was published under, so it is
          // read before the counter moves rather than inside the id expression.
          const hookIndex = index
          index += 1
          rows.push({
            id: hookResourceId(suite.sourceId, suite.id, event, hookIndex),
            face: 'hooks',
            name: hook.command,
            source: group.matcher === undefined || group.matcher === '*' ? provenance : provenance + ' · ' + group.matcher,
            description: event,
            suiteResourceId: 'market:' + suite.sourceId + '/' + suite.id,
            ...(selectable
              ? { available: true, globalEnabled: true }
              : { available: false, control: 'global-only', unavailableReason: support === 'supported-partial' ? 'hook-event-partial' : 'hook-event-unsupported' }),
            // The detail a row opens is the hook itself, not the suite behind it:
            // every field the surface shows comes from this scanned declaration.
            detail: {
              kind: 'hook',
              sourceId: suite.sourceId,
              suiteId: suite.id,
              event,
              hookIndex,
              command: hook.command,
              ...(group.matcher === undefined ? {} : { matcher: group.matcher }),
              ...(hook.timeout === undefined ? {} : { timeoutSec: hook.timeout }),
              provenance,
              support,
              ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId })
            }
          })
        }
      }
    }
    // Declarations the catalog validator rejected (Notification, SessionEnd,
    // PreCompact and anything else the host cannot run) exist only as
    // diagnostics on the suite. Each names its event, so one read-only row per
    // diagnostic registers the declaration in the Hooks tab instead of letting
    // it disappear into the suite detail's error list.
    for (const error of suite.errors) {
      const event = /^\S+ unsupported hook event (\S+)$/.exec(error)?.[1]
      if (event === undefined) continue
      const support = HOOK_EVENT_HOST_SUPPORT[event] ?? 'registered-only'
      rows.push({
        id: 'hooks:' + suite.sourceId + '/' + suite.id + '/' + event + '/declared',
        face: 'hooks',
        name: event,
        source: provenance,
        description: event,
        available: false,
        control: 'global-only',
        unavailableReason: support === 'supported-partial' ? 'hook-event-partial' : 'hook-event-unsupported',
        // A rejected declaration has no admitted hook, so the detail carries the
        // event and the validator's own words instead of a command or position.
        detail: {
          kind: 'hook',
          sourceId: suite.sourceId,
          suiteId: suite.id,
          event,
          provenance,
          support,
          diagnostic: error,
          ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId })
        }
      })
    }
  }
  for (const [face, entries] of [
    ['skills', skills],
    ['commands', commands],
    ['agents', agents]
  ] as const) {
    for (const entry of entries) {
      const owner = suiteResourceOwner(entry)
      const identity = entry.id ?? entry.name
      rows.push({
        id: face + ':' + identity,
        face,
        name: entry.name,
        description: entry.translatedDescription ?? entry.description,
        source: entry.suiteName ?? 'user',
        ...(owner === undefined ? {} : { suiteResourceId: owner }),
        ...(face === 'skills' && entry.origin === 'user'
          ? { globalEnabled: !entry.disabled, available: entry.metadata['validationError'] === undefined }
          : candidateOwners.has(owner ?? '')
            ? candidateEntryVerdict(candidateOwners.get(owner!)!, face, entry.name, entry.disabled)
            : // A native (user-origin) entry the user switched off is an ordinary disabled
              // consumer: a preset may name it. A document that failed to parse is not
              // selectable, whatever a preset says, and `metadata.validationError` is the
              // panel's own evidence for that.
              entry.origin === 'user'
              ? { available: entry.metadata['validationError'] === undefined, globalEnabled: !entry.disabled && entry.metadata['validationError'] === undefined }
              : { available: !entry.disabled && owner !== undefined && parents.get(owner) === true }),
        detail: { kind: 'panel', panel: face, entryId: identity, ...address(owner) }
      })
    }
  }
  for (const entry of mcp.entries) {
    const owner = entry.suiteId === undefined || entry.suiteId === USER_MCP_SOURCE + '/' + USER_MCP_SUITE ? undefined : 'market:' + entry.suiteId
    const row: ExtensionResource = {
      id: 'mcp:' + entry.id,
      face: 'mcp',
      name: entry.name,
      source: entry.source ?? 'direct',
      description: entry.transport,
      ...((entry.kind === 'direct' && entry.managed !== true) || options.mcpSessionControl === false
        ? { control: 'global-only' as const, unavailableReason: entry.kind === 'direct' && entry.managed !== true ? 'direct-mcp-uncontrolled' : 'host-mcp-uncontrolled' }
        : {}),
      ...(owner === undefined ? {} : { suiteResourceId: owner }),
      available: entry.state !== 'disabled' && entry.state !== 'foreign' && entry.state !== 'orphaned' && (owner === undefined || parents.get(owner) === true),
      detail: { kind: 'mcp', entryId: entry.id, ...address(owner) }
    }
    rows.push(row)
    // Registered so a candidate corrects this row in place instead of adding another.
    rowById.set(row.id, row)
  }
  for (const entry of lsp.entries) {
    const owner = entry.kind === 'direct' ? undefined : 'market:' + entry.suiteId
    const row: ExtensionResource = {
      id: 'lsp:' + entry.id,
      face: 'lsp',
      name: entry.serverKey,
      source: entry.kind === 'direct' ? 'direct' : entry.suiteName,
      description: entry.command,
      ...(owner === undefined ? {} : { suiteResourceId: owner }),
      // Only candidate mode can say a disabled direct server is still nameable, because
      // only then does the caller supply the disabled-id switch. Legacy mode has no such
      // evidence, so it keeps the original rule exactly: a disabled row is unavailable.
      available:
        entry.kind === 'direct'
          ? options.candidates === undefined
            ? entry.state !== 'disabled'
            : entry.state !== 'failed' && entry.state !== 'conflict' && entry.state !== 'host-missing'
          : entry.state !== 'disabled' && parents.get(owner!) === true,
      ...(entry.kind !== 'direct'
        ? { globalEnabled: entry.state !== 'disabled' }
        : options.candidates === undefined || options.lspDisabledIds === undefined
          ? {}
          : { globalEnabled: !options.lspDisabledIds.has(entry.id) }),
      detail: { kind: 'lsp', entryId: entry.id, ...address(owner) }
    }
    rows.push(row)
    rowById.set(row.id, row)
  }
  // Rows for declarations the status layer omits, because it only reports installed
  // and globally enabled suites. These are exactly the entries a preset still has to
  // be able to name, and they are synthesized from the validated declaration rather
  // than inferred from the absence of a status row.
  for (const candidate of candidates) {
    const { suite } = candidate
    const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
    // A user-owned sentinel's server is a direct resource: it has no suite parent to
    // gate it, exactly as the status layer reports the same server.
    const owner = isOwnedSentinel(suite.sourceId, suite.id) ? undefined : 'market:' + suite.sourceId + '/' + suite.id
    const ownerAvailable = owner === undefined || parents.get(owner) === true
    // Overrides are keyed by the source-qualified suite key the MCP layer itself uses,
    // not by the resource id a preset names.
    const overrides = options.mcpOverrides?.get(suiteKey)
    for (const [serverKey, server] of Object.entries(suite.mcp?.servers ?? {})) {
      const rowId = 'plugin:' + suiteKey + '/' + serverKey
      const override = overrides?.[serverKey]
      const selectable = ownerAvailable && candidate.validSurfaces.mcp === true
      const globalEnabled = override?.enabled === false ? false : globalSurfaceEnabled(candidate, 'mcp')
      // The status layer reports the row for an enabled suite and updates it in place;
      // a row it omitted (a disabled suite) is synthesized from the declaration. Either
      // way a status row that exists is corrected, never duplicated.
      const existing = rowById.get('mcp:' + rowId)
      if (existing !== undefined) {
        existing.available = selectable
        existing.globalEnabled = globalEnabled
        continue
      }
      const hostBackend = options.mcpSessionControl === false
      rows.push({
        id: 'mcp:' + rowId,
        face: 'mcp',
        name: deriveServerName(suite, serverKey),
        source: suite.manifest.name,
        description: server.type,
        ...(hostBackend ? { control: 'global-only' as const, unavailableReason: 'host-mcp-uncontrolled' } : {}),
        suiteResourceId: owner,
        available: selectable,
        globalEnabled,
        detail: { kind: 'mcp', entryId: rowId, ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }) }
      })
    }
    for (const spec of Object.values(suite.lsp?.servers ?? {})) {
      const rowId = suiteKey + '/' + spec.key
      if (suiteKey === DIRECT_LSP_SUITE_ID) continue
      // A project suite's LSP declaration is never enableable, whatever the preset says.
      const valid = candidate.validSurfaces.lsp === true
      const selectable = ownerAvailable && valid
      const globalEnabled = valid && suite.enabled && suite.activeSurfaces?.lsp === true && options.lspDisabledIds?.has(rowId) !== true
      const existing = rowById.get('lsp:' + rowId)
      if (existing !== undefined) {
        existing.available = selectable
        existing.globalEnabled = globalEnabled
        continue
      }
      const row: ExtensionResource = {
        id: 'lsp:' + rowId,
        face: 'lsp',
        name: spec.key,
        source: suite.manifest.name,
        description: spec.command,
        suiteResourceId: owner,
        available: selectable,
        globalEnabled,
        detail: { kind: 'lsp', entryId: rowId, ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }) }
      }
      rows.push(row)
      rowById.set(row.id, row)
    }
  }
  return rows
}

export { extensionResourceEnabled } from '../../../market-runtime/src/index.js'
