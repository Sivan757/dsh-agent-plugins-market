/**
 * Drafting one hook entry from an intent.
 *
 * A hook is two decisions — which event, and what command — and the reader usually knows only
 * the second. The model proposes both, as JSON, with the event constrained to the list this
 * host actually runs. The answer lands in a form the reader edits before anything is saved, so
 * a wrong proposal costs one edit, and nothing here touches the document.
 *
 * @module application/ai-hook
 */
import { USER_HOOK_EVENTS, type UserHookEvent, type UserHookSaveRequest } from '../../../market-contracts/src/contracts/user-hooks.js'
import type { AiDraftPort } from './ai-draft.js'

/** What one draft needs. */
export interface AiHookInput {
  intent: string
  locale: 'zh' | 'en'
  signal?: AbortSignal
}

/** The service the route calls. */
export interface AiHookService {
  /**
   * Draft one hook entry.
   * @param input - the intent, the language and cancellation.
   * @returns the proposed entry and the route that produced it.
   */
  draft(input: AiHookInput): Promise<UserHookSaveRequest & { provider: string; model: string }>
}

/** What each event means, in one clause the model can act on. */
const EVENT_MEANINGS: Record<UserHookEvent, { zh: string; en: string }> = {
  SessionStart: { zh: '一次会话启动时', en: 'when a session starts' },
  UserPromptSubmit: { zh: '用户发送一条消息时', en: 'when the user sends a message' },
  PreToolUse: { zh: '一次工具被调用前', en: 'before a tool call' },
  PostToolUse: { zh: '一次工具成功返回后', en: 'after a tool call succeeds' },
  PostToolUseFailure: { zh: '一次工具调用失败后', en: 'after a tool call fails' },
  Stop: { zh: '一轮回答结束时', en: 'when a turn of answering ends' },
  SubagentStart: { zh: '一个子代理启动时', en: 'when a subagent starts' },
  SubagentStop: { zh: '一个子代理结束时', en: 'when a subagent ends' },
  PreCompact: { zh: '上下文被压缩前', en: 'before context is compacted' },
  SessionEnd: { zh: '一次会话结束时', en: 'when a session ends' }
}

/**
 * Build the two messages one hook draft sends.
 * @param intent - what the hook should accomplish.
 * @param locale - the language the command's comments would be written in.
 * @returns the system and user messages.
 */
export function buildHookPrompt(intent: string, locale: 'zh' | 'en'): { system: string; user: string } {
  const list = USER_HOOK_EVENTS.map(event => event + ' — ' + EVENT_MEANINGS[event][locale]).join('\n')
  const system = [
    'You draft one hook entry for a coding agent: an event to attach to and the command to run.',
    'Answer with a single JSON object and nothing else — no prose, no code fences:',
    '{"event": "<one event from the list>", "command": "<shell command>", "matcher": "<tool names, optional>"}',
    '"command" is one shell command line, ready to execute, at most 500 characters. It prints or',
    'writes what the reader needs; it never deletes files, never sends anything to a network, and',
    'never embeds credentials. "matcher" only narrows tool-name events, and only when it matters.',
    'Prefer the simplest command that does the job: an available CLI, one pipe at most.',
    locale === 'zh' ? 'event 必须逐字取自下面的列表；command 里的路径与工具名保持原样。' : 'Copy "event" verbatim from the list below.'
  ].join('\n')
  const user =
    (locale === 'zh' ? '我想要这样一个钩子：' : 'I want a hook like this: ') + intent + '\n\n' + (locale === 'zh' ? '可选事件：' : 'Events you may pick from:') + '\n' + list
  return { system, user }
}

/** Pull the first JSON object out of an answer, tolerating fences and stray prose. */
function extractJson(text: string): Record<string, unknown> {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/iu, '')
    .replace(/```$/iu, '')
    .trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw Object.assign(new Error('the model did not answer with a JSON object'), { code: 'ai-invalid-draft' })
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch {
    throw Object.assign(new Error('the model answered with invalid JSON'), { code: 'ai-invalid-draft' })
  }
}

/**
 * Read one hook entry out of the model's answer.
 * @param text - the model's raw answer.
 * @returns the proposed entry.
 */
export function parseHookDraft(text: string): UserHookSaveRequest {
  const parsed = extractJson(text)
  const event = parsed['event']
  const command = parsed['command']
  const matcher = parsed['matcher']
  if (typeof event !== 'string' || !(USER_HOOK_EVENTS as readonly string[]).includes(event)) {
    throw Object.assign(new Error('the draft names an event this host does not run'), { code: 'ai-invalid-draft' })
  }
  if (typeof command !== 'string' || command.trim() === '' || command.length > 500) {
    throw Object.assign(new Error('the draft has no usable command'), { code: 'ai-invalid-draft' })
  }
  return {
    event: event as UserHookEvent,
    command: command.trim(),
    ...(typeof matcher === 'string' && matcher.trim() !== '' ? { matcher: matcher.trim().slice(0, 200) } : {})
  }
}

/**
 * Compose the hook drafting service over a model port.
 * @param port - the model call, or undefined when this deployment has none.
 * @returns the service.
 */
export function createAiHookService(port: AiDraftPort | undefined): AiHookService {
  return {
    async draft(input: AiHookInput) {
      if (port === undefined) throw Object.assign(new Error('no model is available for drafting'), { code: 'ai-unavailable' })
      const prompt = buildHookPrompt(input.intent.trim(), input.locale)
      const answer = await port.complete(prompt, input.signal)
      const entry = parseHookDraft(answer.text)
      return { ...entry, provider: answer.provider, model: answer.model, ...(answer.usage === undefined ? {} : { usage: answer.usage }) }
    }
  }
}
