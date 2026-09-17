/**
 * The one "last change" wording the detail dialogs share.
 *
 * The bucket comes from the host's relative-time helper so two surfaces dating
 * the same file agree; the words stay in this plugin's dictionary.
 */
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../index.js'

/** `12 分钟前` / `3 天前`, or null when the timestamp cannot be read. */
export function lastChangeLabel(t: Translate, at: string): string | null {
  const ms = Date.parse(at)
  if (Number.isNaN(ms)) return null
  const { unit, n } = relativeTime(ms, Date.now())
  if (unit === 'now') return t('timeNow')
  const key =
    unit === 'minutes' ? 'timeMinutes'
    : unit === 'hours' ? 'timeHours'
    : unit === 'days' ? 'timeDays'
    : unit === 'months' ? 'timeMonths'
    : 'timeYears'
  return `${n} ${t(key)}`
}
