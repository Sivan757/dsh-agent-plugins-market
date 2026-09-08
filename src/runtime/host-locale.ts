/**
 * Host-side runtime locale: bilingual copy for strings injected into agent
 * context (agent-definition wrappers and command acknowledgements), resolved
 * from the harness's `locale.preference` setting.
 *
 * The web client resolves locale through its own injected service; the host
 * process has no such service, so this module reads `$DSH_HOME/settings.yaml`
 * (the same file the GUI preference editor writes) and falls back to zh.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDshHome } from '../catalog/paths.js'

/** Host runtime dictionary keys (mirrored for zh and en). */
export type HostLocaleKey =
  | 'agentDefinitionTitle'
  | 'agentDefinitionIntro'
  | 'commandForwardTitle'
  | 'commandAcknowledged'
  | 'agentCommandHint'
  | 'userCommandSourceLabel'
  | 'userCommandForwardTitle'
  | 'userCommandAcknowledged'
  | 'userSkillDescription'
  | 'userPersonaDescription'
  | 'feedbackToolCardTitle'

const zh: Record<HostLocaleKey, string> = {
  agentDefinitionTitle: '## 子代理定义（来自 Agent Plugins {suite}，Claude Code agents 格式）',
  agentDefinitionIntro: '当任务匹配下方描述时，通过 market_agent 工具按下方角色 ID 创建子代理，让保存的模型和工具限制实际生效。',
  commandForwardTitle: '[Agent Plugins 命令 /{command}（来自 {suite}）]',
  commandAcknowledged: '/{command} 已转交模型执行（{suite}）',
  agentCommandHint: '子代理',
  userCommandSourceLabel: '用户命令',
  userCommandForwardTitle: '[用户快捷命令 /{command}]',
  userCommandAcknowledged: '/{command} 已转交模型执行',
  userSkillDescription: '[用户技能] {description}',
  userPersonaDescription: '[用户角色卡] {description}',
  feedbackToolCardTitle: '提交市场体验反馈'
}

const en: Record<HostLocaleKey, string> = {
  agentDefinitionTitle: '## Subagent definition (from Agent Plugins {suite}, Claude Code agents format)',
  agentDefinitionIntro: 'When the task matches the description below, use market_agent with the role ID below so its saved model and tool restrictions are enforced.',
  commandForwardTitle: '[Agent Plugins command /{command} (from {suite})]',
  commandAcknowledged: '/{command} forwarded to the model for execution ({suite})',
  agentCommandHint: 'subagent',
  userCommandSourceLabel: 'user command',
  userCommandForwardTitle: '[User quick command /{command}]',
  userCommandAcknowledged: '/{command} forwarded to the model for execution',
  userSkillDescription: '[user skill] {description}',
  userPersonaDescription: '[user persona] {description}',
  feedbackToolCardTitle: 'File market feedback'
}

const DICTS = { zh, en } as const

export type HostTranslate = (key: HostLocaleKey, params?: Record<string, string>) => string

interface ResolvedLocale {
  t: HostTranslate
}

/** Resolve the active host language from settings; unknown values default to zh. */
export function bindHostLocale(preference: string | undefined): HostTranslate {
  const dict = preference !== undefined && preference.toLowerCase().startsWith('en') ? DICTS.en : DICTS.zh
  return (key, params) => {
    let text: string = dict[key]
    if (params !== undefined) {
      for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, value)
    }
    return text
  }
}

/** Read `locale.preference` from `$DSH_HOME/settings.yaml` (best effort). */
export async function readLocalePreference(): Promise<string | undefined> {
  try {
    const text = await readFile(join(resolveDshHome(), 'settings.yaml'), 'utf8')
    const match = /^locale:\s*\n(?:[ \t]+preference:\s*'?([^'"\s#]+)'?)/m.exec(text)
    return match?.[1]
  } catch {
    return undefined
  }
}

/** Bind a host translator against the persisted locale preference. */
export async function loadHostLocale(): Promise<ResolvedLocale> {
  return { t: bindHostLocale(await readLocalePreference()) }
}
