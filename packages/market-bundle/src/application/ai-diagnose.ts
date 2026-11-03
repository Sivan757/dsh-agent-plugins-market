/**
 * Explaining one service failure.
 *
 * A failed connector or language server shows a state word, a code, a reason and sometimes a
 * list of causes. Those are the facts a builder could establish; what a reader usually needs
 * next is the step they can take. That is what this asks the model for, and it is the whole
 * scope: an explanation and a next step, never a configuration change.
 *
 * The answer cannot touch anything. It is text in a dialog, and the row keeps the state it
 * had, so a wrong explanation costs a reading, not a working setup.
 *
 * @module application/ai-diagnose
 */
import { AI_DIAGNOSE_LIMITS, type AiDiagnoseFace, type AiDiagnoseFailure, type AiDiagnosis } from '../../../market-contracts/src/contracts/ai-draft.js'
import type { AiDraftPort } from './ai-draft.js'

/** What one explanation needs. */
export interface AiDiagnoseInput {
  face: AiDiagnoseFace
  failure: AiDiagnoseFailure
  locale: 'zh' | 'en'
  signal?: AbortSignal
}

/** The service the route calls. */
export interface AiDiagnoseService {
  /**
   * Explain one failure.
   * @param input - the service family, the facts, the language and cancellation.
   * @returns the explanation and the route that produced it.
   */
  diagnose(input: AiDiagnoseInput): Promise<AiDiagnosis>
}

/** What each service family is, in the words the model can act on. */
const FACE_SUBJECT: Record<AiDiagnoseFace, string> = {
  mcp: 'an MCP connector (a server the agent calls tools on, over stdio, SSE or streamable HTTP)',
  lsp: 'a language server (a process that answers editor requests for one language)'
}

/** One line per fact, skipping the ones the builder did not supply. */
function failureLines(failure: AiDiagnoseFailure): string[] {
  const lines = ['state: ' + failure.state]
  if (failure.code !== undefined) lines.push('code: ' + failure.code)
  if (failure.transport !== undefined) lines.push('transport: ' + failure.transport)
  if (failure.mountMs !== undefined) lines.push('mount time: ' + String(Math.round(failure.mountMs)) + ' ms')
  if (failure.reason !== undefined && failure.reason.trim() !== '') lines.push('the panel says: ' + failure.reason.trim().slice(0, AI_DIAGNOSE_LIMITS.reasonChars))
  for (const cause of (failure.causes ?? []).slice(0, AI_DIAGNOSE_LIMITS.causes)) {
    if (cause.trim() !== '') lines.push('attributed cause: ' + cause.trim().slice(0, AI_DIAGNOSE_LIMITS.causeChars))
  }
  return lines
}

/**
 * Build the two messages one explanation sends.
 * @param face - the service family.
 * @param failure - the facts the panel established.
 * @param locale - the language the explanation should be written in.
 * @returns the system and user messages.
 */
export function buildDiagnosePrompt(face: AiDiagnoseFace, failure: AiDiagnoseFailure, locale: 'zh' | 'en'): { system: string; user: string } {
  const system = [
    'You read a failed service report from a plugin manager and explain it to the person who owns the setup.',
    'The report describes ' + FACE_SUBJECT[face] + '.',
    'Answer in prose only. No headings, no code fences, no bullet lists longer than three items.',
    'Say in this order: (1) the most likely cause, in one sentence, using only the facts given;',
    '(2) what to check or try next, as one to three concrete steps a person can take in this plugin;',
    '(3) if the facts are not enough to choose, say exactly which fact is missing.',
    'Never invent a command, a path, a hostname, a credential or a version. Never suggest turning off a security control.',
    locale === 'zh' ? '用简体中文回答，技术名词保留原文。' : 'Write in English.',
    'Keep it under 120 words. The reader is looking at the row that failed.'
  ].join('\n')
  const user = (locale === 'zh' ? '这是失败报告：' : 'The failure report:') + '\n' + failureLines(failure).join('\n')
  return { system, user }
}

/**
 * Compose the diagnosis service over a model port.
 * @param port - the model call, or undefined when this deployment has none.
 * @returns the service.
 */
export function createAiDiagnoseService(port: AiDraftPort | undefined): AiDiagnoseService {
  return {
    async diagnose(input: AiDiagnoseInput): Promise<AiDiagnosis> {
      if (port === undefined) throw Object.assign(new Error('no model is available for drafting'), { code: 'ai-unavailable' })
      const prompt = buildDiagnosePrompt(input.face, input.failure, input.locale)
      const answer = await port.complete(prompt, input.signal)
      const text = answer.text.trim()
      if (text.length === 0) throw Object.assign(new Error('the model returned no explanation'), { code: 'ai-empty' })
      return { text, provider: answer.provider, model: answer.model, ...(answer.usage === undefined ? {} : { usage: answer.usage }) }
    }
  }
}
