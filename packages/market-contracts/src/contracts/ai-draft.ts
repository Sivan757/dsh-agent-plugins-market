/**
 * The AI-assist surface: one draft endpoint for every face that has an editor.
 *
 * The plugin never invents a model. The call runs on the deployment's own default
 * model (the same one the harness uses for its auxiliary calls), and the endpoint
 * exists so the client never holds a provider credential or a prompt.
 *
 * A draft is text a person reviews: it lands in the editor, and saving stays their
 * action. Nothing here writes to disk.
 *
 * @module contracts/ai-draft
 */
import { MARKET_API_PREFIX } from './market.js'

/** The routes this contract owns. */
export const AI_DRAFT_ROUTES = {
  /** Draft one artifact from an intent. POST. */
  draft: `${MARKET_API_PREFIX}ai-draft`,
  /** Suggest a preset selection from an intent and the rows the manager shows. POST. */
  suggestPreset: `${MARKET_API_PREFIX}ai-preset`
} as const

/**
 * The faces that accept a draft.
 *
 * Each one has an authored text a person edits: a skill, a command, a role, an output
 * style, or a block for the system prompt. Service configuration is not here: a draft
 * for an MCP server or a language server is a configuration object, and inventing one
 * from an intent is a different feature with a different review story.
 */
export const AI_DRAFT_FACES = ['skills', 'commands', 'agents', 'outputStyles', 'instructions'] as const

/** One face that accepts a draft. */
export type AiDraftFace = (typeof AI_DRAFT_FACES)[number]

/** Bounds every request is measured against. */
export const AI_DRAFT_LIMITS = {
  /** Characters of intent one request may carry. */
  intentChars: 2_000,
  /** Output tokens one draft may spend. */
  maxTokens: 1_500,
  /** Milliseconds one draft may take before the call is abandoned. */
  timeoutMs: 60_000
} as const

/** One draft request. */
export interface AiDraftRequest {
  face: AiDraftFace
  /** What the person wants the artifact to do, in their own words. */
  intent: string
  /** The session whose default model and language apply; absent uses the process default. */
  sessionId?: string
  /** The language the artifact should be authored in. */
  locale?: 'zh' | 'en'
}

/** One draft response. */
export interface AiDraftResult {
  /** The artifact's text, ready to be reviewed in the editor. */
  text: string
  /** The provider that produced it, so the reader can tell what ran. */
  provider: string
  /** The model that produced it. */
  model: string
}

/**
 * One row the preset manager can put in a preset: an id the runtime accepts and the label a
 * person reads.
 */
export interface AiPresetCandidate {
  id: string
  label: string
}

/** One preset-suggestion request. */
export interface AiPresetRequest {
  /** What the preset should be for, in the person's own words. */
  intent: string
  /** The rows the manager is showing, so the answer can only name rows that exist. */
  candidates: readonly AiPresetCandidate[]
  /** The language the preset's name and reason should be written in. */
  locale?: 'zh' | 'en'
}

/** One preset suggestion: what to call it, why, and which rows it selects. */
export interface AiPresetSuggestion {
  name: string
  reason: string
  /** Ids from the request's candidates, in the order the model chose them. */
  enabledIds: string[]
}

/** Bounds every preset suggestion is measured against. */
export const AI_PRESET_LIMITS = {
  /** Characters of intent one request may carry. */
  intentChars: 500,
  /** Rows one request may offer the model. */
  candidates: 300,
  /** Rows one suggestion may select. */
  picks: 60,
  /** Output tokens one suggestion may spend. */
  maxTokens: 900,
  /** Milliseconds one suggestion may take. */
  timeoutMs: 60_000
} as const
