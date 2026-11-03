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

/** The route this contract owns. */
export const AI_DRAFT_ROUTES = {
  /** Draft one artifact from an intent. POST. */
  draft: `${MARKET_API_PREFIX}ai-draft`
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
