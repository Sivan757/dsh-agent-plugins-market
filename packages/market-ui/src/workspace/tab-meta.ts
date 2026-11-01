/**
 * What each workspace tab is called, and what one collection of it is called.
 *
 * Three surfaces need the same answers: the workspace row (the tab's own label),
 * the preset manager (the same labels for the tabs a preset can switch, plus the
 * noun for one collection so its counts read like the workspace's), and the
 * install confirmation (the noun only). Each used to carry its own map, so adding
 * a tab or renaming a noun meant editing three files in lockstep and noticing if
 * one was missed. This module is the one place they answer from.
 *
 * @module client/workspace/tab-meta
 */
import type { LocaleKey } from '../locales.js'
import type { WorkspaceTabKey } from '../../../market-contracts/src/contracts/tab-layout.js'

/** What one tab is called, and what a collection of it holds. */
export interface WorkspaceTabMeta {
  /** The tab's own label. */
  label: LocaleKey
  /** The noun for one collection, when a sentence needs to name it. */
  surface?: LocaleKey
  /**
   * The name the preset manager's face list uses, where it differs.
   *
   * A preset switches the things a suite installs; the workspace also has tabs
   * for the prompt layer. `agents` is the one collection the two name
   * differently, and the difference is what this field records.
   */
  presetFace?: string
}

/** One entry per tab, in the contract's own key order. */
export const WORKSPACE_TAB_META: Record<WorkspaceTabKey, WorkspaceTabMeta> = {
  market: { label: 'workspaceTabMarket', presetFace: 'market' },
  skills: { label: 'workspaceTabSkills', surface: 'surfaceSkills', presetFace: 'skills' },
  personas: { label: 'workspaceTabPersonas', surface: 'surfaceAgents', presetFace: 'agents' },
  commands: { label: 'workspaceTabCommands', surface: 'surfaceCommands', presetFace: 'commands' },
  mcp: { label: 'workspaceTabMcp', surface: 'surfaceMcp', presetFace: 'mcp' },
  lsp: { label: 'workspaceTabLsp', surface: 'surfaceLsp', presetFace: 'lsp' },
  // The prompt layer: a preset can carry the style (one choice) and can only list an
  // instruction file (it has no switch), but both belong in the same row.
  instructions: { label: 'workspaceTabInstructions', presetFace: 'instructions' },
  outputStyles: { label: 'workspaceTabOutputStyles', presetFace: 'outputStyles' },
  hooks: { label: 'workspaceTabHooks', surface: 'surfaceHooks', presetFace: 'hooks' }
}

/**
 * The faces a preset switches, in the workspace's default order.
 *
 * A literal tuple rather than a filter over the metadata, so a face stays a
 * compile-time literal at every call site. The names are the preset manager's own;
 * `workspaceKeyOfFace` is what turns one into a workspace tab key.
 */
export const PRESET_FACES = ['market', 'skills', 'commands', 'agents', 'mcp', 'lsp', 'instructions', 'outputStyles', 'hooks'] as const

/**
 * The workspace tab key a preset face names.
 *
 * @param face - the preset manager's face name.
 * @returns the workspace tab key, or undefined for a face the workspace has no tab for.
 */
export function workspaceKeyOfFace(face: string): WorkspaceTabKey | undefined {
  return (Object.keys(WORKSPACE_TAB_META) as WorkspaceTabKey[]).find(key => WORKSPACE_TAB_META[key].presetFace === face)
}

/**
 * The preset face name for a workspace tab.
 *
 * @param key - the workspace tab key.
 * @returns the preset manager's face name, or undefined for a tab no preset switches.
 */
export function faceOfWorkspaceKey(key: WorkspaceTabKey): string | undefined {
  return WORKSPACE_TAB_META[key].presetFace
}
