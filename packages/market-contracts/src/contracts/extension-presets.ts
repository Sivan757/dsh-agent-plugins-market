import { PROJECT_LAYOUTS } from '../model/layouts.js'

/** Portable extension choices. These records never carry credentials or service configuration. */
export interface ExtensionPreset {
  id: string
  name: string
  revision: number
  enabledIds: string[]
}

/** A detached session choice, not a live reference to its workspace preset. */
export interface ExtensionSelection {
  presetId: string | null
  presetName: string | null
  presetRevision: number | null
  modified: boolean
  enabledIds: string[]
}

/** One workspace's preset library; null default captures current global choices at session creation. */
export interface ExtensionPresetLibrary {
  revision: number
  defaultPresetId: string | null
  presets: ExtensionPreset[]
}

export interface ExtensionPresetInput {
  name: string
  enabledIds: string[]
}

export const EXTENSION_TRANSFER_FORMAT = 'dsh-agent-extension-preset'
export const EXTENSION_TRANSFER_MAX_BYTES = 64 * 1024
const MAX_ENTRIES = 4096
const ENTRY_ID = /^(market|skills|commands|agents|mcp|lsp|hooks):.{1,1023}$/u

/**
 * Which hook events the host bridge can run today, per
 * docs/scratch/hooks-support-gap-analysis.md: the seven events the harness
 * bridge registers (`CLAUDE_EVENTS`), Notification as supported-partial (the
 * plugin can bridge `permission_prompt` and `idle_prompt` itself but no host
 * seam exists for the other matcher types), and SessionEnd and PreCompact as
 * registered-only (the event can be declared but no execution path exists
 * yet). The catalog validator still rejects those three events, so their
 * declarations surface as suite diagnostics; the inventory turns each into a
 * read-only Hooks row. When a runtime bridge lands, the validator admits the
 * event and its entry here flips, instead of editing every consumer.
 */
export type HookEventSupport = 'supported' | 'supported-partial' | 'registered-only'

export const HOOK_EVENT_HOST_SUPPORT: Readonly<Record<string, HookEventSupport>> = {
  SessionStart: 'supported',
  UserPromptSubmit: 'supported',
  PreToolUse: 'supported',
  PostToolUse: 'supported',
  Stop: 'supported',
  SubagentStart: 'supported',
  SubagentStop: 'supported',
  Notification: 'supported-partial',
  SessionEnd: 'registered-only',
  PreCompact: 'registered-only'
}
const hasControlCharacters = (value: string): boolean => Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)

/**
 * One command hook's individual resource id.
 *
 * A hook is addressed by its declaration position: the event name and the index
 * of the command hook inside that event, counted across matcher groups in
 * declaration order. One definition keeps the inventory row, the session
 * projection and the runtime authorization on the same identity.
 * @param sourceId - the suite's source.
 * @param suiteId - the suite's own id.
 * @param event - the hook event name the declaration groups under.
 * @param index - the hook's zero-based position inside that event's declaration.
 * @returns the preset resource id naming exactly that hook.
 */
export function hookResourceId(sourceId: string, suiteId: string, event: string, index: number): string {
  return 'hooks:' + sourceId + '/' + suiteId + '/' + event + '/' + index
}

/** Validate and canonicalize a complete selection. Empty means no extension capabilities. */
export function parseExtensionIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES || value.some(id => typeof id !== 'string' || !ENTRY_ID.test(id) || hasControlCharacters(id))) {
    throw new Error('invalid extension resource ids')
  }
  return [...new Set(value as string[])].sort()
}

/**
 * Resource ids of suites that are local configuration, never a market offering
 * (the user hooks root and every project native layout). Their parent id is
 * derived from child selection at read time, so it must not persist in a preset
 * or a session selection: a parent id a card cannot render must never be
 * something a caller can select or a copy can carry.
 *
 * The native ids mirror the scanner's naming in market-catalog's native-project
 * scanner (sanitizeId(dirName + '-native') under sourceId 'native'); the
 * sanitizer's rules are restated here because contracts imports nothing outside
 * this package.
 */
export const CONFIGURATION_PARENT_IDS: ReadonlySet<string> = new Set([
  'market:@user-hooks/user-hooks',
  ...PROJECT_LAYOUTS.map(layout => {
    const raw = layout.dirName.toLowerCase() + '-native'
    return (
      'market:native/' +
      raw
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
        .replace(/-{2,}/g, '-')
    )
  })
])

/** Drop configuration-parent ids a copy or a persisted preset must never carry. */
export function stripConfigurationParentIds(ids: readonly string[]): string[] {
  return ids.filter(id => !CONFIGURATION_PARENT_IDS.has(id))
}

/** Validate a display name without using it as a filesystem key. */
export function parseExtensionName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 80 || hasControlCharacters(value)) {
    throw new Error('invalid extension preset name')
  }
  return value.trim()
}

/**
 * Capture once; later preset edits and newly installed resources do not change
 * this selection. Configuration parents are stripped here: the selection a
 * capture publishes is the same data a preset stores and a copy serializes, and
 * a parent no card renders must never enter it.
 */
export function captureExtensionSelection(preset: ExtensionPreset | null, globalEnabledIds: readonly string[]): ExtensionSelection {
  return {
    presetId: preset?.id ?? null,
    presetName: preset?.name ?? null,
    presetRevision: preset?.revision ?? null,
    modified: false,
    enabledIds: stripConfigurationParentIds(parseExtensionIds(preset?.enabledIds ?? [...globalEnabledIds]))
  }
}

/** Missing state preserves legacy availability. Explicit selections cannot override global unavailability. */
export function selectionAllows(selection: ExtensionSelection | undefined, entryId: string, available = true): boolean {
  return available && (selection === undefined || selection.enabledIds.includes(entryId))
}

/** Serialize a copyable preset; identifiers, revisions, arbitrary object properties and configuration parents are not exported. */
export function serializeExtensionPresetTransfer(preset: ExtensionPresetInput): string {
  const text = JSON.stringify(
    { format: EXTENSION_TRANSFER_FORMAT, version: 1, name: parseExtensionName(preset.name), enabledIds: stripConfigurationParentIds(parseExtensionIds(preset.enabledIds)) },
    null,
    2
  )
  if (new TextEncoder().encode(text).byteLength > EXTENSION_TRANSFER_MAX_BYTES) throw new Error('extension preset is too large to copy')
  return text
}

/** Reject malformed, oversized or future-format clipboard data. Unknown valid ids are retained for import diagnostics. */
export function parseExtensionPresetTransfer(text: string): ExtensionPresetInput {
  if (new TextEncoder().encode(text).byteLength > EXTENSION_TRANSFER_MAX_BYTES) throw new Error('extension preset is too large to paste')
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid extension preset transfer')
  const record = value as Record<string, unknown>
  if (record.format !== EXTENSION_TRANSFER_FORMAT || record.version !== 1 || Object.keys(record).some(key => !['format', 'version', 'name', 'enabledIds'].includes(key))) {
    throw new Error('unsupported extension preset transfer')
  }
  return { name: parseExtensionName(record.name), enabledIds: stripConfigurationParentIds(parseExtensionIds(record.enabledIds)) }
}
/** Resource detail addresses are data identifiers consumed by existing full detail components. */
export type ExtensionDetail = (
  | { kind: 'suite'; sourceId: string; suiteId: string }
  | { kind: 'panel'; panel: 'skills' | 'commands' | 'agents'; entryId: string }
  | { kind: 'mcp'; entryId: string }
  | { kind: 'lsp'; entryId: string }
  | {
      kind: 'hook'
      /** The suite whose declaration carries the hook. */
      sourceId: string
      suiteId: string
      /** The event the hook was declared under. */
      event: string
      /** The hook's declaration position inside that event; absent for a rejected declaration, which has no admitted hook. */
      hookIndex?: number
      /** The command exactly as authored; absent for a rejected declaration. */
      command?: string
      /** The matcher of the group the hook belongs to; absent for an ungrouped or catch-all declaration. */
      matcher?: string
      /** The declaration's own timeout in seconds; absent when it inherits the bridge default. */
      timeoutSec?: number
      /** The suite or configuration the hook came from, without the matcher suffix the row's source carries. */
      provenance: string
      /** What the host bridge can do with this event today. */
      support: HookEventSupport
      /** The validator's rejection, for a row that exists only as a diagnostic. */
      diagnostic?: string
    }
) & { sessionId?: string }

export interface ExtensionResource {
  id: string
  face: 'market' | 'skills' | 'commands' | 'agents' | 'mcp' | 'lsp' | 'hooks'
  /** Local configuration is not a market offering. Resource ids and parent gates remain stable. */
  configuration?: 'project' | 'user-hooks'
  name: string
  /** The authored description; the text a reader sees when no translation exists. */
  description?: string
  /** The description translated for the active locale; absent means render `description`. */
  translatedDescription?: string
  source: string
  version?: string
  counts?: Array<{ label: string; count: number }>
  /** Parent suite selection applies in addition to this resource's selection. */
  suiteResourceId?: string
  available: boolean
  /** Global default state; a saved preset can explicitly select an available resource independently. */
  globalEnabled?: boolean
  /** Global-only resources remain exposed by an independent host contributor and are not part of a session selection. */
  control?: 'session' | 'global-only'
  /**
   * True when the resource follows its owning suite's selection instead of
   * carrying its own switch. A hook owned by an installed suite reads this, so
   * the manager lists it without a toggle.
   */
  followsSuite?: boolean
  /** A surface that cannot be controlled safely must explain why, not pretend to toggle. */
  unavailableReason?: string
  detail: ExtensionDetail
}

export interface ExtensionSessionSnapshot {
  revision: number
  selection: ExtensionSelection
}

export interface ExtensionWindowPayload {
  sessionId: string
  workspace: string
  started: boolean
  busy: boolean
  library: ExtensionPresetLibrary
  state: ExtensionSessionSnapshot
  /** While not ready, state is a display-only recovery snapshot, never effective authorization. */
  status?: { ready: boolean; revision: number; recoverable: boolean; error?: string; selection?: ExtensionSelection }
  /**
   * The selection a request made mid-turn will commit at the next safe boundary.
   * Absent when nothing is pending: `state` stays the effective selection until then.
   */
  intendedSelection?: ExtensionSelection
  /** CAS token of the pending request, retained as selectionRevision after promotion. */
  intendedRevision?: number
  /**
   * The revision of the last accepted selection request, effective or pending. It
   * never moves backwards, so a client can keep comparing against it across a
   * promotion, which a bare committed revision cannot support.
   */
  selectionRevision?: number
  resources: ExtensionResource[]
}

export const EXTENSION_ROUTES = {
  window: '/api/agent-plugins/extension-presets',
  hooksOverview: '/api/agent-plugins/extension-presets/hooks',
  hookRun: '/api/agent-plugins/extension-presets/hook-run',
  create: '/api/agent-plugins/extension-presets/create',
  update: '/api/agent-plugins/extension-presets/update',
  delete: '/api/agent-plugins/extension-presets/delete',
  default: '/api/agent-plugins/extension-presets/default',
  select: '/api/agent-plugins/extension-presets/select',
  recover: '/api/agent-plugins/extension-presets/recover'
} as const

/** The settings workspace's Hooks tab: the configured hook declarations, without any session. */
export interface ExtensionHooksOverview {
  rows: ExtensionResource[]
}

/** One declared command hook's identity: the address a dry run names. */
export interface ExtensionHookRunInput {
  sourceId: string
  suiteId: string
  /** The event the hook was declared under. */
  event: string
  /** The declaration's position inside that event; absent for a rejected declaration, which has no admitted hook. */
  hookIndex?: number
  /**
   * Calling session, from the resource address. It widens resolution to that
   * session's project hooks; the run itself always uses the home directory.
   */
  sessionId?: string
}

/** One dry run's bounded result. The command comes from the scanned declaration, never from the caller. */
export interface ExtensionHookRunResult {
  /** Working directory the command ran in. */
  cwd: string
  /** Present unless the process died by signal or the run could not start. */
  exitCode?: number
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
  /** Output reached the server's per-stream cap. */
  truncated: boolean
  /** Set when no declaration matched, the declaration carries no command, or no shell seam is mounted. */
  error?: string
}
