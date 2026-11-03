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
  suggestPreset: `${MARKET_API_PREFIX}ai-preset`,
  /** Explain one service failure and name the next step. POST. */
  diagnose: `${MARKET_API_PREFIX}ai-diagnose`
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

/** What one model call cost, as the provider reported it. */
export interface AiUsage {
  inputTokens: number
  outputTokens: number
}

/** One draft response. */
export interface AiDraftResult {
  /** The artifact's text, ready to be reviewed in the editor. */
  text: string
  /** The provider that produced it, so the reader can tell what ran. */
  provider: string
  /** The model that produced it. */
  model: string
  /** What the call cost, when the provider reported it. */
  usage?: AiUsage
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
  /**
   * The rows the manager is showing, so the answer can only name rows that exist.
   *
   * Omit it with `purpose: 'install'`: the server then builds the world from its own catalogue,
   * because a thousand ids do not belong in a browser request.
   */
  candidates?: readonly AiPresetCandidate[]
  /**
   * What the selection is for.
   *
   * `preset` selects rows to switch on for an existing setup; `install` selects catalogue
   * suites to add to this workspace. The rows are validated identically either way; only the
   * question and the sentence around the answer differ.
   */
  purpose?: 'preset' | 'install'
  /** The language the preset's name and reason should be written in. */
  locale?: 'zh' | 'en'
}

/** One preset suggestion: what to call it, why, and which rows it selects. */
export interface AiPresetSuggestion {
  name: string
  reason: string
  /** Ids from the request's candidates, in the order the model chose them. */
  enabledIds: string[]
  /** What the call cost, when the provider reported it. */
  usage?: AiUsage
}

/** Bounds every preset suggestion is measured against. */
export const AI_PRESET_LIMITS = {
  /** Characters of intent one request may carry. */
  intentChars: 500,
  /** Rows one browser request may offer the model. */
  candidates: 300,
  /** Catalogue rows the server itself may offer; the scan can hold a thousand. */
  catalogueCandidates: 1_000,
  /** Rows one suggestion may select. */
  picks: 60,
  /** Output tokens one suggestion may spend. */
  maxTokens: 900,
  /** Milliseconds one suggestion may take. */
  timeoutMs: 60_000
} as const

/** The services whose failures a reader can ask about. */
export const AI_DIAGNOSE_FACES = ['mcp', 'lsp'] as const

/** One service family: a connector mount or a language server. */
export type AiDiagnoseFace = (typeof AI_DIAGNOSE_FACES)[number]

/**
 * The facts about one failure.
 *
 * These are the fields the panel already shows the reader: the state word, the code a builder
 * assigned, the reason, and the causes it supplied. Endpoints and commands are deliberately
 * absent: an endpoint can carry a credential in its query string, and a diagnosis is worth
 * less than the leak.
 */
export interface AiDiagnoseFailure {
  /** The state the row reports, in the contract's own vocabulary. */
  state: string
  /** A stable code naming the failure class, when the builder assigned one. */
  code?: string
  /** What the panel tells the reader, in the reader's language or the builder's words. */
  reason?: string
  /** Causes the builder attributed, most specific first. */
  causes?: readonly string[]
  /** The transport the service declares, when it declares one. */
  transport?: string
  /** How long the mount took before it gave up, in milliseconds. */
  mountMs?: number
}

/** One explanation request. */
export interface AiDiagnoseRequest {
  face: AiDiagnoseFace
  failure: AiDiagnoseFailure
  /** The language the explanation should be written in. */
  locale?: 'zh' | 'en'
}

/** One explanation: what likely went wrong, and what to try next. */
export interface AiDiagnosis {
  text: string
  provider: string
  model: string
  /** What the call cost, when the provider reported it. */
  usage?: AiUsage
}

/** Bounds one explanation is measured against. */
export const AI_DIAGNOSE_LIMITS = {
  /** Characters of reason one request may carry. */
  reasonChars: 600,
  /** Causes one request may carry. */
  causes: 6,
  /** Characters of one cause. */
  causeChars: 300,
  /** Output tokens one explanation may spend. */
  maxTokens: 800,
  /** Milliseconds one explanation may take. */
  timeoutMs: 45_000
} as const
