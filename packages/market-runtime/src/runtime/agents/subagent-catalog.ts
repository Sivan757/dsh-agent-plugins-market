/** Durable role catalogs follow DSH tool-skill's pre-step publication and session-surface recovery. */
import { escapeEntry } from '../surfaces/prompt-frame.js'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'

export interface SubagentCatalogEntry {
  /** Exact execution identity, independent of the human-readable title. */
  name: string
  /** Durable identity for change detection; never rendered in the model-facing catalog. */
  roleId?: string
  title: string
  description: string
  provider?: string
  model?: string
  reasoningEffort?: string
}

export interface SubagentCatalogSource {
  kind: 'subagent-catalog'
  form: 'catalog'
  update?: true
  entries: readonly SubagentCatalogEntry[]
  /** Fingerprint of the model-facing guidance, independent of the role entries. */
  guidanceHash?: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'subagent-catalog': SubagentCatalogSource
  }
}

/** Structural host contract avoids a second installation of the agent/session runtimes. */
export interface CatalogAgent {
  session: {
    seq: number
    surface: { nodes: readonly number[] }
    eventAt(seq: number): { type: string; seq: number; data: unknown } | undefined
  }
}

export type CatalogStepDecision = { kind: 'reject' } | { kind: 'enter'; messages: UserMessage[]; startsRequestSeries?: true }
export type CatalogStepListener = (payload: { agent: CatalogAgent; signal: AbortSignal }, next: () => Promise<CatalogStepDecision>) => Promise<CatalogStepDecision>

/**
 * One observation of the roles a session can delegate to.
 *
 * The complete flag is the discovery contract the host skill registry already
 * uses: an observation that could not read every source carries no authority to
 * replace the published list, because a failed read is not evidence that its
 * roles were removed. Only a complete observation may publish, including a
 * complete observation that is genuinely empty.
 */
export interface SubagentCatalogSnapshot {
  entries: readonly SubagentCatalogEntry[]
  complete: boolean
}

/** A snapshot, or a bare entry list, which the protocol treats as complete. */
export type SubagentCatalogObservation = SubagentCatalogEntry[] | SubagentCatalogSnapshot

/** Normalize the two accepted provider shapes; a bare list means it read everything. */
function normalizeSnapshot(observation: SubagentCatalogObservation): SubagentCatalogSnapshot {
  return Array.isArray(observation) ? { entries: observation, complete: true } : observation
}

interface CatalogHost {
  tools: { get(name: string, agent: CatalogAgent): unknown }
  on(name: 'agent/pre-step', listener: CatalogStepListener): () => void
  logger?: { warn(message: string): void }
}

/**
 * Register after the exact tool definition; teardown removes guidance before execution.
 *
 * The snapshot callback follows the host skill registry's provider protocol: it may
 * return the entries directly (meaning a complete read) or an explicit snapshot
 * whose `complete` flag reports whether every source answered.
 */
export function mountSubagentCatalog(
  ctx: Context,
  tool: { name: string },
  snapshot: (agent: CatalogAgent, signal: AbortSignal) => Promise<SubagentCatalogObservation>
): () => void {
  const host = ctx as unknown as CatalogHost
  let disposed = false
  const dispose = host.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || disposed) return decision
    signal.throwIfAborted()
    let observed: SubagentCatalogSnapshot
    try {
      observed = normalizeSnapshot(host.tools.get(tool.name, agent) === tool ? await snapshot(agent, signal) : { entries: [], complete: true })
    } catch (error) {
      signal.throwIfAborted()
      host.logger?.warn(`subagent catalog snapshot incomplete: ${String(error)}`)
      return decision
    }
    signal.throwIfAborted()
    if (disposed) return decision
    // A reader that could not enumerate every source publishes nothing: the
    // previous catalog stays the model's authority until a complete read says
    // otherwise, so a temporarily unreadable directory cannot shrink the list.
    if (!observed.complete) return decision
    let entries: SubagentCatalogEntry[] = [...observed.entries]
    if (host.tools.get(tool.name, agent) !== tool) entries = []
    const digest = digestEntries(entries)
    const history = catalogHistory(agent)
    const existing = catalogMessage(decision.messages)
    if (history.visibleDigest === digest) {
      return existing === undefined ? decision : { ...decision, messages: decision.messages.filter(message => message.id !== existing.message.id) }
    }
    if (existing !== undefined && existing.modeMatches && digestEntries(existing.entries) === digest) return decision
    if (!history.published && entries.length === 0) {
      return existing === undefined ? decision : { ...decision, messages: decision.messages.filter(message => message.id !== existing.message.id) }
    }
    const message = renderCatalog(entries, history.published)
    return {
      ...decision,
      messages: existing === undefined ? [...decision.messages, message] : decision.messages.map(item => (item.id === existing.message.id ? message : item))
    }
  })
  return () => {
    disposed = true
    dispose()
  }
}

/**
 * The catalog's own prose. It is fixed English and does not follow the host's
 * locale: the model-facing contract is one text, so a role list can never appear
 * under a translated version of the rules it obeys, and English is the language
 * the harness and its tool descriptions already use.
 *
 * The shape is the host skill catalog's, because that is the block a reader and
 * the Web client already know how to present: one sentence, then a tagged list,
 * and nothing else. How and when to call the tool belongs to the tool
 * description, which every request carries; repeating it here would spend the
 * catalog's tokens on text the model already has.
 */
const CATALOG_INTRO = 'A role is a reusable child-agent specialization. The following subagent roles are available in this session:'

/** Published instead of the intro when roles were already announced earlier in this session. */
const CATALOG_UPDATED =
  'The available subagent roles changed. This complete list replaces every earlier role list in this session; every name from an earlier subagent-catalog is void:'

/** Published when the session's role set became empty. */
const CATALOG_EMPTY = 'No subagent roles are available in this session any more. Do not use role names from an earlier subagent catalog.'

/** The list wrapper the host skill catalog uses, and the client renders as one block. */
const CATALOG_TAG_OPEN = '<available_subagents>'
const CATALOG_TAG_CLOSE = '</available_subagents>'

/** Longest description one line carries, matching the host skill catalog's budget. */
const CATALOG_DESCRIPTION_MAX_LENGTH = 500

/** One line per role: the name the tool takes, then what the role does. */
function catalogLine(entry: SubagentCatalogEntry): string {
  const description = entry.description.replaceAll(/\s+/gu, ' ').trim()
  const bounded = description.length <= CATALOG_DESCRIPTION_MAX_LENGTH ? description : description.slice(0, CATALOG_DESCRIPTION_MAX_LENGTH - 3) + '...'
  return `- \`${escapeEntry(entry.name)}\`: ${escapeEntry(bounded)}`
}

/**
 * Model-facing catalog text in the host skill catalog's shape: one sentence, the
 * tagged list, and nothing else. What the list is for, when to delegate, how to
 * brief a child and what its result means belong to the tool description, which
 * every request carries; a catalog that repeated them would spend the same
 * tokens twice and drift from the tool it describes.
 *
 * Role lines carry the callable name and what the role does. The configured route
 * stays in the durable entries for execution and change detection: publishing it
 * would tell the model which model each role runs on without changing what it
 * does.
 */
export function renderCatalogText(entries: readonly SubagentCatalogEntry[], update: boolean): string {
  if (update && entries.length === 0) return ['<system-reminder>', CATALOG_EMPTY, '</system-reminder>'].join('\n')
  return ['<system-reminder>', update ? CATALOG_UPDATED : CATALOG_INTRO, '', CATALOG_TAG_OPEN, ...entries.map(catalogLine), CATALOG_TAG_CLOSE, '</system-reminder>'].join('\n')
}

function renderCatalog(entries: readonly SubagentCatalogEntry[], update: boolean): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: renderCatalogText(entries, update) }],
    source: {
      kind: 'subagent-catalog',
      form: 'catalog',
      guidanceHash: guidanceHash(),
      ...(update ? { update: true } : {}),
      entries
    }
  })
}

/** Hash both publication variants so wording changes refresh existing sessions without role edits. */
function guidanceHash(): string {
  const text = renderCatalogText([], false) + renderCatalogText([], true)
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Change detection follows what the model and the executor actually see. A role's
 * display title never reaches the model-facing catalog, so renaming it must not
 * re-publish; the durable role id and the configured route stay in the digest
 * because swapping either behind an unchanged line changes what the child runs.
 */
function digestEntries(entries: readonly SubagentCatalogEntry[]): string {
  return createHash('sha256')
    .update(entries.map(entry => JSON.stringify([entry.name, entry.roleId, entry.description, entry.provider, entry.model, entry.reasoningEffort])).join('\n'))
    .digest('hex')
}

/** Resumed and forked seeds may carry unvalidated source fields; ignore unreadable catalogs. */
function readEntries(source: unknown): readonly SubagentCatalogEntry[] | undefined {
  if (typeof source !== 'object' || source === null || !('kind' in source) || source.kind !== 'subagent-catalog' || !('entries' in source) || !Array.isArray(source.entries))
    return undefined
  const entries: SubagentCatalogEntry[] = []
  for (const raw of source.entries as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return undefined
    const entry = raw as Record<string, unknown>
    if (typeof entry.name !== 'string' || entry.name === '' || typeof entry.title !== 'string' || typeof entry.description !== 'string') return undefined
    if (['roleId', 'provider', 'model', 'reasoningEffort'].some(key => entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key] === ''))) return undefined
    entries.push({
      name: entry.name,
      ...(entry.roleId === undefined ? {} : { roleId: entry.roleId as string }),
      title: entry.title,
      description: entry.description,
      ...(entry.provider === undefined ? {} : { provider: entry.provider as string }),
      ...(entry.model === undefined ? {} : { model: entry.model as string }),
      ...(entry.reasoningEffort === undefined ? {} : { reasoningEffort: entry.reasoningEffort as string })
    })
  }
  return entries
}

function catalogHistory(agent: CatalogAgent): { visibleDigest?: string; published: boolean } {
  const visible = new Set(agent.session.surface.nodes)
  let published = false
  for (let index = agent.session.seq - 1; index >= 0; index--) {
    const event = agent.session.eventAt(index)
    if (event === undefined) throw new Error(`subagent catalog cannot read seq ${index} below the current Session length`)
    if (event.type !== 'user/message') continue
    const entries = readEntries((event.data as UserMessage).source)
    if (entries === undefined) continue
    published = true
    if (visible.has(event.seq)) {
      const source = (event.data as UserMessage).source as SubagentCatalogSource
      return { ...(source.guidanceHash === guidanceHash() ? { visibleDigest: digestEntries(entries) } : {}), published }
    }
  }
  return { published }
}

function catalogMessage(messages: readonly UserMessage[]): { message: UserMessage; entries: readonly SubagentCatalogEntry[]; modeMatches: boolean } | undefined {
  for (const message of messages) {
    const entries = readEntries(message.source)
    if (entries !== undefined) return { message, entries, modeMatches: (message.source as SubagentCatalogSource).guidanceHash === guidanceHash() }
  }
  return undefined
}
