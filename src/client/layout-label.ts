import type { SuiteLayoutKind } from '../model/types.js'
import type { Translate } from './index.js'

const KEYS = {
  'agent-plugin-v1': 'layoutV1',
  'claude-code': 'layoutCC',
  codex: 'layoutCodex',
  universal: 'layoutUniversal',
  cursor: 'layoutCursor',
  kimi: 'layoutKimi',
  zcode: 'layoutZcode',
  qoder: 'layoutQoder',
  'github-copilot': 'layoutCopilot',
  remote: 'layoutRemote',
  'project-native': 'layoutProjectNative',
  'skill-collection': 'layoutSkills'
} as const satisfies Record<SuiteLayoutKind, Parameters<Translate>[0]>

export function suiteLayoutLabel(layout: string, t: Translate): string {
  return Object.hasOwn(KEYS, layout) ? t(KEYS[layout as SuiteLayoutKind]) : layout
}
