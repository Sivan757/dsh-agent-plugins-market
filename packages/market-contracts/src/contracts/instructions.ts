/**
 * Browser-safe wire records for the workspace instructions page.
 *
 * The page reports the AGENTS.md chain the host injects for one session and
 * rewrites those same files. Discovery, ordering, deduplication and the byte
 * budget belong to `@deepseek-ai/dsh-agent-instructions`; the records here
 * carry that module's own answer so the page cannot disagree with the prompt.
 * @module contracts/instructions
 */
import { MARKET_API_PREFIX } from './market.js'

/** Fixed workspace-instruction HTTP routes. Writes name a candidate, never a path. */
export const INSTRUCTION_ROUTES = {
  /** The chain, the rendered baseline, and the budget. GET. */
  read: `${MARKET_API_PREFIX}instructions`,
  /** Create or replace one candidate. POST. */
  save: `${MARKET_API_PREFIX}instructions/save`,
  /** Remove one candidate. POST. */
  remove: `${MARKET_API_PREFIX}instructions/delete`
} as const

/** Which instruction root a row belongs to. */
export type InstructionScope = 'user-global' | 'agents-global' | 'project'

/** The four project candidate names, in the order the host loads them. */
export const INSTRUCTION_CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md'] as const

/** One candidate file name the host loads inside a project directory. */
export type InstructionCandidate = (typeof INSTRUCTION_CANDIDATES)[number]

/**
 * The only candidate name either user-global root loads. The host reads no
 * `CLAUDE.md` and no local overlay there, so the page never offers one.
 */
export const INSTRUCTION_GLOBAL_CANDIDATE = 'AGENTS.md'

/**
 * What one candidate means for the rendered prompt.
 *
 * `loaded`, `truncated`, `over-budget`, `source-over-budget`, `duplicate` and
 * `not-included` describe a file that exists. `missing` is a row the page
 * synthesizes so a directory with no instruction file still offers creation.
 */
export type InstructionRowStatus = 'loaded' | 'truncated' | 'over-budget' | 'source-over-budget' | 'duplicate' | 'not-included' | 'missing'

/** One candidate file on the chain. */
export interface InstructionRow {
  /** Which root the row belongs to. */
  scope: InstructionScope
  /**
   * The project-relative directory, or `.` for a user-global root and for the
   * project root itself. Together with `candidate` it is the whole write key.
   */
  directory: string
  /** The candidate file name. */
  candidate: string
  /** The host's own display path for an existing file; see the note on `path`. */
  displayPath: string
  /**
   * Absolute path, for showing and for copy. Writes never accept it: a request
   * names `scope`, `directory` and `candidate`, and the server derives the path.
   */
  path: string
  /** Whether the file exists now. */
  exists: boolean
  /** UTF-8 bytes on disk, when the file exists and its size is readable. */
  size?: number
  /** What the file contributes to the rendered prompt. */
  status: InstructionRowStatus
  /**
   * For `duplicate`: the earlier row in the same candidate group whose content
   * it repeats. The group is both user-global roots together, or one project
   * directory.
   */
  duplicateOf?: string
  /** For `truncated`: the host renderer's byte accounting. */
  originalBytes?: number
  /** For `truncated`: the bytes of this file that survived the budget. */
  includedBytes?: number
  /**
   * The file's text, so the editor opens on what is on disk. Absent for a
   * missing file and for one over the per-file cap, which never loads anyway.
   */
  content?: string
}

/** One omitted file, exactly as the host renderer reports it. */
export interface InstructionFileRef {
  absolutePath: string
  displayPath: string
}

/** One truncated file, exactly as the host renderer reports it. */
export interface InstructionTruncation {
  displayPath: string
  originalBytes: number
  includedBytes: number
}

/** The rendered baseline and its diagnostics, exactly as the host reports them. */
export interface InstructionRendered {
  text: string
  omitted: InstructionFileRef[]
  truncated: InstructionTruncation[]
}

/** The whole page's read. */
export interface InstructionsPayload {
  /** False when the profile does not provide the host instruction module. */
  available: boolean
  /** Why the page is unavailable, naming the package. Absent when available. */
  reason?: string
  /** A raw discovery or render failure, rendered as an error state. */
  error?: string
  /** The session's working directory the chain was read for. */
  cwd: string
  /** The project root the chain starts at; equals `cwd` when no marker exists. */
  projectRoot: string
  /** The rendered baseline's byte cap. `0` or less disables loading entirely. */
  budget: number
  /** The per-file source byte cap; a larger file never loads. */
  maxSourceBytes: number
  /** UTF-8 bytes of `rendered.text`. */
  total: number
  rows: InstructionRow[]
  rendered: InstructionRendered
}

/** The write key plus the new document. */
export interface InstructionSaveRequest {
  scope: InstructionScope
  directory: string
  candidate: string
  text: string
}

/** What a delete reports about the other chain entries that share the file. */
export interface InstructionDeleteResult {
  /**
   * Display paths of other chain candidates whose file identity matches the
   * deleted one. Empty when nothing else resolves to it.
   */
  aliases: string[]
  /** Whether the deleted entry was a symbolic link, so only the link went away. */
  targetIsLink: boolean
}
