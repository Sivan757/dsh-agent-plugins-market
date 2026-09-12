/**
 * Optional model-facing experience-feedback tool.
 *
 * When enabled (the `feedbackEnabled` field of the market settings namespace,
 * default true), the model can call `report_market_issue` when it concludes a
 * problem it is looking at is caused by dsh-agent-plugins-market — a failed
 * install, a misdetected source, a market UI defect the user just described.
 *
 * Filing happens in three steps, most preferred first: the `gh` CLI when it is
 * installed and authenticated, the GitHub REST API when the process carries a
 * `GITHUB_TOKEN` / `GH_TOKEN`, and otherwise nothing is filed — the caller
 * gets the complete issue text plus a prefilled "new issue" URL that is opened
 * in the browser and handed back to the user to submit.
 *
 * The tool is deliberately narrow: the title/body must describe the problem,
 * real submissions are rate-limited, and the setting switch unregisters the
 * tool on the next reconcile pass.
 * @module runtime/feedback-tool
 */

import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { platformBrowserOpener } from './mcp-client/oauth.js'

const execFileAsync = promisify(execFile)

/** The GitHub repository experience feedback files issues against. */
export const FEEDBACK_REPO_OWNER = 'Sivan757'
export const FEEDBACK_REPO_NAME = 'dsh-agent-plugins-market'

/** Label applied to every tool-filed issue so they are filterable. */
export const FEEDBACK_LABEL = 'agent-feedback'

/** Minimum milliseconds between two accepted submissions (burst guard). */
const SUBMIT_COOLDOWN_MS = 60_000

/** Timeout for one `gh issue create` invocation. */
const GH_TIMEOUT_MS = 30_000

/** Host surface this plugin needs for the feedback tool. */
interface ToolsHost {
  tools?: {
    register(definition: unknown): () => void
  }
}

/** One accepted or rejected submission outcome, mirrored to the model. */
export interface FeedbackOutcome {
  ok: boolean
  /**
   * The created issue URL, or — when nothing could file it — the prefilled
   * "new issue" URL the user opens to submit the report themselves.
   */
  location?: string
  /** The complete issue title and body; present when nothing was filed automatically. */
  issueText?: string
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

/** Injectable effects, so tests never reach the network or a real browser. */
export interface FeedbackPorts {
  /** File the issue through the `gh` CLI; undefined when gh is missing or refused. */
  ghIssue?: (title: string, body: string) => Promise<string | undefined>
  /** Open the prefilled issue page; best effort. */
  openPage?: (url: string) => Promise<void>
}

/** The public "new issue" page for one report, prefilled with title and body. */
export function newIssueUrl(title: string, body: string): string {
  const query = new URLSearchParams({ title, body, labels: FEEDBACK_LABEL })
  return `https://github.com/${FEEDBACK_REPO_OWNER}/${FEEDBACK_REPO_NAME}/issues/new?${query.toString()}`
}

/**
 * Submit one experience report through `gh`, then the REST API, then a
 * prefilled issue page the user submits themselves. Only a real submission
 * advances the burst cooldown.
 */
export async function submitFeedback(dataRoot: string, report: FeedbackReport, now = Date.now(), ports: FeedbackPorts = {}): Promise<FeedbackOutcome> {
  const title = report.title.trim()
  if (title === '') return { ok: false, reason: 'title is required' }
  const body = renderFeedbackBody(report)
  const lastAt = await readLastSubmitAt(dataRoot)
  if (now - lastAt < SUBMIT_COOLDOWN_MS) {
    return { ok: false, reason: 'a feedback report was submitted less than a minute ago; wait and try again' }
  }
  const ghIssue = ports.ghIssue ?? createIssueWithGh
  let ghFailure: string | undefined
  try {
    const url = await ghIssue(title, body)
    if (url !== undefined) {
      await stampSubmitAt(dataRoot, now)
      return { ok: true, location: url }
    }
  } catch (error) {
    ghFailure = error instanceof Error ? error.message : String(error)
  }
  const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN']
  if (token !== undefined && token !== '') {
    try {
      const url = await createIssue(token, title, body)
      await stampSubmitAt(dataRoot, now)
      return { ok: true, location: url }
    } catch (error) {
      ghFailure ??= error instanceof Error ? error.message : String(error)
    }
  }
  const url = newIssueUrl(title, body)
  let opened = true
  try {
    await (ports.openPage ?? openInBrowser)(url)
  } catch {
    // A headless host has no browser to open; the link in `location` still works.
    opened = false
  }
  const detail = ghFailure === undefined ? 'nothing could file the issue automatically' : `filing failed (${ghFailure})`
  return {
    ok: true,
    location: url,
    issueText: `${title}\n\n${body}`,
    reason: opened ? `${detail}; the prefilled issue page was opened — submit it in the browser` : `${detail}; open the issue page at the returned location to submit it`
  }
}

/** Open one URL in the platform browser; a failure is the caller's to report. */
async function openInBrowser(url: string): Promise<void> {
  await platformBrowserOpener(new URL(url), 'feedback', () => {})
}

/**
 * File the issue with the `gh` CLI. Undefined means gh is absent, not
 * authenticated, or otherwise unable to create the issue — never a thrown
 * failure, so the caller can fall through to the REST API.
 */
async function createIssueWithGh(title: string, body: string): Promise<string | undefined> {
  const { stdout } = await execFileAsync(
    'gh',
    ['issue', 'create', '--repo', `${FEEDBACK_REPO_OWNER}/${FEEDBACK_REPO_NAME}`, '--title', title, '--body', body, '--label', FEEDBACK_LABEL],
    { timeout: GH_TIMEOUT_MS }
  )
  return /https:\/\/\S+/.exec(stdout)?.[0]
}

/** POST one issue through the REST API; returns its html_url. */
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

/**
 * Render one tool argument as text. Arguments arrive as untrusted values, so
 * `String` keeps the coercion the report has always applied for anything the
 * declared `type: 'string'` schema does not already cover.
 */
function textOf(value: unknown): string {
  return String(value)
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
  'the exact error text when one appeared. When the result carries `issueText`, the issue was not filed for you: ' +
  'show the human that text and the `location` link so they can submit it on GitHub.'

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
            issueText: { type: 'string' },
            reason: { type: 'string' }
          }
        },
        render: (_args: unknown, value: FeedbackOutcome) => [{ type: 'text' as const, text: JSON.stringify(value) }]
      },
      async execute(args: unknown) {
        const input = args as { title?: unknown; description?: unknown; expected?: unknown; actual?: unknown }
        const report: FeedbackReport = {
          title: textOf(input['title'] ?? ''),
          description: textOf(input['description'] ?? ''),
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
