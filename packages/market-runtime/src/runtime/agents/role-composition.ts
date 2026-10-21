/**
 * One role child's instructions, composed before its first request.
 *
 * The 0.2.1 host line removed the `persona` field from the subagent start
 * request, so the plugin installs the role card body as the child's own
 * `deployment:persona-prefix` prompt section instead. The composition runs on
 * `agent/created`, before the host delivers the first prompt, and it fails
 * closed: a role child never runs without its instructions.
 *
 * The composed instructions are durable. Creation records one plugin-owned
 * context message carrying the role identity and the card body, and a later
 * resume rebuilds the section from that record instead of from an edited card.
 *
 * @module runtime/agents/role-composition
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { PERSONA_PREFIX_SECTION, type SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { z } from 'zod'
import { settlesWithin } from '../../../../market-catalog/src/index.js'
import { optionalService } from '../core/context.js'
import { drainContinuableChildIds, type SubagentSeam } from './subagent-seam.js'

/** Plugin-owned message source that makes one role child's instructions replayable. */
export const ROLE_CHILD_SOURCE = 'agent-role-child-binding'

/**
 * How long a refusal waits for the child it releases.
 *
 * The release is a courtesy on a path that has already failed, so it must never
 * decide when the caller learns about the failure. A host drain that has not
 * released one child within this bound is treated as the host's own parent
 * teardown problem, and the caller gets its refusal immediately after.
 */
export const ROLE_ABANDON_DEADLINE_MS = 5_000

const bindingSchema = z.object({ version: z.literal(1), roleId: z.string().min(1), persona: z.string() }).strict()
const durableBindingSchema = bindingSchema.extend({ childId: z.string().min(1) }).strict()
type DurableBinding = z.infer<typeof durableBindingSchema>

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** The known user/message envelope keeps this plugin-owned role snapshot replayable. */
    'agent-role-child-binding': { kind: 'agent-role-child-binding'; form: 'context'; binding: DurableBinding }
  }
}

/** One plugin-created child reserved before the host start call. */
export interface PendingRoleChild {
  readonly roleId: string
  /** Callable role name the call used; diagnostics only, never a durable field. */
  readonly role: string
  readonly persona: string
}

/** The role composition the role tool mount installs and the executor writes to. */
export interface RoleChildComposition {
  /**
   * Refuse a role call before a child exists when its instructions could not be persisted.
   * @param role - role name used in the diagnostic.
   */
  requirePersistence(role: string): void
  /**
   * Reserve one child identity before the host start call.
   * @param childId - the identity the start input carries.
   * @param input - durable role identity, callable role name, and the card body.
   */
  reserve(childId: string, input: PendingRoleChild): void
  /**
   * Drop a reservation whose start never produced a child.
   * @param childId - the reserved identity.
   */
  release(childId: string): void
  /**
   * Release a child the host published under an identity this plugin could not compose.
   * @param childId - the identity the host published.
   */
  abandon(childId: string): Promise<void>
}

/** Add the role card body as the child's own persona section. */
export function installPersonaSection(prompt: SystemPrompt, persona: string): () => void {
  return prompt.section({ name: PERSONA_PREFIX_SECTION, order: prompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text: persona, interpolate: false })
}

/** Route fields a live Agent exposes; the host type marks them readonly while the object stays writable. */
interface WritableRoute {
  provider?: string
  model?: string
  reasoningEffort?: string
}

/**
 * Record the role route on the child's own `AgentOptions`.
 *
 * The host Team creation request carries no per-member route, so the child
 * Agent starts with the Lead's route. Host surfaces read this object rather
 * than the model selection: the Team roster shows it, the image-input gate
 * checks it, and the member's own delegation inherits it. A host that freezes
 * the object is reported and keeps the model selection, which still routes
 * every request.
 * @param agent - the member's live Agent.
 * @param route - the validated route from the creation snapshot.
 * @param diagnose - diagnostic sink for a host that refuses the write.
 * @returns the disposer that restores the inherited values.
 */
export function applyRoleRoute(agent: Agent, route: WritableRoute, diagnose: (message: string) => void): () => void {
  const options = agent.options as WritableRoute
  const inherited: WritableRoute = { provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort }
  const write = (next: WritableRoute): boolean => {
    try {
      options.provider = next.provider
      options.model = next.model
      if (next.reasoningEffort === undefined) delete options.reasoningEffort
      else options.reasoningEffort = next.reasoningEffort
      return true
    } catch {
      return false
    }
  }
  if (!write(route)) {
    diagnose(`role teammate ${agent.id}: AgentOptions is not writable, so the host reports the inherited route`)
    return () => {}
  }
  return () => {
    write(inherited)
  }
}

/** Mint the durable identity one role child runs under. */
export function mintRoleChildId(): SessionId {
  return SessionId(randomUUID())
}

/** The model-facing statement that makes the durable binding readable. */
function roleChildNotice(role: string): string {
  return [`You are the role child "${role}".`, 'The role instructions from the delegation snapshot are applied to your system prompt and restored on resume.'].join('\n')
}

/**
 * One named refusal for a role child that could not receive its instructions.
 * @param role - role name the refusal names.
 * @param cause - the failure the refusal wraps, when there is one.
 * @returns the error to throw.
 */
export function roleInstructionsError(role: string, cause?: unknown): Error {
  const detail = cause === undefined ? '' : `: ${describe(cause)}`
  return new Error(`agent "${role}" cannot run without its role instructions${detail}`, cause === undefined ? undefined : { cause })
}

/**
 * Prove the host published the child identity this call reserved.
 *
 * The durable binding and the in-flight reservation are both keyed by the
 * reserved id. A host that accepts the spec and publishes another identity would
 * leave the child uncomposed while the call reported success, so a mismatch is
 * a named refusal instead.
 * @param role - role name the refusal names.
 * @param reserved - the identity this call reserved.
 * @param returned - the identity the host published.
 * @throws when the two differ.
 */
export function requireReservedChild(role: string, reserved: string, returned: string): void {
  if (reserved === returned) return
  throw roleInstructionsError(role, new Error(`the host published child "${returned}" for the reserved child "${reserved}"`))
}

/** Render one thrown value without trusting its stringification. */
function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return typeof cause === 'string' ? cause : 'the host rejected the composition'
}

/** Read the plugin-owned binding records out of one child session's own events. */
function bindingRecords(events: readonly SessionEvent[]): DurableBinding[] {
  const messages = events.flatMap(event => (event.type === 'user/message' ? [event.data] : event.type === 'agent/inbox/spliced' ? event.data.inserted : []))
  // Keyed by message id: one admitted message may be observable twice.
  const sources = new Map(messages.filter(message => message.source.kind === ROLE_CHILD_SOURCE).map(message => [message.id, message.source]))
  return [...sources.values()].flatMap(source => (source.kind === ROLE_CHILD_SOURCE ? [durableBindingSchema.parse(source.binding)] : []))
}

/** Compose role children from the durable binding or the in-flight reservation. */
export class RoleComposition implements RoleChildComposition {
  private readonly pending = new Map<string, PendingRoleChild>()
  private readonly compositions = new Map<Agent, () => void>()
  private disposal?: () => void

  constructor(private readonly ctx: Context) {}

  /**
   * Subscribe to child creation; the returned disposer releases every composition.
   * @returns the mount disposer.
   */
  install(): () => void {
    if (this.disposal !== undefined) return this.disposal
    const offCreated = this.ctx.on('agent/created', async ({ agent, signal }) => {
      await this.compose(agent, signal)
    })
    const offDisposed = this.ctx.on('agent/disposed', ({ agent }) => {
      this.compositions.get(agent)?.()
      this.compositions.delete(agent)
    })
    let active = true
    this.disposal = () => {
      if (!active) return
      active = false
      offCreated()
      offDisposed()
      for (const off of this.compositions.values()) off()
      this.compositions.clear()
      this.pending.clear()
    }
    return this.disposal
  }

  requirePersistence(role: string): void {
    if (optionalService(this.ctx, 'sessionQuery') === undefined) throw roleInstructionsError(role, new Error('the session-query service is unavailable'))
    if (optionalService(this.ctx, 'sessions') === undefined) throw roleInstructionsError(role, new Error('the session service is unavailable'))
  }

  reserve(childId: string, input: PendingRoleChild): void {
    this.pending.set(childId, input)
  }

  release(childId: string): void {
    this.pending.delete(childId)
  }

  /**
   * Release one child the host published under an identity this plugin could not compose.
   *
   * A host that ignores the reserved id leaves a live child with no role
   * instructions. The caller raises the refusal; this method releases the child
   * through the seam's drain member, using the child's own recorded parent, so an
   * uncomposed child does not stay resident until the parent tears down. A host
   * without a drain member, or a child with no live parent, is reported and then
   * left to the host's own parent teardown, which still owns it.
   * @param childId - the identity the host published.
   */
  async abandon(childId: string): Promise<void> {
    try {
      const seam = optionalService(this.ctx, 'subagents') as SubagentSeam | undefined
      const agents = optionalService(this.ctx, 'agents') as { get(id: SessionId): Agent | undefined } | undefined
      const child = agents?.get(SessionId(childId))
      const parentId = child?.session.header.parentSession
      const parent = parentId === undefined ? undefined : agents?.get(parentId)
      if (seam === undefined || parent === undefined) {
        this.ctx.logger?.warn(`role child "${childId}" carries no role instructions and has no live parent to release it; the host owns its teardown`)
        return
      }
      // Bounded, because this runs while a refusal is on its way out: a host drain
      // that stalls must not hold the error the caller needs. The rejection is captured
      // rather than left to the bounded wait, which counts a rejection as settled: a
      // host that refuses the release, or exposes no drain member, must still be
      // reported instead of passing as a release.
      let rejection: unknown
      const release = drainContinuableChildIds(seam, parent, [SessionId(childId)]).catch((error: unknown) => {
        rejection = error
      })
      if (!(await settlesWithin(release, ROLE_ABANDON_DEADLINE_MS))) {
        this.ctx.logger?.warn(`role child "${childId}" carries no role instructions and the host did not release within ${ROLE_ABANDON_DEADLINE_MS}ms; the host owns its teardown`)
      } else if (rejection !== undefined) {
        this.ctx.logger?.warn(`role child "${childId}" carries no role instructions and could not be released: ${describe(rejection)}`)
      }
    } catch (error) {
      // The refusal is already on its way out. A release failure must not replace
      // it, and the child still belongs to the host parent's teardown.
      this.ctx.logger?.warn(`role child "${childId}" carries no role instructions and could not be released: ${describe(error)}`)
    }
  }

  private async compose(agent: Agent, signal?: AbortSignal): Promise<void> {
    if (this.compositions.has(agent)) return
    const pending = this.pending.get(agent.id)
    try {
      const query = optionalService(this.ctx, 'sessionQuery') as SessionQueryEngine | undefined
      if (query === undefined) {
        if (pending === undefined) return
        throw roleInstructionsError(pending.role, new Error('the session-query service is unavailable'))
      }
      const observation = await query.observeSession(agent.id, { projectionMode: 'none', ...(signal === undefined ? {} : { signal }) })
      let records: DurableBinding[]
      try {
        records = bindingRecords(observation.events.filter(event => event.seq >= observation.inheritedEventCount))
      } finally {
        observation[Symbol.dispose]()
      }
      if (records.length > 1) throw roleInstructionsError(pending?.role ?? String(agent.id), new Error('the child has multiple role bindings'))
      const durable = records[0]
      if (durable !== undefined) {
        if (durable.childId !== agent.id) throw roleInstructionsError(durable.roleId, new Error('the role binding belongs to another child'))
        await this.composeSection(agent, durable.roleId, durable.persona)
        return
      }
      // A plain host child that this plugin never created has no binding and no reservation.
      if (pending === undefined) return
      await this.composeFresh(agent, pending)
    } finally {
      if (pending !== undefined) this.pending.delete(agent.id)
    }
  }

  /** Compose one child and persist its binding before the host delivers the first prompt. */
  private async composeFresh(agent: Agent, pending: PendingRoleChild): Promise<void> {
    const binding: DurableBinding = { version: 1, childId: agent.id, roleId: pending.roleId, persona: pending.persona }
    let off: (() => void) | undefined
    try {
      off = await this.composeSection(agent, pending.role, pending.persona)
      agent.inject(
        createUserMessage({
          source: { kind: ROLE_CHILD_SOURCE, form: 'context', binding },
          content: [{ type: 'text', text: roleChildNotice(pending.role) }]
        })
      )
      const sessions = optionalService(this.ctx, 'sessions') as { flush(session: Session): Promise<boolean> } | undefined
      if (sessions === undefined) throw roleInstructionsError(pending.role, new Error('the session service is unavailable'))
      // The binding survives a restart only when a durability listener commits it.
      if (!(await sessions.flush(agent.session))) throw roleInstructionsError(pending.role, new Error('session persistence did not commit the role binding'))
    } catch (error) {
      if (off !== undefined) {
        off()
        this.compositions.delete(agent)
      }
      throw error instanceof Error && error.message.startsWith('agent "') ? error : roleInstructionsError(pending.role, error)
    }
  }

  /**
   * Install the section for one child and keep its disposer on the composition map.
   *
   * A child created on the 0.2.0 line carries a descriptor persona the host
   * re-applies into this same layer when it resumes the child on 0.2.1, so the
   * registration collides. Refusing would break exactly the upgrade path this fix
   * targets, so a colliding slot that holds the same instructions counts as
   * already applied: the plugin owns nothing and the child keeps running. A slot
   * that holds different instructions still refuses, because the child would
   * otherwise run under someone else's persona.
   */
  private async composeSection(agent: Agent, role: string, persona: string): Promise<() => void> {
    const prompt = optionalService(agent.ctx, 'systemPrompt') as SystemPrompt | undefined
    if (prompt === undefined) throw roleInstructionsError(role, new Error('the system-prompt service is unavailable'))
    try {
      const off = installPersonaSection(prompt, persona)
      this.compositions.set(agent, off)
      return off
    } catch (error) {
      const applied = await this.appliedPersona(agent)
      if (applied !== undefined && applied.text === persona) {
        // Equal raw text is not enough. The host re-applies a descriptor persona with
        // no interpolate flag, so a brace-bearing card body would be substituted (or
        // fail to render) under the host's copy while this module's own writer keeps it
        // literal. Accept the host's copy only when it means the same thing.
        if (applied.interpolate === false || !applied.text.includes('{{')) {
          this.ctx.logger?.info?.(`role child "${agent.id}" already carries its role instructions from the host descriptor; the upgrade path installs nothing`)
          // Nothing is owned, so disposal has nothing to release, and the next
          // creation of this same Agent does not attempt the registration again.
          const off = (): void => {}
          this.compositions.set(agent, off)
          return off
        }
        throw roleInstructionsError(
          role,
          new Error(
            `the host already applied this text in "${PERSONA_PREFIX_SECTION}" without preserving its template text, so the role instructions would be substituted or fail to render; a child created on an older host line keeps the persona recorded in its descriptor`
          )
        )
      }
      if (applied !== undefined) {
        throw roleInstructionsError(
          role,
          new Error(
            `the child already carries different instructions in "${PERSONA_PREFIX_SECTION}"; a child created on an older host line keeps the persona recorded in its descriptor, and this role card no longer matches it`
          )
        )
      }
      throw roleInstructionsError(role, error)
    }
  }

  /**
   * The section this child's own scope already renders for the persona slot.
   *
   * The interpolate flag travels with the text because the two are one decision: the
   * same raw text means different instructions depending on whether it is rendered
   * literally.
   * @param agent - the live child whose own scope is read.
   * @returns the occupying section, or undefined when the slot is free or unreadable.
   */
  private async appliedPersona(agent: Agent): Promise<{ text: string; interpolate: boolean | undefined } | undefined> {
    const prompt = optionalService(agent.ctx, 'systemPrompt') as SystemPrompt | undefined
    if (prompt === undefined) return undefined
    try {
      const assembly = await prompt.assemble(assembleContextFor(agent))
      const section = assembly.sections.find(candidate => candidate.name === PERSONA_PREFIX_SECTION)
      return section === undefined ? undefined : { text: section.text, interpolate: section.interpolate }
    } catch {
      // An unreadable assembly is not evidence that the slot is free; treat it as
      // unknown so the caller reports the original registration failure.
      return undefined
    }
  }
}
