// Native snapshot analysis. No subprocesses, provider calls, or source-log reads.
import { createHash } from 'node:crypto'
import rules from './rules.js'
export const hash = (value) =>
  createHash('sha256').update(String(value)).digest('hex')
export const round = (n, digits = 2) => Number(n.toFixed(digits))
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const regex = (name, global = false) =>
  new RegExp(rules[name].source, rules[name].flags + (global ? 'g' : ''))
const test = (name, text) => regex(name).test(text)
const count = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n)
const ranked = (map) => [...map].sort((a, b) => b[1] - a[1])
const dict = (map) => Object.fromEntries(map)
const sum = (rows, key) =>
  rows.reduce((n, row) => n + (Number(row[key]) || 0), 0)
const median = (values) => percentile(values, 0.5)
function percentile(values, p) {
  if (!values.length) return 0
  const v = [...values].sort((a, b) => a - b),
    i = (v.length - 1) * p
  return v[Math.floor(i)] + (v[Math.ceil(i)] - v[Math.floor(i)]) * (i % 1)
}
const canonical = (value) =>
  JSON.stringify(value, function (key, item) {
    return object(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((k) => [k, item[k]]),
        )
      : item
  })
const charCount = (value) => [...value].length
const truncate = (value, n) =>
  charCount(value) > n
    ? [...value]
        .slice(0, n - 1)
        .join('')
        .trimEnd() + '…'
    : value
export function cleanContext(value) {
  return String(value || '')
    .replace(regex('SENSITIVE_BLOCK_RE', true), '')
    .replace(
      /<(skill_content|system-reminder|available_skills)\b[^>]*>(?:[\s\S]*?<\/\1>|[\s\S]*$)/gi,
      '',
    )
    .trim()
}
export function sanitize(text, privacy = 'redacted', limit = 600) {
  if (privacy === 'metrics') return ''
  let v = cleanContext(text).replace(
    regex('FENCED_CODE_RE', true),
    ' [code omitted] ',
  )
  v = v.replace(/https?:\/\/[^\s<>"']+/g, (raw) => {
    try {
      const url = new URL(raw)
      url.search = ''
      url.hash = ''
      url.username = ''
      url.password = ''
      return url.toString()
    } catch {
      return '<url>'
    }
  })
  for (const [key, replacement] of [
    ['BEARER_RE', 'Bearer <redacted>'],
    ['NAMED_SECRET_RE', '$1=<redacted>'],
    ['KNOWN_SECRET_RE', '<redacted-secret>'],
  ])
    v = v.replace(regex(key, true), replacement)
  if (privacy === 'redacted')
    for (const [key, replacement] of [
      ['EMAIL_RE', '<redacted-email>'],
      ['UUID_RE', '<id>'],
      ['HOME_UNIX_RE', '~'],
      ['HOME_WINDOWS_RE', '~'],
      ['ABS_UNIX_PATH_RE', '<path>'],
      ['ABS_WINDOWS_PATH_RE', '<path>'],
    ])
      v = v.replace(regex(key, true), replacement)
  v = v
    .replace(regex('LONG_TOKEN_RE', true), '<redacted-token>')
    .replace(/\s+/g, ' ')
    .trim()
  return truncate(v, limit)
}
export function secretErrors(value, privacy) {
  const errors = []
  // Check strings separately: JSON backslash escaping must not hide Windows paths.
  const visit = (item) => {
    if (typeof item === 'string') {
      for (const key of [
        'BEARER_RE',
        'NAMED_SECRET_RE',
        'KNOWN_SECRET_RE',
        'LONG_TOKEN_RE',
      ])
        if (test(key, item)) errors.push('output contains a secret signal')
      if (
        privacy === 'redacted' &&
        (test('ABS_UNIX_PATH_RE', item) || test('ABS_WINDOWS_PATH_RE', item))
      )
        errors.push('redacted output contains an absolute path')
    } else if (Array.isArray(item)) item.forEach(visit)
    else if (object(item))
      for (const [k, v] of Object.entries(item)) {
        visit(k)
        visit(v)
      }
  }
  visit(value)
  return [...new Set(errors)]
}
export function outputText(value) {
  const parts = []
  const visit = (item, key = null) => {
    if (object(item)) {
      if (['image', 'audio', 'input_image', 'input_audio'].includes(item.type))
        return
      for (const [k, v] of Object.entries(item))
        if (
          ![
            'data',
            'image_url',
            'audio_url',
            'authorization',
            'token',
            'credential',
          ].includes(k.toLowerCase())
        )
          visit(v, k.toLowerCase())
    } else if (Array.isArray(item)) item.forEach((v) => visit(v, key))
    else if (
      typeof item === 'string' &&
      [null, 'text', 'message', 'output', 'content'].includes(key) &&
      !item.startsWith('data:')
    )
      parts.push(item)
  }
  visit(value)
  return parts.join('\n')
}
function scalars(value) {
  if (Array.isArray(value)) return value.flatMap(scalars)
  if (object(value))
    return Object.entries(value).flatMap(([key, v]) =>
      v !== null && typeof v === 'object'
        ? scalars(v)
        : [[key.toLowerCase(), v]],
    )
  return [[null, value]]
}
export function analyzeTool(value, call = {}) {
  let outcome = 'unknown',
    exit = null
  for (const [key, v] of scalars(value)) {
    if (
      ['exit_code', 'exitcode', 'returncode'].includes(key) &&
      v !== null &&
      v !== '' &&
      Number.isFinite(Number(v))
    ) {
      exit = Math.trunc(Number(v))
      outcome = exit ? 'failure' : 'success'
      if (exit) break
    } else if (['success', 'ok'].includes(key)) {
      if (v === false) {
        outcome = 'failure'
        break
      }
      if (v === true) outcome = 'success'
    } else if (['is_error', 'iserror'].includes(key)) {
      if (v === true) {
        outcome = 'failure'
        break
      }
      if (v === false) outcome = 'success'
    } else if (key === 'status') {
      if (
        ['failed', 'failure', 'error', 'denied'].includes(
          String(v).toLowerCase(),
        )
      ) {
        outcome = 'failure'
        break
      }
      if (
        [
          'completed',
          'complete',
          'success',
          'succeeded',
          'ok',
          'passed',
        ].includes(String(v).toLowerCase())
      )
        outcome = 'success'
    }
  }
  const text = outputText(value),
    lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  const codes = lines.flatMap((line) => {
    const m = line.match(regex('RUNTIME_EXIT_LINE_RE'))
    return m ? [Number(m[1])] : []
  })
  // Explicit failures dominate success-looking text in a tool's output.
  if (outcome !== 'failure') {
    if (codes.length) {
      exit = codes.find((v) => v !== 0) ?? codes.at(-1)
      outcome = exit ? 'failure' : 'success'
    } else if (lines.some((l) => test('RUNTIME_FAILURE_LINE_RE', l)))
      outcome = 'failure'
    else if (lines.some((l) => test('RUNTIME_SUCCESS_LINE_RE', l)))
      outcome = 'success'
  }
  const diagnostic = outcome === 'failure' && !!call.diagnostic
  const failure = outcome === 'failure' && !diagnostic
  let textCause = null
  if (outcome !== 'failure' && !call.content_dump)
    for (const line of lines) {
      const rule = rules.TEXT_ERROR_RULES.find(([, r]) =>
        new RegExp(r.source, r.flags).test(line),
      )
      if (rule) {
        textCause = rule[0]
        break
      }
    }
  const cause =
    failure || textCause
      ? rules.FAILURE_CAUSE_RULES.find(([, r]) =>
          new RegExp(r.source, r.flags).test(text),
        )?.[0] ||
        textCause ||
        'other'
      : null
  let wall = 0
  for (const line of lines) {
    const m = line.match(regex('WALL_TIME_LINE_RE'))
    if (m) wall = Math.max(wall, Number(m[1]))
  }
  for (const [k, v] of scalars(value))
    if (
      ['wall_time_seconds', 'elapsed_seconds', 'duration_seconds'].includes(
        k,
      ) &&
      Number.isFinite(Number(v))
    )
      wall = Math.max(wall, Number(v))
  return {
    outcome,
    exit_code: exit,
    structured_failure: failure,
    diagnostic_nonzero: diagnostic,
    text_error_signal: !!textCause,
    cause,
    wall_seconds: wall,
    confidence: failure || diagnostic ? 'high' : textCause ? 'medium' : 'none',
  }
}
const zeroTokens = () =>
  Object.fromEntries(
    [...rules.TOKEN_KEYS, 'uncached_input_tokens', 'cache_write_tokens'].map(
      (k) => [k, 0],
    ),
  )
function tokensFor(usage) {
  const tokens = zeroTokens()
  for (const { value } of usage.values())
    for (const [source, target] of [
      ['inputTokens', 'uncached_input_tokens'],
      ['cacheReadTokens', 'cached_input_tokens'],
      ['cacheWriteTokens', 'cache_write_tokens'],
      ['outputTokens', 'output_tokens'],
      ['reasoningTokens', 'reasoning_output_tokens'],
    ])
      if (
        typeof value[source] === 'number' &&
        Number.isFinite(value[source]) &&
        value[source] >= 0
      )
        tokens[target] += Math.trunc(value[source])
  tokens.input_tokens =
    tokens.uncached_input_tokens + tokens.cached_input_tokens
  tokens.total_tokens =
    tokens.input_tokens + tokens.output_tokens + tokens.cache_write_tokens
  return tokens
}
const aggregateTokens = (rows) =>
  Object.fromEntries(
    Object.keys(zeroTokens()).map((k) => [
      k,
      rows.reduce((n, s) => n + s.tokens[k], 0),
    ]),
  )
const counters = [
  'task_started',
  'task_complete',
  'duration_ms',
  'user_messages',
  'assistant_messages',
  'correction_messages',
  'clarification_requests',
  'tool_calls',
  'tool_failures',
  'text_error_signals',
  'diagnostic_nonzero',
  'permission_blocks',
  'patches',
  'failed_patches',
  'subagents',
  'web_searches',
  'mcp_calls',
  'skill_calls',
  'aborted_turns',
  'git_commits',
  'unchanged_retries',
  'state_change_retries',
  'polling_retries',
  'tool_run_seconds',
  'wait_seconds',
  'verification_successes',
  'verification_failures',
  'accepted_evidence',
  'llm_retries',
  'denied_approvals',
  'system_messages',
  'injected_user_messages',
  'assistant_attempts',
  'assistant_attempts_with_usage',
  'compaction_events',
  'compaction_shadowed_events',
  'semantic_shadowed_messages',
  'inherited_event_count',
]
const maps = [
  'tool_counts',
  'failure_causes',
  'failure_tools',
  'verification_kinds',
  'skill_counts',
  'mcp_server_counts',
  'file_extensions',
  'skill_mentions',
  'injected_source_kinds',
  'provider_models',
  'calls',
  'last_failed_calls',
  'fingerprints',
  'approvals',
  'usage',
  'turn_starts',
]
const identifier = (id, opts, prefix) =>
  opts.privacy === 'local'
    ? sanitize(id, 'local', 300)
    : `${prefix}-${hash(id).slice(0, 12)}`
const projectLabel = (cwd) => {
  const label =
      String(cwd)
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .at(-1) || 'unknown',
    clean = sanitize(label)
  return clean.startsWith('<redacted-')
    ? `project-${hash(label).slice(0, 8)}`
    : clean
}
const timestamp = (value) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Math.abs(value) < 8.64e15
    ? value
    : null
export function parseSnapshot(snapshot, opts, coverage) {
  if (
    !object(snapshot) ||
    !object(snapshot.session) ||
    !Array.isArray(snapshot.events)
  ) {
    coverage.malformed_lines++
    return null
  }
  const h = snapshot.session,
    time = timestamp(h.createdAt)
  if (time === null) {
    coverage.missing_metadata++
    return null
  }
  if (time < opts.now - opts.days * 86400000 || time > opts.now) {
    coverage.skipped_outside_window++
    return null
  }
  const cwd = String(h.cwd || 'unknown'),
    rawId = String(h.id || 'unknown')
  if (opts.project) {
    const normalize = (value) => {
      const path = String(value).replace(/\\/g, '/').replace(/\/+$/, '')
      return /^[A-Za-z]:\//.test(path) ? path.toLowerCase() : path
    }
    const actual = normalize(cwd),
      requested = normalize(opts.project)
    if (actual !== requested && !actual.startsWith(requested + '/')) {
      coverage.skipped_project++
      return null
    }
  }
  const s = {
    ...Object.fromEntries(counters.map((k) => [k, 0])),
    ...Object.fromEntries(maps.map((k) => [k, new Map()])),
    rawId,
    family: h.origin === 'subagent' ? String(h.parentSession || rawId) : rawId,
    cwd,
    time,
    start: time,
    end: time,
    project: projectLabel(cwd),
    role: h.origin === 'subagent' ? 'task_subagent' : 'root_task',
    platform: /^[A-Za-z]:\\/.test(cwd)
      ? 'windows'
      : cwd.startsWith('/Users/')
        ? 'macos'
        : cwd.startsWith('/')
          ? 'posix_other'
          : 'unknown',
    generation: h.version ?? null,
    turn_ids: new Set(),
    rejected: new Set(),
    surface: [],
    messages: [],
    excerpts: [],
    prompt_lengths: [],
    assistant_latencies: [],
    user_responses: [],
    topic: '',
    first: '',
    provider_title: '',
    fallback_title: '',
    meta_analysis: false,
    epoch: 0,
    session_header_records: 1,
  }
  const analysisPrivacy =
    opts.privacy === 'metrics'
      ? 'metrics'
      : opts.analysis_privacy || opts.privacy
  function message(role, raw, seq, facts) {
    if (
      analysisPrivacy === 'metrics' ||
      (role === 'tool' && opts.analysis_depth !== 'evidence')
    )
      return
    const text = sanitize(raw, analysisPrivacy, role === 'tool' ? 700 : 12000)
    if (!text || text === '[code omitted]') return
    const digest = hash(`${role}\0${text}`)
    if (!s.messages.some((m) => m.digest === digest))
      s.messages.push({
        role,
        text,
        seq,
        digest,
        ...(facts ? { tool_facts: facts } : {}),
      })
  }
  for (const r of snapshot.events) {
    if (!object(r)) {
      coverage.malformed_lines++
      continue
    }
    const type = r.type,
      d = r.data,
      seq = Number.isInteger(r.seq) ? r.seq : null,
      at = timestamp(r.time)
    if (!rules.DSH_KNOWN_RECORD_TYPES.includes(type)) {
      coverage.unknown_record_types[
        sanitize(type || '<missing>', 'redacted', 100)
      ] =
        (coverage.unknown_record_types[
          sanitize(type || '<missing>', 'redacted', 100)
        ] || 0) + 1
      continue
    }
    if (type === 'session') {
      s.session_header_records++
      continue
    }
    if (!object(d)) {
      coverage.malformed_lines++
      continue
    }
    if (at !== null) {
      s.start = Math.min(s.start, at)
      s.end = Math.max(s.end, at)
    }
    if (
      [
        'user/message',
        'assistant/message',
        'system/message',
        'tool/result',
      ].includes(type) &&
      seq !== null
    ) {
      const op = r.surfaceOp
      if (
        object(op) &&
        op.op === 'replace' &&
        Number.isInteger(op.startSeq) &&
        Number.isInteger(op.endSeq)
      ) {
        const start = s.surface.indexOf(op.startSeq),
          end = s.surface.indexOf(op.endSeq)
        if (start < 0 || end < start) {
          coverage.malformed_lines++
        } else {
          const shadowed = new Set(
              s.surface.splice(start, end - start + 1, seq),
            ),
            before = s.messages.length
          s.messages = s.messages.filter((m) => !shadowed.has(m.seq))
          s.semantic_shadowed_messages += before - s.messages.length
          s.compaction_shadowed_events += shadowed.size
          coverage.surface_replacements++
        }
      } else s.surface.push(seq)
    }
    if (type === 'turn/start' && d.turn != null) {
      const key = String(d.turn)
      s.turn_ids.add(key)
      s.task_started++
      if (at !== null) s.turn_starts.set(key, at)
    } else if (type === 'turn/end' && d.turn != null) {
      const key = String(d.turn),
        start = s.turn_starts.get(key)
      if (start !== undefined && at !== null)
        s.duration_ms += Math.max(0, at - start)
      s.turn_starts.delete(key)
      s[
        ['aborted', 'interrupted', 'error'].includes(d.reason?.kind)
          ? 'aborted_turns'
          : 'task_complete'
      ]++
    } else if (type === 'user/message') {
      if (object(d.source) && d.source.kind !== 'user') {
        s.injected_user_messages++
        count(s.injected_source_kinds, String(d.source.kind || 'unknown'))
        continue
      }
      const raw = cleanContext(outputText(d.content || d.message || ''))
      s.user_messages++
      s.prompt_lengths.push(charCount(raw))
      if (!s.first) s.first = raw
      if (s.topic.length < 50000) s.topic += ' ' + sanitize(raw, 'local', 5000)
      for (const m of s.topic
        ? sanitize(raw, 'local', 5000).matchAll(regex('SKILL_MENTION_RE', true))
        : [])
        count(s.skill_mentions, m[1].toLowerCase())
      if (s.user_messages > 1 && test('USER_ACCEPTANCE_RE', raw))
        s.accepted_evidence++
      if (at !== null) {
        if (s.lastAgent != null)
          s.user_responses.push(Math.max(0, at - s.lastAgent) / 1000)
        s.lastUser = at
        s.awaiting = true
      }
      const correction = s.user_messages > 1 && test('CORRECTION_RE', raw)
      if (correction) s.correction_messages++
      if (opts.privacy !== 'metrics' && (correction || s.user_messages <= 4))
        s.excerpts.push({
          kind: correction
            ? 'correction'
            : s.user_messages === 1
              ? 'prompt'
              : 'follow_up',
          text: sanitize(raw, opts.privacy, 600),
        })
      message('user', raw, seq)
    } else if (type === 'system/message') s.system_messages++
    else if (type === 'assistant/attempt') {
      s.assistant_attempts++
      if (d.stream?.some((r) => r?.chunk?.type === 'usage'))
        s.assistant_attempts_with_usage++
    } else if (type.startsWith('compaction/')) s.compaction_events++
    else if (type === 'assistant/message' || type === 'assistant/chunk') {
      const committed = type === 'assistant/message',
        value = committed
          ? d.usage || d.message?.usage
          : d.chunk?.type === 'usage'
            ? d.chunk.usage
            : null,
        key = JSON.stringify([String(d.turn || ''), String(d.step || '')])
      if (object(value) && (committed || !s.usage.get(key)?.committed))
        s.usage.set(key, { value, committed })
      if (committed) {
        s.assistant_messages++
        message('assistant', outputText(d.message), seq)
        if (at !== null) {
          if (s.awaiting && s.lastUser != null) {
            s.assistant_latencies.push(Math.max(0, at - s.lastUser) / 1000)
            s.awaiting = false
          }
          s.lastAgent = at
        }
        const src = d.message?.source
        if (src?.provider && src?.model)
          count(s.provider_models, JSON.stringify([src.provider, src.model]))
      }
    } else if (type === 'command/run') {
      if (String(d.name).toLowerCase() === 'insight')
        s.meta_analysis = true
    } else if (type === 'tool/call') {
      const raw = String(d.name || 'unknown'),
        name = raw.toLowerCase().startsWith('mcp__zotero__')
          ? 'mcp__zotero'
          : sanitize(raw, 'redacted', 100)
      let args = d.arguments ?? d.input ?? ''
      try {
        if (typeof args === 'string') args = JSON.parse(args)
      } catch {
        /* plain command */
      }
      const argumentText = typeof args === 'string' ? args : canonical(args),
        transport = new Set([
          'sandbox_permissions',
          'justification',
          'prefix_rule',
          'yield_time_ms',
          'max_output_tokens',
        ])
      const fp = hash(
          name +
            '\0' +
            canonical(
              object(args)
                ? Object.fromEntries(
                    Object.entries(args).filter(([k]) => !transport.has(k)),
                  )
                : args,
            ),
        ),
        approval = args?.sandbox_permissions || 'default'
      count(s.fingerprints, fp)
      s.tool_calls++
      count(s.tool_counts, name)
      for (const m of argumentText.matchAll(regex('FILE_EXTENSION_RE', true)))
        if (rules.COMMON_FILE_EXTENSIONS.includes(m[1].toLowerCase()))
          count(s.file_extensions, m[1].toLowerCase())
      if (name === 'request_user_input') s.clarification_requests++
      if (
        ['spawn_agent', 'create_agent', 'subagent', 'workflow'].includes(name)
      )
        s.subagents++
      if (/web.*(run|search|query)/i.test(name)) s.web_searches++
      if (/^mcp|mcp__/i.test(raw)) {
        s.mcp_calls++
        count(
          s.mcp_server_counts,
          raw.includes('__')
            ? raw.split('__')[1]
            : raw.slice(3).split('_')[0] || raw,
        )
      }
      if (name === 'skill') {
        s.skill_calls++
        count(
          s.skill_counts,
          typeof args?.name === 'string'
            ? sanitize(args.name, 'redacted', 100)
            : 'skill',
        )
      }
      const polling = [
          'wait',
          'wait_agent',
          'wait_threads',
          'write_stdin',
        ].includes(name),
        prior = s.last_failed_calls.get(fp)
      if (polling && s.fingerprints.get(fp) > 1) s.polling_retries++
      else if (prior)
        s[
          prior.epoch < s.epoch || prior.approval !== approval
            ? 'state_change_retries'
            : 'unchanged_retries'
        ]++
      const call = {
        tool: name,
        fingerprint: fp,
        approval,
        polling,
        content_dump: test('CONTENT_DUMP_COMMAND_RE', argumentText),
        diagnostic: test('DIAGNOSTIC_COMMAND_RE', argumentText),
        verification: test('VERIFICATION_COMMAND_RE', argumentText),
        state_change:
          ['apply_patch', 'request_user_input'].includes(name) ||
          test('STATE_CHANGE_COMMAND_RE', argumentText),
        git_commit: /(?:^|[\s;|&])git\s+commit(?:\s|$)/.test(argumentText),
      }
      s.calls.set(String(d.callId || ''), call)
    } else if (type === 'tool/result') {
      const id = String(
          d.callId ||
            d.toolCallId ||
            d.message?.source?.callId ||
            d.message?.content?.find((b) => b?.toolCallId)?.toolCallId ||
            '',
        ),
        call = s.calls.get(id) || { tool: 'unknown' },
        value = d.message || d
      const txt = outputText(value),
        permission =
          test('DSH_SANDBOX_DENIED_RE', txt) ||
          test('DSH_USER_REJECTED_RE', txt) ||
          d.error?.code === 'FS_SANDBOX_DENIED'
      const a = analyzeTool(
        {
          message: value,
          ...(d.error && Object.keys(d.error).length
            ? { isError: true, error: d.error }
            : {}),
          ...(permission ? { isError: true } : {}),
        },
        call,
      )
      if (permission && a.structured_failure) a.cause = 'permission_boundary'
      if (a.structured_failure) {
        s.tool_failures++
        count(s.failure_tools, call.tool)
        if (call.fingerprint)
          s.last_failed_calls.set(call.fingerprint, {
            epoch: s.epoch,
            approval: call.approval,
          })
      }
      if (a.text_error_signal) s.text_error_signals++
      if (a.diagnostic_nonzero) s.diagnostic_nonzero++
      if (a.cause) count(s.failure_causes, a.cause)
      if (call.verification) {
        if (a.outcome === 'success' && !a.text_error_signal) {
          s.verification_successes++
          count(s.verification_kinds, call.tool)
        } else if (a.structured_failure || a.text_error_signal)
          s.verification_failures++
      }
      if (a.outcome === 'success' && call.state_change) s.epoch++
      s.tool_run_seconds += a.wall_seconds
      if (call.polling) s.wait_seconds += a.wall_seconds
      if (a.outcome === 'success' && call.git_commit) s.git_commits++
      if (
        a.cause === 'permission_boundary' &&
        a.structured_failure &&
        !s.rejected.has(id)
      )
        s.permission_blocks++
      if (
        call.verification ||
        call.state_change ||
        a.outcome === 'failure' ||
        call.git_commit
      ) {
        const facts = {
          tool: call.tool,
          outcome: a.outcome,
          exit_code: a.exit_code,
          cause: a.cause,
          verification: !!call.verification,
          state_change: !!call.state_change,
          git_commit: !!call.git_commit,
        }
        const lines = call.content_dump
          ? []
          : txt
              .split(/\r?\n/)
              .filter((l) => test('TOOL_EVIDENCE_LINE_RE', l))
              .slice(0, 3)
        message(
          'tool',
          `Tool ${call.tool}; outcome ${a.outcome}; exit ${a.exit_code}; cause ${a.cause || 'none'}; ${lines.join('; ')}`,
          seq,
          facts,
        )
      }
    } else if (type === 'approval/asked') s.approvals.set(String(d.id), d)
    else if (
      type === 'approval/decided' &&
      ['rejected', 'denied'].includes(String(d.outcome).toLowerCase())
    ) {
      s.denied_approvals++
      s.permission_blocks++
      const call = s.approvals.get(String(d.id))?.callId
      if (call) s.rejected.add(String(call))
    } else if (type === 'llm/retry') {
      s.llm_retries++
      count(s.failure_causes, 'llm_retry')
    } else if (type === 'session/title' && typeof d.title === 'string') {
      if (d.source?.kind === 'provider') s.provider_title = d.title
      else if (!s.fallback_title) s.fallback_title = d.title
    } else if (
      type === 'session/end-seed' &&
      d.inherited === true &&
      seq !== null
    )
      s.inherited_event_count = seq
    else if (type === 'request/header' || type === 'request/context') {
      const c = type === 'request/header' ? d.header?.config : d
      if (c?.provider && c?.model)
        count(s.provider_models, JSON.stringify([c.provider, c.model]))
    }
  }
  s.tokens = tokensFor(s.usage)
  s.repeated_retries =
    s.unchanged_retries + s.state_change_retries + s.polling_retries
  s.status =
    s.task_started > s.task_complete + s.aborted_turns
      ? 'partial'
      : s.aborted_turns
        ? 'aborted'
        : 'completed'
  if (s.status === 'partial') coverage.partial_sessions++
  s.completion = {
    log_completed: s.status === 'completed' ? 'yes' : 'no',
    verified_completed: s.verification_successes
      ? 'yes'
      : s.verification_failures
        ? 'no'
        : 'unknown',
    accepted: s.accepted_evidence ? 'yes' : 'unknown',
  }
  s.complexity_score = round(
    s.turn_ids.size * 2 +
      Math.min(s.tool_calls, 50) +
      s.patches * 4 +
      s.subagents * 6 +
      Math.min(s.duration_ms / 60000, 120) / 5,
    1,
  )
  s.work_area = 'general'
  let best = 0
  for (const [area, terms] of rules.WORK_AREA_RULES) {
    const score = terms.reduce(
      (n, t) => n + s.topic.toLowerCase().split(t).length - 1,
      0,
    )
    if (score > best) {
      best = score
      s.work_area = area
    }
  }
  s.session_type =
    s.turn_ids.size <= 1 && s.tool_calls <= 2 && s.duration_ms < 120000
      ? 'quick_check'
      : s.subagents
        ? 'multi_agent'
        : s.patches
          ? 'implementation'
          : s.web_searches || s.mcp_calls
            ? 'research'
            : s.tool_calls >= 10
              ? 'tool_driven'
              : 'conversation'
  s.meta_analysis ||=
    s.skill_mentions.has('insight') ||
    (/insights/i.test(s.first) &&
      /使用洞察|semantic_insights|analyze_dsh_sessions|\$(?:dsh-agent-plugins-)?insight|scripts\/insight\.mjs/i.test(
        s.first,
      ))
  return s
}
function publicSession(s, opts) {
  const date = new Date(s.time),
    source =
      opts.privacy === 'metrics'
        ? 'omitted'
        : s.provider_title
          ? 'provider'
          : s.fallback_title
            ? 'fallback'
            : 'prompt'
  const [provider, model] = s.provider_models.size
    ? JSON.parse(ranked(s.provider_models)[0][0])
    : [null, null]
  return {
    ...Object.fromEntries(
      counters
        .filter(
          (k) =>
            ![
              'duration_ms',
              'task_started',
              'task_complete',
              'accepted_evidence',
              'assistant_attempts_with_usage',
              'verification_successes',
              'verification_failures',
            ].includes(k),
        )
        .map((k) => [k, s[k]]),
    ),
    rollout_id: identifier(s.rawId, opts, 'rollout'),
    task_family_id: identifier(s.family, opts, 'task'),
    rollout_file: identifier(
      `session-query/${s.rawId}/session.jsonl`,
      opts,
      'file',
    ),
    role: s.role,
    classification_basis: 'structured',
    platform: s.platform,
    session_header_records: s.session_header_records,
    project: s.project,
    date: date.toISOString().slice(0, 10),
    start_hour_local: date.getHours(),
    weekday: (date.getDay() + 6) % 7,
    observed_minutes: round((s.end - s.start) / 60000, 1),
    status: s.status,
    title:
      source === 'omitted'
        ? opts.locale === 'en'
          ? 'Content omitted'
          : '内容已省略'
        : sanitize(
            s.provider_title || s.fallback_title || s.first,
            opts.privacy,
            140,
          ) || (opts.locale === 'en' ? 'No usable title' : '未提供可用标题'),
    title_source: source,
    work_area: s.work_area,
    session_type: s.session_type,
    meta_analysis: s.meta_analysis,
    complexity_score: s.complexity_score,
    turns: s.turn_ids.size,
    active_minutes: round(s.duration_ms / 60000, 1),
    log_generation_version: s.generation,
    injected_source_kinds: dict(s.injected_source_kinds),
    median_prompt_chars: Math.trunc(median(s.prompt_lengths)),
    failure_causes: dict(s.failure_causes),
    failure_rule_version: '5.1.0-native',
    repeated_retries: s.repeated_retries,
    completion: s.completion,
    verification: {
      successes: s.verification_successes,
      failures: s.verification_failures,
      kinds: dict(s.verification_kinds),
    },
    timing: {
      observed_wall_seconds: (s.end - s.start) / 1000,
      active_seconds: s.duration_ms / 1000,
      tool_run_seconds: round(s.tool_run_seconds),
      wait_seconds: round(s.wait_seconds),
      measurement: {
        observed_wall_seconds: 'measured',
        active_seconds: 'proxy',
        tool_run_seconds: 'proxy',
        wait_seconds: 'proxy',
      },
    },
    median_assistant_latency_seconds: round(median(s.assistant_latencies)),
    median_user_response_seconds: round(median(s.user_responses)),
    tokens: s.tokens,
    top_tools: ranked(s.tool_counts)
      .slice(0, 5)
      .map(([n]) => n),
    file_extensions: ranked(s.file_extensions)
      .slice(0, 5)
      .map(([n]) => n),
    skill_mentions: ranked(s.skill_mentions)
      .slice(0, 5)
      .map(([n]) => n),
    provider: sanitize(provider || '', 'local', 100) || null,
    model: sanitize(model || '', 'local', 100) || null,
  }
}
const groupBy = (rows, key) => {
  const groups = new Map()
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row[key]
    if (!groups.has(value)) groups.set(value, [])
    groups.get(value).push(row)
  }
  return groups
}
const mergeCounts = (rows, key) => {
  const map = new Map()
  for (const row of rows) for (const [k, v] of row[key]) count(map, k, v)
  return map
}
export function buildReport(snapshots, input = {}) {
  const opts = {
    days: 30,
    privacy: 'redacted',
    analysis_depth: 'evidence',
    locale: 'zh-CN',
    now: Date.now(),
    ...input,
  }
  // The reader caps a wide selection newest-first and reports how much of the
  // scope it read; carry that disclosure into the report so a truncated window
  // can never read as complete coverage. The reader's generation diagnostics
  // (versioned, legacy, plaintext, coexisting logs) describe the same selection
  // and travel with it under `coverage.selection`, the one coverage block.
  const bounds = object(opts.selection) ? opts.selection : null
  const generationDiagnostics =
    object(bounds?.coverage?.generation_diagnostics) &&
    Object.keys(bounds.coverage.generation_diagnostics).length > 0
      ? { ...bounds.coverage.generation_diagnostics }
      : null
  const coverage = {
    files_scanned: snapshots.length,
    sessions_analyzed: 0,
    skipped_outside_window: 0,
    skipped_project: 0,
    missing_metadata: 0,
    unreadable_files: 0,
    malformed_lines: 0,
    partial_sessions: 0,
    unknown_record_types: Object.create(null),
    deterministic_cache: {
      enabled: false,
      hits: 0,
      misses: 0,
      invalidations: 0,
      disabled: snapshots.length,
      write_errors: 0,
    },
    surface_replacements: 0,
    since: new Date(opts.now - opts.days * 86400000).toISOString(),
    until: new Date(opts.now).toISOString(),
    heuristic_role_rollouts: 0,
    unknown_system_rollouts: 0,
  }
  coverage.selection = {
    sessions_in_scope: bounds ? bounds.in_scope : snapshots.length,
    sessions_analyzed: bounds ? bounds.read : snapshots.length,
    sessions_not_analyzed: bounds ? bounds.not_analyzed : 0,
    snapshot_bytes: bounds ? bounds.snapshot_bytes : null,
    bounds: bounds ? bounds.bounds : null,
    truncated: bounds ? bounds.truncated === true : false,
    stopped_by: bounds ? bounds.stopped_by ?? null : null,
    ...(generationDiagnostics === null ? {} : { generation_diagnostics: generationDiagnostics }),
  }
  const sessions = snapshots
      .map((s) => parseSnapshot(s, opts, coverage))
      .filter(Boolean),
    rows = sessions.map((s) => publicSession(s, opts))
  coverage.sessions_analyzed = sessions.length
  const totals = {
    ...Object.fromEntries(counters.map((k) => [k, sum(sessions, k)])),
    sessions: sessions.length,
    turns: sessions.reduce((n, s) => n + s.turn_ids.size, 0),
    active_hours: round(sum(sessions, 'duration_ms') / 3600000),
    structured_failures: sum(sessions, 'tool_failures'),
    repeated_retries: sum(sessions, 'repeated_retries'),
    tokens: aggregateTokens(sessions),
  }
  const projects = [...groupBy(sessions, 'project')]
    .map(([project, ss]) => ({
      project,
      sessions: ss.length,
      turns: ss.reduce((n, s) => n + s.turn_ids.size, 0),
      active_hours: round(sum(ss, 'duration_ms') / 3600000),
      tool_calls: sum(ss, 'tool_calls'),
      tool_failures: sum(ss, 'tool_failures'),
      total_tokens: aggregateTokens(ss).total_tokens,
      top_tools: ranked(mergeCounts(ss, 'tool_counts'))
        .slice(0, 5)
        .map(([n]) => n),
    }))
    .sort((a, b) => b.sessions - a.sessions || b.tool_calls - a.tool_calls)
  const families = [...groupBy(sessions, 'family')]
    .map(([id, ss]) => {
      const sorted = [...ss].sort(
          (a, b) => a.time - b.time || a.rawId.localeCompare(b.rawId),
        ),
        root = sorted.find((s) => s.role === 'root_task') || sorted[0],
        row = rows[sessions.indexOf(root)],
        latencies = sorted.flatMap((s) => s.assistant_latencies),
        roles = groupBy(sorted, 'role')
      return {
        task_family_id: identifier(id, opts, 'task'),
        root_rollout_id: root.role === 'root_task' ? row.rollout_id : null,
        date: row.date,
        project: row.project,
        platform: row.platform,
        title: row.title,
        work_area: root.work_area,
        meta_analysis: ss.some((s) => s.meta_analysis),
        user_messages: sum(ss, 'user_messages'),
        correction_messages: sum(ss, 'correction_messages'),
        complexity_score: round(sum(ss, 'complexity_score')),
        rollout_count: ss.length,
        rollout_ids: sorted.map((s) => identifier(s.rawId, opts, 'rollout')),
        role_counts: Object.fromEntries(
          [...roles].map(([r, ss]) => [r, ss.length]),
        ),
        role_token_totals: Object.fromEntries(
          [...roles].map(([r, ss]) => [r, aggregateTokens(ss)]),
        ),
        tokens: aggregateTokens(ss),
        tool_calls: sum(ss, 'tool_calls'),
        structured_failures: sum(ss, 'tool_failures'),
        text_error_signals: sum(ss, 'text_error_signals'),
        diagnostic_nonzero: sum(ss, 'diagnostic_nonzero'),
        failure_causes: dict(mergeCounts(ss, 'failure_causes')),
        retry_classification: {
          unchanged: sum(ss, 'unchanged_retries'),
          after_state_change: sum(ss, 'state_change_retries'),
          polling: sum(ss, 'polling_retries'),
        },
        completion: {
          log_completed:
            root.role === 'root_task'
              ? root.completion.log_completed
              : 'unknown',
          verified_completed: ss.some((s) => s.verification_successes)
            ? 'yes'
            : ss.some((s) => s.verification_failures)
              ? 'no'
              : 'unknown',
          accepted:
            root.role === 'root_task' ? root.completion.accepted : 'unknown',
        },
        timing: {
          first_response_seconds: round(latencies[0] || 0),
          median_response_seconds: round(median(latencies)),
          p90_response_seconds: round(percentile(latencies, 0.9)),
          observed_wall_seconds: round(
            (Math.max(...ss.map((s) => s.end)) -
              Math.min(...ss.map((s) => s.start))) /
              1000,
          ),
          active_seconds: round(sum(ss, 'duration_ms') / 1000),
          tool_run_seconds: round(sum(ss, 'tool_run_seconds')),
          wait_seconds: round(sum(ss, 'wait_seconds')),
          action_reviewer_active_seconds_proxy: 0,
          measurement: {
            first_response_seconds: 'measured',
            median_response_seconds: 'measured',
            p90_response_seconds: 'measured',
            observed_wall_seconds: 'measured',
            active_seconds: 'proxy',
            tool_run_seconds: 'proxy',
            wait_seconds: 'proxy',
            action_reviewer_active_seconds_proxy: 'proxy',
          },
        },
        classification_basis: 'structured',
      }
    })
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.task_family_id.localeCompare(a.task_family_id),
    )
  coverage.task_families_without_root = families.filter(
    (f) => !f.root_rollout_id,
  ).length
  const distribution = (key) =>
    [...groupBy(sessions, key)].map(([name, ss]) => ({
      [key]: name,
      rollouts: ss.length,
      task_families: new Set(ss.map((s) => s.family)).size,
      tokens: aggregateTokens(ss),
      total_token_share: round(
        aggregateTokens(ss).total_tokens /
          Math.max(1, totals.tokens.total_tokens),
        4,
      ),
      tool_calls: sum(ss, 'tool_calls'),
      structured_failures: sum(ss, 'tool_failures'),
    }))
  const top = (key, label, limit = 12) =>
    ranked(mergeCounts(sessions, key))
      .slice(0, limit)
      .map(([name, count]) => ({
        [label]: sanitize(name, 'redacted', 100),
        count,
      }))
  const usage = {
    session_types: [...groupBy(sessions, 'session_type')]
      .map(([type, ss]) => ({ type, count: ss.length }))
      .sort((a, b) => b.count - a.count),
    top_tools: top('tool_counts', 'tool'),
    file_types: top('file_extensions', 'extension'),
    skill_mentions: top('skill_mentions', 'skill'),
    skill_usage: top('skill_counts', 'skill', 10),
    plugin_usage: top('mcp_server_counts', 'name', 10),
    hours_local: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: rows.filter((s) => s.start_hour_local === hour).length,
    })),
    weekdays: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      count: rows.filter((s) => s.weekday === weekday).length,
    })),
  }
  const prompts = sessions.flatMap((s) => s.prompt_lengths),
    turns = rows.map((s) => s.turns),
    overlap = new Set()
  let pairs = 0,
    active = 0,
    maximum = 0
  const intervals = sessions.filter((s) => s.end > s.start)
  for (let i = 0; i < intervals.length; i++)
    for (let j = i + 1; j < intervals.length; j++)
      if (
        Math.max(intervals[i].start, intervals[j].start) <
        Math.min(intervals[i].end, intervals[j].end)
      ) {
        overlap.add(i)
        overlap.add(j)
        pairs++
      }
  for (const [, delta] of intervals
    .flatMap((s) => [
      [s.start, 1],
      [s.end, -1],
    ])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    active += delta
    maximum = Math.max(maximum, active)
  }
  const interaction = {
    average_turns_per_session: round(
      totals.turns / Math.max(1, sessions.length),
    ),
    median_turns_per_session: round(median(turns)),
    median_prompt_chars: Math.trunc(median(prompts)),
    p90_prompt_chars: Math.trunc(percentile(prompts, 0.9)),
    correction_like_messages: totals.correction_messages,
    correction_rate_per_user_message: round(
      totals.correction_messages / Math.max(1, totals.user_messages),
    ),
    clarification_requests: totals.clarification_requests,
    aborted_turn_rate: round(totals.aborted_turns / Math.max(1, totals.turns)),
    tool_calls_per_turn: round(totals.tool_calls / Math.max(1, totals.turns)),
    multi_agent_sessions: sessions.filter((s) => s.subagents > 0).length,
    long_running_sessions: sessions.filter((s) => s.duration_ms >= 1800000)
      .length,
    quick_check_sessions: sessions.filter(
      (s) => s.session_type === 'quick_check',
    ).length,
    median_assistant_latency_seconds: round(
      median(sessions.flatMap((s) => s.assistant_latencies)),
    ),
    median_user_response_seconds: round(
      median(sessions.flatMap((s) => s.user_responses)),
    ),
    overlapping_sessions: overlap.size,
    overlap_pairs: pairs,
    max_concurrent: maximum,
  }
  const frictions = [
    ['tool_failures', 'tool_failures'],
    ['aborted_turns', 'aborted_turns'],
    ['repeated_retries_after_failure', 'unchanged_retries'],
    ['retries_after_state_change', 'state_change_retries'],
    ['polling_retries', 'polling_retries'],
    ['permission_blocks', 'permission_blocks'],
    ['failed_patches', 'failed_patches'],
    ['llm_retries', 'llm_retries'],
    ['denied_approvals', 'denied_approvals'],
  ]
    .map(([signal, key]) => ({
      signal,
      count: totals[key],
      affected_sessions: sessions.filter((s) => s[key] > 0).length,
      ...(key === 'tool_failures'
        ? {
            top_tools: ranked(mergeCounts(sessions, 'failure_tools'))
              .slice(0, 5)
              .map(([n]) => n),
          }
        : {}),
    }))
    .filter((f) => f.count)
  const areas = [...groupBy(rows, 'work_area')]
    .map(([area, ss]) => ({
      area,
      sessions: ss.length,
      turns: sum(ss, 'turns'),
      active_hours: round(sum(ss, 'active_minutes') / 60),
      tool_calls: sum(ss, 'tool_calls'),
      examples: [
        ...new Set(
          [...ss]
            .sort((a, b) => b.complexity_score - a.complexity_score)
            .map((s) => s.title),
        ),
      ]
        .filter(
          (t) =>
            ![
              'Content omitted',
              '内容已省略',
              'No usable title',
              '未提供可用标题',
            ].includes(t),
        )
        .slice(0, 3),
    }))
    .sort((a, b) => b.sessions - a.sessions || b.tool_calls - a.tool_calls)
  const providerMap = new Map(),
    modelMap = new Map()
  for (const s of sessions)
    for (const key of s.provider_models.keys()) {
      const [p, m] = JSON.parse(key)
      if (!providerMap.has(p)) providerMap.set(p, new Set())
      providerMap.get(p).add(s.rawId)
      if (!modelMap.has(key)) modelMap.set(key, new Set())
      modelMap.get(key).add(s.rawId)
    }
  const provider_models = [...modelMap].map(([key, ids]) => {
    const [p, m] = JSON.parse(key)
    return {
      provider: sanitize(p, 'redacted', 100),
      model: sanitize(m, 'redacted', 100),
      sessions: ids.size,
    }
  })
  const providers = [...providerMap].map(([p, ids]) => ({
    provider: sanitize(p, 'redacted', 100),
    sessions: ids.size,
    models: provider_models
      .filter((m) => m.provider === sanitize(p, 'redacted', 100))
      .map(({ model, sessions }) => ({ model, sessions })),
  }))
  const en = opts.locale === 'en',
    warnings = []
  if (sessions.length > 0 && sessions.length < 5)
    warnings.push(
      en
        ? 'Fewer than five sessions are in scope; treat behavioral conclusions as a small-sample snapshot.'
        : '有效会话少于 5 个；请将行为结论视为小样本快照。',
    )
  if (
    coverage.malformed_lines ||
    Object.keys(coverage.unknown_record_types).length
  )
    warnings.push(
      en
        ? 'Malformed or unknown events were observed; inspect coverage before drawing conclusions.'
        : '存在损坏或未知事件；形成结论前请检查覆盖情况。',
    )
  if (coverage.partial_sessions)
    warnings.push(
      en
        ? `${coverage.partial_sessions} rollouts have unfinished turns; this is not proof of family failure.`
        : `${coverage.partial_sessions} 个会话有未结束轮次，不代表整个任务族失败。`,
    )
  if (totals.assistant_attempts)
    warnings.push(
      en
        ? `${totals.assistant_attempts} attempts committed no reply; their token usage is unavailable and is not estimated.`
        : `${totals.assistant_attempts} 次模型尝试未产出回复，用量不可得，未做估算。`,
    )
  if (totals.semantic_shadowed_messages)
    warnings.push(
      en
        ? 'Compacted conversation text was removed from semantic evidence; event statistics remain historical.'
        : '压缩遮蔽的对话已从语义证据移除；事件统计仍按历史保留。',
    )
  const excerpts = [],
    seen = new Set(),
    perProject = new Map(),
    perSession = new Map(),
    complex = [...sessions].sort(
      (a, b) => b.complexity_score - a.complexity_score,
    )
  const add = (s, e) => {
    if (
      !e ||
      !e.text ||
      seen.has(e.text) ||
      excerpts.length >= 80 ||
      (perProject.get(s.project) || 0) >= 20 ||
      (perSession.get(s) || 0) >= 2
    )
      return
    seen.add(e.text)
    count(perProject, s.project)
    count(perSession, s)
    excerpts.push({
      ...e,
      project: s.project,
      date: new Date(s.time).toISOString().slice(0, 10),
      status: s.status,
      work_area: s.work_area,
      role: s.role,
      platform: s.platform,
      task_family_id: identifier(s.family, opts, 'task'),
    })
  }
  for (const s of complex) {
    add(
      s,
      s.excerpts.find((e) => e.kind === 'prompt'),
    )
    if (excerpts.length >= 5) break
  }
  for (const s of [...sessions].sort(
    (a, b) =>
      Number(b.tool_failures + b.aborted_turns + b.permission_blocks > 0) -
        Number(a.tool_failures + a.aborted_turns + a.permission_blocks > 0) ||
      b.complexity_score - a.complexity_score ||
      b.time - a.time,
  ))
    for (const e of s.excerpts.filter((e) => e.kind === 'correction')) add(s, e)
  for (const s of complex) for (const e of s.excerpts) add(s, e)
  const recommendations = buildRecommendations(
    totals,
    interaction,
    coverage,
    projects,
    en,
  )
  const completed = rows.filter((s) => s.status === 'completed'),
    dominant = projects[0]
  const strength = dominant
    ? en
      ? `${dominant.project}: ${dominant.sessions} sessions, ${dominant.active_hours} active hours and ${dominant.tool_calls} tool calls.`
      : `${dominant.project}：${dominant.sessions} 个会话、${dominant.active_hours} 小时和 ${dominant.tool_calls} 次工具调用。`
    : en
      ? 'No project data in this range.'
      : '当前范围没有项目数据。'
  const narrative = {
    glance: [
      { label: en ? 'Work focus' : '工作重心', text: strength },
      {
        label: en ? 'Friction' : '主要摩擦',
        text: en
          ? `${totals.tool_failures} structured failures, ${totals.unchanged_retries} unchanged retries, ${totals.permission_blocks} permission blocks. Inspect evidence before inferring causes.`
          : `${totals.tool_failures} 次结构化失败、${totals.unchanged_retries} 次原样重试、${totals.permission_blocks} 次权限阻塞；请结合证据判断原因。`,
      },
      {
        label: en ? 'Next step' : '下一步',
        text:
          recommendations[0]?.title ||
          (en ? 'Keep recording verification evidence.' : '继续记录验证证据。'),
      },
    ],
    wins: [
      {
        title: en ? 'Completed log states' : '日志完成状态',
        description: en
          ? `${completed.length} of ${rows.length} sessions have completed log states.`
          : `${rows.length} 个会话中有 ${completed.length} 个处于日志完成状态。`,
        evidence: en
          ? 'Log completion is not human acceptance or a quality judgment.'
          : '日志完成不等于人工验收或质量判断。',
      },
    ],
    horizon: [
      {
        title: en ? 'Recoverable workflows' : '可恢复的工作流',
        possible: en
          ? 'Connect audit, implementation, validation and delivery with checkpoints.'
          : '用检查点连接审计、实现、验证和交付。',
        starting_point: en
          ? 'Define phase inputs, completion criteria and resume points.'
          : '明确每阶段输入、完成标准与恢复入口。',
      },
    ],
  }
  const report = {
    schema: 'dsh-agent-plugins-insight/1',
    schema_version: 1,
    analyzer_version: '0.2.3-native.1',
    product: 'dsh-agent-plugins-insight',
    runtime: 'dsh',
    generated_at: new Date(opts.now).toISOString(),
    scope: {
      runtime: 'dsh',
      project: opts.project ? projectLabel(opts.project) : null,
      privacy_mode:
        opts.privacy === 'metrics'
          ? 'metrics_only'
          : opts.privacy === 'redacted'
            ? 'redacted_sample'
            : 'local_content',
      analysis_privacy_mode:
        opts.privacy === 'metrics'
          ? 'metrics'
          : opts.analysis_privacy || opts.privacy,
      analysis_depth: opts.analysis_depth,
      locale: opts.locale,
      max_excerpts: opts.privacy === 'metrics' ? 0 : 80,
    },
    coverage,
    totals,
    measurement_contract: {
      tokens:
        'Usage deduplicated per (turn,step); uncached+cacheRead+cacheWrite+output; reasoning is an output subdivision, not added twice. Not billing or quota.',
      attempts:
        'Attempts are not visible replies; usage is unavailable, not estimated.',
      injected_context:
        'Only human user messages count as work. System and synthetic context are not evidence.',
      timing: 'Wall time measured; active/tool/wait time are proxies.',
      causality: 'Recommendations are inferred, not verified outcomes.',
      failure_rule_version: '5.1.0-native',
      patches: 'not_applicable',
    },
    task_family_totals: {
      task_families: families.length,
      rollouts: sessions.length,
      root_tasks: sessions.filter((s) => s.role === 'root_task').length,
      verified_completed: families.filter(
        (f) => f.completion.verified_completed === 'yes',
      ).length,
      accepted: families.filter((f) => f.completion.accepted === 'yes').length,
    },
    role_metrics: distribution('role'),
    platform_metrics: distribution('platform'),
    projects,
    work_areas: areas,
    usage_profile: usage,
    interaction_metrics: interaction,
    friction_signals: frictions,
    narrative,
    recommendations,
    visualization_capabilities: {
      time_comparison: 'selected_range_halves',
      work_area_drilldown: true,
      recommendation_tracking: 'browser_local_storage',
    },
    workflow_candidates: [...rows]
      .sort((a, b) => b.complexity_score - a.complexity_score)
      .slice(0, 5),
    rollout_summaries: rows,
    session_summaries: rows,
    task_families: families,
    excerpts,
    warnings,
    providers,
    provider_models,
  }
  return { report, sessions, options: opts }
}
function buildRecommendations(t, m, c, projects, en) {
  const rows = []
  const add = (
    key,
    zhTitle,
    enTitle,
    zhAction,
    enAction,
    evidence,
    priority = 'medium',
  ) => {
    const title = en ? enTitle : zhTitle,
      action = en ? enAction : zhAction
    rows.push({
      id: 'rec-' + hash(key).slice(0, 12),
      feature: key,
      title,
      why: action,
      evidence,
      action,
      copy_prompt: action,
      priority,
    })
  }
  if (t.tool_failures || t.unchanged_retries)
    add(
      'verification',
      '把失败恢复写进任务契约',
      'Put recovery in the task contract',
      '重试前诊断原因，记录已完成项和验证结果，从最近检查点继续。',
      'Diagnose failures, record completed work and validation, and resume from the latest checkpoint.',
      `${t.tool_failures} failures; ${t.unchanged_retries} unchanged retries`,
      'high',
    )
  if (t.permission_blocks)
    add(
      'permissions',
      '开工时明确授权边界',
      'State authorization boundaries',
      '开工前明确可读、可写、可运行和需要确认的操作。',
      'State readable, writable, runnable and approval-required actions before starting.',
      `${t.permission_blocks} permission blocks`,
      'high',
    )
  if (m.correction_rate_per_user_message >= 0.12)
    add(
      'task-contract',
      '固定范围、证据与完成标准',
      'Fix scope, evidence and completion criteria',
      '将长期偏好放入 AGENTS.md，本次范围和验收标准写入任务。纠正率是启发式信号。',
      'Keep durable preferences in AGENTS.md and define scope and acceptance for this task. Correction rate is a heuristic.',
      `${m.correction_like_messages} correction-like messages`,
      'high',
    )
  if (c.partial_sessions || t.aborted_turns || m.long_running_sessions)
    add(
      'checkpoints',
      '为长任务设置阶段交付物',
      'Give long tasks phase deliverables',
      '按审计、实现、验证、交付拆分任务，每阶段保留状态与恢复入口。',
      'Split audit, implementation, validation and delivery; retain state and a resume point after each phase.',
      `${c.partial_sessions} partial sessions; ${t.aborted_turns} aborted turns`,
    )
  if (projects[0]?.sessions >= 5)
    add(
      'reusable-skill',
      '提炼高频项目流程',
      'Extract a repeatable project workflow',
      '提炼稳定输入、步骤、禁止项、验证命令和恢复策略，保留人工判断。',
      'Extract stable inputs, steps, boundaries, validation and recovery; preserve human judgment.',
      `${projects[0].project}: ${projects[0].sessions} sessions`,
    )
  return rows
}
export const analysisInternals = { identifier, canonical, regex, groupBy }
