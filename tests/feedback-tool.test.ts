import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submitFeedback, renderFeedbackBody } from '../src/runtime/feedback-tool.js'

describe('experience feedback tool', () => {
  it('spools reports locally when no GitHub token is present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-'))
    const oldToken = process.env['GITHUB_TOKEN']
    const oldAlt = process.env['GH_TOKEN']
    delete process.env['GITHUB_TOKEN']
    delete process.env['GH_TOKEN']
    try {
      const outcome = await submitFeedback(
        root,
        {
          title: 'Install fails for archive sources',
          description: 'The install button errors with "invalid override payload".',
          expected: 'The suite installs.',
          actual: 'The request fails.'
        },
        1_000_000
      )
      expect(outcome.ok).toBe(true)
      expect(outcome.location).toContain('reports.jsonl')
      const raw = await readFile(join(root, 'feedback', 'reports.jsonl'), 'utf8')
      const record = JSON.parse(raw.trim()) as { title: string; body: string }
      expect(record.title).toBe('Install fails for archive sources')
      expect(record.body).toContain('invalid override payload')
      expect(record.body).toContain('**Expected:** The suite installs.')
    } finally {
      if (oldToken !== undefined) process.env['GITHUB_TOKEN'] = oldToken
      if (oldAlt !== undefined) process.env['GH_TOKEN'] = oldAlt
      await rm(root, { recursive: true, force: true })
    }
  })

  it('enforces the burst cooldown between submissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-'))
    delete process.env['GITHUB_TOKEN']
    delete process.env['GH_TOKEN']
    try {
      const first = await submitFeedback(root, { title: 'a', description: 'b' }, 2_000_000)
      expect(first.ok).toBe(true)
      const second = await submitFeedback(root, { title: 'c', description: 'd' }, 2_000_000 + 1_000)
      expect(second.ok).toBe(false)
      expect(second.reason).toContain('less than a minute')
      // After the cooldown window the submission goes through again.
      const third = await submitFeedback(root, { title: 'e', description: 'f' }, 2_000_000 + 61_000)
      expect(third.ok).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a blank title before spooling anything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-'))
    try {
      for (const title of ['', '   ']) {
        const outcome = await submitFeedback(root, { title, description: 'something broke' }, 3_000_000)
        expect(outcome.ok).toBe(false)
        expect(outcome.reason).toBe('title is required')
      }
      // The guard runs before any write, so the rejected reports leave no spool.
      await expect(readFile(join(root, 'feedback', 'reports.jsonl'), 'utf8')).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('renders a deterministic body', () => {
    expect(renderFeedbackBody({ title: 'x', description: 'y', actual: 'z' })).toContain('**Actual:** z')
  })
})
