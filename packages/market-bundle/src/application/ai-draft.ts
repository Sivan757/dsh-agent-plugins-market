/**
 * Drafting one artifact from a person's intent.
 *
 * The product holds five authored artifacts: a skill, a command, a role, an output style,
 * and a block for the system prompt. Each has a format the host already reads, so the only
 * thing this module decides is what a model is asked and what shape the answer must take.
 *
 * Two rules run through every prompt. The model answers with the artifact and nothing else,
 * because the text lands in an editor a person reviews rather than in a chat they read. And
 * it answers in the reader's own language, because a Chinese user drafting a skill is
 * drafting a Chinese skill.
 *
 * @module application/ai-draft
 */
import type { AiDraftFace, AiDraftResult } from '../../../market-contracts/src/contracts/ai-draft.js'

/** What one draft needs. */
export interface AiDraftInput {
  face: AiDraftFace
  intent: string
  locale: 'zh' | 'en'
  signal?: AbortSignal
}

/** The model call this module needs; the composition root supplies the host-backed one. */
export interface AiDraftPort {
  /**
   * Ask the deployment's default model for one artifact.
   * @param prompt - the two messages to send.
   * @param signal - cancellation, honoured between chunks.
   * @returns the artifact text and the route that produced it.
   */
  complete(prompt: { system: string; user: string }, signal?: AbortSignal): Promise<AiDraftResult>
}

/**
 * The format each face's artifact must take, in the words the model reads.
 *
 * The frontmatter keys are the host's own: `description` is what a panel and a prompt show,
 * `argument-hint` is the command's signature, and a command's body address its arguments as
 * `$ARGUMENTS`. Stating them here is what keeps a draft saveable without repair.
 */
const FACE_FORMAT: Record<AiDraftFace, string> = {
  skills: [
    'A skill: YAML frontmatter with a single `description` line saying when the model should',
    'use this skill, then a Markdown body of the instructions themselves. Write the body for',
    'the model that will follow it: numbered or bulleted steps, concrete, no preamble.'
  ].join(' '),
  commands: [
    'A command: YAML frontmatter with a `description` line and an `argument-hint` line naming',
    'the arguments (for example `<file> [--fix]`), then a Markdown body that addresses the',
    'arguments as `$ARGUMENTS`. The body is the prompt the command expands into.'
  ].join(' '),
  agents: [
    'A role: YAML frontmatter with a `description` line saying what this role is for, then a',
    'Markdown body of standing instructions for that role. Write it in the second person to',
    'the model playing the role.'
  ].join(' '),
  outputStyles: [
    'An output style: YAML frontmatter with a `description` line, then a Markdown body that',
    'shapes how the model answers. The body is a set of instructions to the model about form',
    'and voice, not a description of the style.'
  ].join(' '),
  instructions: [
    'A block for the system prompt: Markdown only, no frontmatter. A heading and the rules',
    'themselves, in the imperative, at the length a person would keep in a repository-wide',
    'file.'
  ].join(' ')
}

/** The shared halves of every prompt: the artifact-only rule and the language. */
function sharedRules(face: AiDraftFace, locale: 'zh' | 'en'): string {
  return [
    'You draft exactly one artifact for a plugin manager used with a coding agent.',
    FACE_FORMAT[face],
    'Answer with the artifact alone. No prose before or after it, no code fences, no commentary.',
    locale === 'zh' ? '写成简体中文；代码标识、路径与既有英文术语保持原样。' : 'Write in English.',
    'If the request is too thin to draft something useful, still answer with the smallest',
    'honest artifact: a description that says what it is for, and a body with the steps you can',
    'defend. Never invent file paths or credentials.'
  ].join('\n')
}

/**
 * Build the two messages one draft call sends.
 *
 * @param face - which artifact is being drafted.
 * @param intent - the person's own words, already trimmed and bounded by the route.
 * @param locale - the language the artifact should be authored in.
 * @returns the system and user messages.
 */
export function buildDraftPrompt(face: AiDraftFace, intent: string, locale: 'zh' | 'en'): { system: string; user: string } {
  return {
    system: sharedRules(face, locale),
    user: (locale === 'zh' ? '我要的东西是：' : 'What I want: ') + intent
  }
}

/** The service the route calls. */
export interface AiDraftService {
  /**
   * Draft one artifact.
   * @param input - the face, the intent, the language and cancellation.
   * @returns the artifact text and the route that produced it.
   */
  draft(input: AiDraftInput): Promise<AiDraftResult>
}

/**
 * Compose the drafting service over a model port.
 *
 * @param port - the model call, or undefined when this deployment has none.
 * @returns the service; a missing port is reported as a typed failure rather than a crash.
 */
export function createAiDraftService(port: AiDraftPort | undefined): AiDraftService {
  return {
    async draft(input: AiDraftInput): Promise<AiDraftResult> {
      if (port === undefined) {
        throw Object.assign(new Error('no model is available for drafting'), { code: 'ai-unavailable' })
      }
      const prompt = buildDraftPrompt(input.face, input.intent.trim(), input.locale)
      const result = await port.complete(prompt, input.signal)
      const text = result.text.trim()
      if (text.length === 0) throw Object.assign(new Error('the model returned no draft'), { code: 'ai-empty' })
      return { ...result, text }
    }
  }
}
