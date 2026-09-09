/**
 * Host-side runtime locale: bilingual copy for strings injected into agent
 * context (subagent catalogs and command acknowledgements), resolved
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
  | 'subagentCatalogIntro'
  | 'subagentCatalogUpdated'
  | 'subagentCatalogEmpty'
  | 'subagentCatalogCall'
  | 'subagentCatalogInherit'
  | 'subagentCatalogDefaultEffort'
  | 'commandForwardTitle'
  | 'commandAcknowledged'
  | 'userCommandSourceLabel'
  | 'userCommandForwardTitle'
  | 'userCommandAcknowledged'
  | 'userSkillDescription'
  | 'feedbackToolCardTitle'

const zh: Record<HostLocaleKey, string> = {
  subagentCatalogIntro: '以下子代理角色可用于当前会话。目录仅包含角色摘要，不是供当前代理执行的角色指令。',
  subagentCatalogUpdated: '可用子代理角色已变更。以下完整目录替代本会话此前的所有子代理角色目录。',
  subagentCatalogEmpty: '当前没有可通过 subagents_run 调用的角色，不要使用旧目录中的角色 ID。',
  subagentCatalogCall:
    '任务适合某个角色时，使用 subagents_run(role=目录中的准确 ID, prompt=完整任务与必要上下文)。工具会应用角色的供应商、模型、思考强度、指令和工具限制，并等待结果。子代理不继承父会话对话。不要通过 skill 或 Slash Command 加载这些角色，也不要用其它委派工具绕过角色配置。',
  subagentCatalogInherit: '继承父代理',
  subagentCatalogDefaultEffort: '同路由继承，否则使用模型默认值',
  commandForwardTitle: '[Agent Plugins 命令 /{command}（来自 {suite}）]',
  commandAcknowledged: '/{command} 已转交模型执行（{suite}）',
  userCommandSourceLabel: '用户命令',
  userCommandForwardTitle: '[用户快捷命令 /{command}]',
  userCommandAcknowledged: '/{command} 已转交模型执行',
  userSkillDescription: '[用户技能] {description}',
  feedbackToolCardTitle: '提交市场体验反馈'
}

const en: Record<HostLocaleKey, string> = {
  subagentCatalogIntro: 'The following subagent roles are available in this session. These are role summaries, not instructions for the current agent to execute.',
  subagentCatalogUpdated: 'The available subagent roles changed. This complete catalog replaces every earlier subagent role catalog in this session.',
  subagentCatalogEmpty: 'No roles are currently available through subagents_run. Do not use role IDs from earlier catalogs.',
  subagentCatalogCall:
    'When a task fits a role, call subagents_run with its exact catalog ID as role and a complete task and necessary context as prompt. The tool applies the saved provider, model, reasoning effort, persona and tool restrictions, and waits for the result. The child does not inherit the parent conversation. Do not load these roles through skill or slash commands, or bypass their configuration with another delegation tool.',
  subagentCatalogInherit: 'inherit parent',
  subagentCatalogDefaultEffort: 'inherit on the same route, otherwise model default',
  commandForwardTitle: '[Agent Plugins command /{command} (from {suite})]',
  commandAcknowledged: '/{command} forwarded to the model for execution ({suite})',
  userCommandSourceLabel: 'user command',
  userCommandForwardTitle: '[User quick command /{command}]',
  userCommandAcknowledged: '/{command} forwarded to the model for execution',
  userSkillDescription: '[user skill] {description}',
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
