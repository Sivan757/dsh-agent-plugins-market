/**
 * Suggesting a preset from an intent.
 *
 * A preset is a selection, so the answer has to be one: a name, a reason, and the ids the
 * model picked. The model never sees the whole world — only the rows the manager is showing —
 * and every id it answers is checked against that list, because a suggestion that names a row
 * the runtime does not have is worse than no suggestion.
 *
 * @module application/ai-preset
 */
import { AI_PRESET_LIMITS, type AiPresetCandidate, type AiPresetSuggestion } from '../../../market-contracts/src/contracts/ai-draft.js'
import type { AiDraftPort } from './ai-draft.js'

/** What one suggestion needs. */
export interface AiPresetInput {
  intent: string
  candidates: readonly AiPresetCandidate[]
  locale: 'zh' | 'en'
  signal?: AbortSignal
}

/** A suggestion failure a caller can act on. */
export type AiPresetFailure = 'ai-invalid-suggestion' | 'ai-empty-selection'

/** The service the route calls. */
export interface AiPresetService {
  /**
   * Suggest one preset.
   * @param input - the intent, the rows on offer, the language and cancellation.
   * @returns the suggestion, with every id checked against the rows on offer.
   */
  suggest(input: AiPresetInput): Promise<AiPresetSuggestion>
}

/**
 * The prompt one suggestion call sends.
 *
 * The answer contract is stated as a JSON object with three keys and nothing else, because the
 * caller has to read it: prose around it would make the parse a guess. Ids are listed verbatim
 * beside their labels so a pick is a copy, not a recollection.
 * @param intent - what the preset should be for.
 * @param candidates - the rows on offer.
 * @param locale - the language for the name and the reason.
 * @returns the system and user messages.
 */
export function buildPresetPrompt(intent: string, candidates: readonly AiPresetCandidate[], locale: 'zh' | 'en'): { system: string; user: string } {
  const listing = candidates.map(candidate => candidate.id + ' — ' + candidate.label).join('\n')
  const system = [
    'You build one extension preset for a coding agent: a named selection of capabilities.',
    'Answer with a single JSON object and nothing else — no prose, no code fences:',
    '{"name": "...", "reason": "...", "picks": ["<id>", "..."]}',
    '"name" is short and human (max 40 characters). "reason" is one sentence saying what the',
    'preset is for. "picks" lists ids copied exactly from the list below, at most ' + String(AI_PRESET_LIMITS.picks) + '.',
    'Select only ids from the list. An id not in the list is a mistake, not a new row.',
    locale === 'zh' ? 'name 与 reason 写成简体中文；picks 里的 id 保持原样。' : 'Write name and reason in English; keep ids verbatim.',
    'Prefer a small, coherent selection a person would recognise as one setup: five to fifteen',
    'rows is usually right. When the request is broad, choose the rows that make it work.'
  ].join('\n')
  const user =
    (locale === 'zh' ? '我要一个这样的预设：' : 'I want a preset like this: ') + intent + '\n\n' + (locale === 'zh' ? '可选的行：' : 'Rows you may pick from:') + '\n' + listing
  return { system, user }
}

/** Pull the first JSON object out of an answer, tolerating fences and stray prose. */
function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/iu, '')
    .replace(/```$/u, '')
    .trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw Object.assign(new Error('the model did not answer with a JSON object'), { code: 'ai-invalid-suggestion' })
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    throw Object.assign(new Error('the model answered with invalid JSON'), { code: 'ai-invalid-suggestion' })
  }
}

/**
 * Read one suggestion out of the model's answer, keeping only ids that were on offer.
 * @param text - the model's raw answer.
 * @param candidates - the rows on offer.
 * @returns the suggestion.
 */
export function parsePresetSuggestion(text: string, candidates: readonly AiPresetCandidate[]): AiPresetSuggestion {
  const parsed = extractJson(text) as { name?: unknown; reason?: unknown; picks?: unknown }
  const name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 60) : ''
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : ''
  const offered = new Set(candidates.map(candidate => candidate.id))
  const picks = Array.isArray(parsed.picks) ? parsed.picks : []
  const enabledIds = picks
    .filter((pick): pick is string => typeof pick === 'string')
    .filter(id => offered.has(id))
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, AI_PRESET_LIMITS.picks)
  if (name === '') throw Object.assign(new Error('the suggestion has no name'), { code: 'ai-invalid-suggestion' })
  if (enabledIds.length === 0) throw Object.assign(new Error('the suggestion selected nothing it was offered'), { code: 'ai-empty-selection' })
  return { name, reason, enabledIds }
}

/**
 * Compose the suggestion service over a model port.
 * @param port - the model call, or undefined when this deployment has none.
 * @returns the service.
 */
export function createAiPresetService(port: AiDraftPort | undefined): AiPresetService {
  return {
    async suggest(input: AiPresetInput): Promise<AiPresetSuggestion> {
      if (port === undefined) throw Object.assign(new Error('no model is available for drafting'), { code: 'ai-unavailable' })
      if (input.candidates.length === 0) throw Object.assign(new Error('there is nothing to build a preset from'), { code: 'ai-empty-selection' })
      const prompt = buildPresetPrompt(input.intent.trim(), input.candidates, input.locale)
      const answer = await port.complete(prompt, input.signal)
      return parsePresetSuggestion(answer.text, input.candidates)
    }
  }
}
