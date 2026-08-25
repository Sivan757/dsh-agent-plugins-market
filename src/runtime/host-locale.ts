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
export type HostLocaleKey = 'agentDefinitionTitle' | 'agentDefinitionIntro' | 'commandForwardTitle' | 'commandAcknowledged' | 'agentCommandHint'

const zh: Record<HostLocaleKey, string> = {
  agentDefinitionTitle: '## 子代理定义（来自 Agent Plugins {suite}，Claude Code agents 格式）',
  agentDefinitionIntro: '当任务匹配下方描述时，通过 subagent 工具创建子代理并将「定义正文」原样作为指令执行。',
  commandForwardTitle: '[Agent Plugins 命令 /{command}（来自 {suite}）]',
  commandAcknowledged: '/{command} 已转交模型执行（{suite}）',
  agentCommandHint: '子代理'
}

const en: Record<HostLocaleKey, string> = {
  agentDefinitionTitle: '## Subagent definition (from Agent Plugins {suite}, Claude Code agents format)',
  agentDefinitionIntro: 'When the task matches the description below, create a subagent through the subagent tool and pass the definition body verbatim as its instructions.',
  commandForwardTitle: '[Agent Plugins command /{command} (from {suite})]',
  commandAcknowledged: '/{command} forwarded to the model for execution ({suite})',
  agentCommandHint: 'subagent'
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
