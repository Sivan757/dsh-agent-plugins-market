/**
 * Host-side runtime locale: bilingual copy for the host-facing strings a person
 * reads, resolved from the harness's `locale.preference` setting.
 *
 * The model-facing subagent catalog is not here. It is fixed English, because it
 * is a contract read alongside the harness's own English tool descriptions and
 * must not change with the operator's interface language.
 *
 * The web client resolves locale through its own injected service. The host
 * process reads the same setting off the harness settings service, which
 * projects every active profile entry's live configuration: the `locale` entry
 * carries `preference`. Every absence — no settings service, the entry not
 * active, no preference written, a value that is not a string — means zh.
 */

/** Host runtime dictionary keys (mirrored for zh and en). */
export type HostLocaleKey =
  | 'commandAcknowledged'
  | 'commandNotSelected'
  | 'commandMissingArguments'
  | 'userCommandSourceLabel'
  | 'feedbackToolCardTitle'
  | 'mcpServerDegraded'
  | 'mcpServerStopped'
  | 'mcpServerRecovered'
  | 'mcpServerOrigin'
  | 'mcpServerFailureClause'
  | 'mcpServerDegradedSummary'
  | 'mcpServerStoppedSummary'
  | 'mcpServerRecoveredSummary'

const zh: Record<HostLocaleKey, string> = {
  commandAcknowledged: '/{command} 已转交模型执行',
  commandNotSelected: '/{command} 未在当前会话启用',
  commandMissingArguments: '/{command} 以下已声明的参数没有取到值，按空值处理：{arguments}',
  userCommandSourceLabel: '用户命令',
  feedbackToolCardTitle: '提交市场体验反馈',
  mcpServerDegraded: 'MCP 服务器 {server}{origin} 连接已断开，正在重连（第 {attempt}/{max} 次），约 {delay} 秒后重试{failure}',
  mcpServerStopped: 'MCP 服务器 {server}{origin} 已停止重连；它提供的工具在重新挂载前不可用{failure}',
  mcpServerRecovered: 'MCP 服务器 {server} 已恢复连接，它提供的工具重新可用。',
  mcpServerOrigin: '（套件 {suite}，服务器键 {key}）',
  mcpServerFailureClause: '。最近错误：{error}',
  mcpServerDegradedSummary: '{server} 连接断开，重连中 {attempt}/{max}',
  mcpServerStoppedSummary: '{server} 已停止重连，工具不可用',
  mcpServerRecoveredSummary: '{server} 已恢复连接'
}

const en: Record<HostLocaleKey, string> = {
  commandAcknowledged: '/{command} forwarded to the model for execution',
  commandNotSelected: '/{command} is not enabled in this session',
  commandMissingArguments: '/{command} did not receive these declared arguments, left empty: {arguments}',
  userCommandSourceLabel: 'user command',
  feedbackToolCardTitle: 'File market feedback',
  mcpServerDegraded: 'MCP server {server}{origin} lost its connection and is reconnecting (attempt {attempt}/{max}), retrying in about {delay}s{failure}',
  mcpServerStopped: 'MCP server {server}{origin} stopped reconnecting; its tools stay unavailable until the mount is retried{failure}',
  mcpServerRecovered: 'MCP server {server} is connected again and its tools are available.',
  mcpServerOrigin: ' (suite {suite}, server key {key})',
  mcpServerFailureClause: '. Last error: {error}',
  mcpServerDegradedSummary: '{server} disconnected, retrying {attempt}/{max}',
  mcpServerStoppedSummary: '{server} stopped reconnecting; tools unavailable',
  mcpServerRecoveredSummary: '{server} reconnected'
}

const DICTS = { zh, en } as const

export type HostTranslate = (key: HostLocaleKey, params?: Record<string, string>) => string

/**
 * The settings entry the harness locale plugin owns. The web bundle patch
 * inserts it as `- id: locale` / `name: '@deepseek-ai/dsh-client-locale'`, and
 * that package's host half declares `Config = { preference: volatile(string) }`.
 */
export const LOCALE_SETTINGS_ENTRY = 'locale'

/**
 * The slice of the host settings service this module reads: the projection of
 * every active profile entry's live configuration that
 * `@deepseek-ai/dsh-settings`'s `SettingsForms.describe()` returns. The
 * namespace getter this read once called (`settings.get(ns)`) does not exist on
 * the pinned host line — harness `601d6761e4` replaced it with this projection —
 * so the shape is declared here against the published service.
 */
export interface LocaleSettingsSource {
  describe(): ReadonlyArray<{ ns: string; value: unknown }>
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

let hostLocaleSource: (() => string | undefined) | undefined

/**
 * Wire the reader the host-facing copy resolves through. The caller registers
 * the returned disposer with its own effects, so the wiring lives exactly as
 * long as the fiber that installed it; the disposer clears this reader only, so
 * a reload that installs a newer reader first keeps the newer one.
 * @param read - reads the active `locale.preference`, or `undefined`.
 * @returns the disposer that clears this wiring.
 */
export function setHostLocaleSource(read: () => string | undefined): () => void {
  hostLocaleSource = read
  return () => {
    if (hostLocaleSource === read) hostLocaleSource = undefined
  }
}

/**
 * The persisted locale preference: what {@link setHostLocaleSource} wired, and
 * `undefined` while the entry has not wired a reader.
 */
export function readLocalePreference(): string | undefined {
  return hostLocaleSource?.()
}

/**
 * Read `locale.preference` off the settings service's entry projection.
 *
 * `ctx.get` resolves the service from the store, and the store answers for as
 * long as the provider is active, so the caller can read it from the entry's
 * own context. The property read this replaces walks the reading fiber's
 * ancestors and throws `cannot get required service "settings" in inactive
 * context` once that fiber unloads, the state a profile reload leaves an
 * injection callback's context in.
 * @param settings - the host settings service, when the profile mounts one.
 * @returns the preference string, or `undefined` for every absence.
 */
export function readHostLocalePreference(settings: LocaleSettingsSource | undefined): string | undefined {
  const locale = settings?.describe().find(entry => entry.ns === LOCALE_SETTINGS_ENTRY)
  const preference = (locale?.value as { preference?: unknown } | undefined)?.preference
  return typeof preference === 'string' ? preference : undefined
}
