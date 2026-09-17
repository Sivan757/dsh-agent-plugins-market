/**
 * Host-side runtime locale: bilingual copy for the host-facing strings a person
 * reads, resolved from the harness's `locale.preference` setting.
 *
 * The model-facing subagent catalog is not here. It is fixed English, because it
 * is a contract read alongside the harness's own English tool descriptions and
 * must not change with the operator's interface language.
 *
 * The web client resolves locale through its own injected service; the host
 * process reads the same setting through the host settings service once the
 * plugin wires it, and falls back to parsing `$DSH_HOME/settings.yaml` (the
 * document that service serves, and which exists even when the service is not
 * composed). Neither source means zh.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDshHome } from '../catalog/paths.js'

/** Host runtime dictionary keys (mirrored for zh and en). */
export type HostLocaleKey = 'commandAcknowledged' | 'userCommandSourceLabel' | 'feedbackToolCardTitle'

const zh: Record<HostLocaleKey, string> = {
  commandAcknowledged: '/{command} 已转交模型执行',
  userCommandSourceLabel: '用户命令',
  feedbackToolCardTitle: '提交市场体验反馈'
}

const en: Record<HostLocaleKey, string> = {
  commandAcknowledged: '/{command} forwarded to the model for execution',
  userCommandSourceLabel: 'user command',
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

/**
 * The active language, read from the host settings service when the plugin has
 * wired one. The service owns the resolved document in memory, so it answers
 * without a file read and without racing a pending write.
 */
let hostPreference: (() => string | undefined) | undefined

/**
 * Wire the host settings service as the primary locale source, replacing the
 * `settings.yaml` fallback.
 * @param read - reads `locale.preference` from the settings service.
 */
export function setHostLocaleSource(read: () => string | undefined): void {
  hostPreference = read
}

/**
 * The persisted locale preference: the host settings document when the service
 * is composed, else `$DSH_HOME/settings.yaml` (best effort).
 */
export async function readLocalePreference(): Promise<string | undefined> {
  const fromHost = hostPreference?.()
  if (fromHost !== undefined) return fromHost
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

/**
 * Read `locale.preference` from the host settings service.
 *
 * The locale namespace is registered by the host's own client-locale plugin, so
 * this reads `undefined` until that plugin mounts — which is why the caller
 * re-binds when the service arrives rather than capturing the value once.
 * @param settingsCtx - a context carrying the `settings` service.
 */
export function readHostLocalePreference(settingsCtx: unknown): string | undefined {
  const settings = (settingsCtx as { settings?: { get?: (ns: string) => unknown } }).settings
  const section = settings?.get?.('locale')
  const preference = (section as { preference?: unknown } | undefined)?.preference
  return typeof preference === 'string' ? preference : undefined
}
