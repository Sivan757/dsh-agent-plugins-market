/**
 * Optional model-facing experience-feedback tool.
 *
 * When enabled (the `feedbackEnabled` field of the market settings namespace,
 * default true), the model can call `report_market_issue` when it concludes a
 * problem it is looking at is caused by dsh-agent-plugins-market — a failed
 * install, a misdetected source, a market UI defect the user just described.
 * The tool files a GitHub issue on the plugin repository through the GitHub
 * REST API, or falls back to appending a local JSONL record under the plugin
 * data root when no repository host context is available.
 *
 * The tool is deliberately narrow: the title/body must describe the problem,
 * submissions are rate-limited, and the setting switch unregisters the tool
 * on the next reconcile pass.
 * @module runtime/feedback-tool
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'

/** The GitHub repository experience feedback files issues against. */
export const FEEDBACK_REPO_OWNER = 'Sivan757'
export const FEEDBACK_REPO_NAME = 'dsh-agent-plugins-market'

/** Label applied to every tool-filed issue so they are filterable. */
export const FEEDBACK_LABEL = 'agent-feedback'

/** Minimum milliseconds between two accepted submissions (burst guard). */
const SUBMIT_COOLDOWN_MS = 60_000

/** Host surface this plugin needs for the feedback tool. */
interface ToolsHost {
  tools?: {
    register(definition: unknown): () => void
  }
}

/** One accepted or rejected submission outcome, mirrored to the model. */
export interface FeedbackOutcome {
  ok: boolean
  /** Where the report went: the issue URL, or the local fallback path label. */
  location?: string
  reason?: string
}

/** A structured experience report the model composes. */
export interface FeedbackReport {
  title: string
  description: string
  /** What the user was trying to do, when the model can tell. */
  expected?: string
  /** What actually happened (errors, wrong state, broken flow). */
  actual?: string
}

/**
 * Submit one experience report. Tries the GitHub issue API first (works when
 * the deployment carries a GITHUB_TOKEN / GH_TOKEN with repo scope), then
 * falls back to the local JSONL spool under `<dataRoot>/feedback/`.
 */
export async function submitFeedback(dataRoot: string, report: FeedbackReport, now = Date.now()): Promise<FeedbackOutcome> {
  const title = report.title.trim()
  if (title === '') return { ok: false, reason: 'title is required' }
  const body = renderFeedbackBody(report)
  const lastAt = await readLastSubmitAt(dataRoot)
  if (now - lastAt < SUBMIT_COOLDOWN_MS) {
    return { ok: false, reason: 'a feedback report was submitted less than a minute ago; wait and try again' }
  }
  const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN']
  if (token !== undefined && token !== '') {
    try {
      const url = await createIssue(token, title, body)
      await stampSubmitAt(dataRoot, now)
      return { ok: true, location: url }
    } catch (error) {
      // Network or auth failure: fall through to the local spool so the
      // report is never lost, and say so in the outcome.
      const local = await spoolLocally(dataRoot, title, body)
      await stampSubmitAt(dataRoot, now)
      return {
        ok: true,
        location: local,
        reason: `GitHub issue failed (${error instanceof Error ? error.message : String(error)}); saved locally instead`
      }
    }
  }
  const local = await spoolLocally(dataRoot, title, body)
  await stampSubmitAt(dataRoot, now)
  return { ok: true, location: local }
}

/** POST one issue; returns its html_url. */
async function createIssue(token: string, title: string, body: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${FEEDBACK_REPO_OWNER}/${FEEDBACK_REPO_NAME}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'dsh-agent-plugins-market-feedback'
    },
    body: JSON.stringify({ title, body, labels: [FEEDBACK_LABEL] }),
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`GitHub API ${response.status}${detail === '' ? '' : `: ${detail.slice(0, 200)}`}`)
  }
  const payload = (await response.json()) as { html_url?: string }
  if (payload.html_url === undefined) throw new Error('GitHub API returned no issue URL')
  return payload.html_url
}

/** Render the model's structured report into a deterministic issue body. */
export function renderFeedbackBody(report: FeedbackReport): string {
  const lines = ['## Experience feedback', '', `**Problem:** ${report.description.trim()}`, '']
  const expected = report.expected?.trim()
  const actual = report.actual?.trim()
  if (expected !== undefined && expected !== '') lines.push(`**Expected:** ${expected}`, '')
  if (actual !== undefined && actual !== '') lines.push(`**Actual:** ${actual}`, '')
  lines.push('---', `Filed automatically by the dsh-agent-plugins-market \`${FEEDBACK_TOOL_NAME}\` tool.`)
  return lines.join('\n')
}

/** Append one report to the local spool; returns the spool file path. */
async function spoolLocally(dataRoot: string, title: string, body: string): Promise<string> {
  const dir = join(dataRoot, 'feedback')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'reports.jsonl')
  const record = JSON.stringify({ at: new Date().toISOString(), title, body })
  await appendFile(file, `${record}\n`, 'utf8')
  return file
}

/** The last accepted submission's timestamp; 0 when the stamp file is absent. */
async function readLastSubmitAt(dataRoot: string): Promise<number> {
  try {
    const raw = await readFile(join(dataRoot, 'feedback', 'last-submit-at'), 'utf8')
    const value = Number.parseInt(raw.trim(), 10)
    return Number.isSafeInteger(value) ? value : 0
  } catch {
    return 0
  }
}

async function stampSubmitAt(dataRoot: string, now: number): Promise<void> {
  const dir = join(dataRoot, 'feedback')
  await mkdir(dir, { recursive: true })
  // Overwrite, not append: an appending stamp concatenates timestamps and
  // parseInt on the merged digits disables the cooldown permanently.
  await writeFile(join(dir, 'last-submit-at'), String(now), 'utf8')
}

export const FEEDBACK_TOOL_NAME = 'report_market_issue' as const

const FEEDBACK_DESCRIPTION =
  'File an experience-feedback issue for dsh-agent-plugins-market (the DeepSeek Harness agent plugin market). ' +
  'Call this ONLY when the human describes a problem caused by the agent plugins market itself — a failed or ' +
  'stuck install/uninstall, a market source that will not scan, wrong market UI behavior, or a runtime injection ' +
  'defect the user attributes to a market suite. Do not call it for problems in other plugins, in the harness, ' +
  "or in the user's own repositories. Compose a specific title; describe what happened, what was expected, and " +
  'the exact error text when one appeared.'

/**
 * Register the feedback tool; returns the disposer. Undefined when the host has
 * no tools service to register on — the caller turns that into a mount-path
 * diagnostic instead of an error, since the setting can simply have no effect
 * on this host.
 */
export function mountFeedbackTool(hostCtx: Context, dataRoot: string, t: (key: string, params?: Record<string, string>) => string): (() => void) | undefined {
  const host = hostCtx as unknown as ToolsHost
  if (typeof host.tools?.register !== 'function') return undefined
  return host.tools.register(
    defineTool({
      name: FEEDBACK_TOOL_NAME,
      description: FEEDBACK_DESCRIPTION,
      parameters: {
        title: { type: 'string', required: true, description: 'One-line problem summary for the issue title.' },
        description: { type: 'string', required: true, description: 'What the problem is, with exact error text when one appeared.' },
        expected: { type: 'string', description: 'What the user expected to happen.' },
        actual: { type: 'string', description: 'What actually happened instead.' }
      },
      output: {
        // The dsh-tools value-schema DSL rejects root-level `required`
        // (verified against dsh-tools@0.1.2-rc.1); required-ness is declared
        // per property instead.
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            location: { type: 'string' },
            reason: { type: 'string' }
          }
        },
        render: (_args: unknown, value: FeedbackOutcome) => [{ type: 'text' as const, text: JSON.stringify(value) }]
      },
      async execute(args: unknown) {
        const input = args as { title?: unknown; description?: unknown; expected?: unknown; actual?: unknown }
        const report: FeedbackReport = {
          title: String(input['title'] ?? ''),
          description: String(input['description'] ?? ''),
          ...(typeof input['expected'] === 'string' ? { expected: input['expected'] } : {}),
          ...(typeof input['actual'] === 'string' ? { actual: input['actual'] } : {})
        }
        return await submitFeedback(dataRoot, report)
      },
      presentCall: (args: unknown) => {
        const input = args as { title?: unknown }
        const view: GenericCallView = {
          card: 'generic',
          title: t('feedbackToolCardTitle'),
          kind: 'other',
          ...(typeof input['title'] === 'string' ? { rawInput: input['title'] } : {})
        }
        return view
      }
    })
  )
}
