/** Normalize native Claude-shaped command hooks for the existing host execution bridge. */
import type { ProjectHooks } from '../model/types.js'
import { readProjectDocument } from './project-config.js'
import type { ProjectHookFormat } from '../model/layouts.js'

const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop'])
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Merge settings layers additively, deduplicating identical event/matcher/command triples. */
export async function discoverProjectHooks(
  projectRoot: string,
  files: readonly string[],
  errors: string[],
  format: ProjectHookFormat = 'claude'
): Promise<ProjectHooks | undefined> {
  const documents: Array<{ file: string; settings: Record<string, unknown> }> = []
  for (const file of files) {
    const settings = await readProjectDocument(projectRoot, file, errors)
    if (settings === null) return undefined
    if (settings !== undefined) documents.push({ file, settings })
  }
  return normalizeHookDocuments(projectRoot, documents, errors, format)
}

/** Pure validation shared by native settings and plugin file/inline declarations. */
export function normalizeHookDocuments(
  projectRoot: string,
  documents: Array<{ file: string; settings: Record<string, unknown> }>,
  errors: string[],
  format: ProjectHookFormat = 'claude'
): ProjectHooks | undefined {
  const events: ProjectHooks['events'] = Object.create(null) as ProjectHooks['events']
  const seen = new Set<string>()
  let disabled = false
  for (const { file, settings } of documents) {
    if (settings?.disableAllHooks !== undefined) {
      if (typeof settings.disableAllHooks !== 'boolean') {
        errors.push(`${file}: disableAllHooks must be a boolean`)
        return undefined
      }
      disabled = settings.disableAllHooks
    }
    if (settings?.hooks === undefined) continue
    if (!object(settings.hooks)) {
      errors.push(`${file}: hooks must be an event table`)
      return undefined
    }
    if (format === 'zcode' && settings.hooks.enabled !== true) continue
    const eventTable = format === 'zcode' ? settings.hooks.events : settings.hooks
    if (!object(eventTable)) {
      errors.push(`${file}: hooks.events must be an event table`)
      return undefined
    }
    for (const [event, groups] of Object.entries(eventTable)) {
      if (!EVENTS.has(event)) {
        errors.push(`${file}: unsupported project hook event ${event}`)
        continue
      }
      if (!Array.isArray(groups)) {
        errors.push(`${file}: ${event} hook groups must be an array`)
        return undefined
      }
      for (const group of groups) {
        if (!object(group) || !Array.isArray(group.hooks) || (group.matcher !== undefined && typeof group.matcher !== 'string')) {
          errors.push(`${file}: invalid ${event} hook group`)
          return undefined
        }
        const matcher = event === 'Stop' || event === 'UserPromptSubmit' ? undefined : (group.matcher as string | undefined)
        if (matcher !== undefined && matcher !== '*') {
          try {
            new RegExp(matcher)
          } catch {
            errors.push(`${file}: invalid ${event} hook matcher`)
            return undefined
          }
        }
        const hooks: ProjectHooks['events'][string][number]['hooks'] = []
        for (const hook of group.hooks) {
          if (!object(hook)) {
            errors.push(`${file}: invalid ${event} hook`)
            return undefined
          }
          if (hook.enabled === false) continue
          if (hook.type !== undefined && hook.type !== 'command') {
            errors.push(`${file}: unsupported ${event} hook type ${String(hook.type)}`)
            continue
          }
          if (
            typeof hook.command !== 'string' ||
            hook.command.trim() === '' ||
            (hook.timeout !== undefined && (typeof hook.timeout !== 'number' || !Number.isFinite(hook.timeout) || hook.timeout <= 0))
          ) {
            errors.push(`${file}: invalid ${event} command hook`)
            return undefined
          }
          if (hook.async === true || hook.asyncRewake === true) {
            errors.push(`${file}: asynchronous project hooks are unsupported`)
            continue
          }
          const key = JSON.stringify([event, matcher, hook.command])
          if (seen.has(key)) continue
          seen.add(key)
          const timeoutMs = hook.timeoutMs ?? settings.hooks.timeoutMs
          if (format === 'zcode' && timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
            errors.push(`${file}: invalid ${event} hook timeoutMs`)
            return undefined
          }
          const timeout = format === 'zcode' && typeof timeoutMs === 'number' ? timeoutMs / 1000 : hook.timeout
          hooks.push({ type: 'command', command: hook.command, ...(typeof timeout === 'number' ? { timeout } : {}) })
        }
        if (hooks.length > 0) (events[event] ??= []).push({ ...(matcher === undefined ? {} : { matcher }), hooks })
      }
    }
  }
  return !disabled && Object.keys(events).length > 0 ? { projectRoot, events } : undefined
}
