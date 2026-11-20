/**
 * The user's own hook configuration: a file the reader owns and this plugin appends to.
 *
 * The file is the Agent layout root's hook document (`~/.agents/hooks/hooks.json`). Creating an
 * entry is an append with a merge rule, never a rewrite, because the reader may have written
 * that file by hand and nothing here may drop their lines.
 *
 * @module contracts/user-hooks
 */
import { MARKET_API_PREFIX } from './market.js'

/** The routes this contract owns. */
export const USER_HOOKS_ROUTES = {
  /** Append one hook entry to the user's hook document. POST. */
  save: `${MARKET_API_PREFIX}user-hooks/save`
} as const

/** The events a hook can attach to, most useful first. */
export const USER_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'SessionEnd'
] as const

/** One event a hook can attach to. */
export type UserHookEvent = (typeof USER_HOOK_EVENTS)[number]

/** One hook entry to append. */
export interface UserHookSaveRequest {
  event: UserHookEvent
  /** The command the hook runs, exactly as it will be executed. */
  command: string
  /** Narrow the event to matching tool names, when the event supports it. */
  matcher?: string
}

/** Bounds one hook request is measured against. */
export const USER_HOOK_LIMITS = {
  /** Characters of command one entry may carry. */
  commandChars: 500,
  /** Characters of matcher one entry may carry. */
  matcherChars: 200
} as const
