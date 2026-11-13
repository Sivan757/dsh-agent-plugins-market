import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newIssueUrl, renderFeedbackBody, renderIssueBody, submitFeedback, type FeedbackPorts } from '../../../packages/market-bundle/src/platform/feedback-tool.js'
import { ALL_SURFACES_ON } from '../../../packages/market-contracts/src/contracts/surface-toggles.js'

/** Ports that never reach the network, a CLI, or a browser. */
function offline(): { ports: FeedbackPorts; opened: string[] } {
  const opened: string[] = []
  return { ports: { ghIssue: async () => undefined, openPage: async url => void opened.push(url) }, opened }
}

describe('experience feedback tool', () => {
  it('files through gh when the CLI can create the issue', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-'))
    const { ports, opened } = offline()
    try {
      const outcome = await submitFeedback(root, { title: 'Install fails for archive sources', description: 'The install button errors.' }, 1_000_000, {
        ...ports,
        ghIssue: async (title, body) => {
          expect(title).toBe('Install fails for archive sources')
          expect(body).toContain('The install button errors.')
          return 'https://github.com/Sivan757/dsh-agent-plugins-market/issues/7'
        }
      })
      expect(outcome).toMatchObject({ ok: true, location: 'https://github.com/Sivan757/dsh-agent-plugins-market/issues/7' })
      // Every accepted report leaves its bundle behind, filed or not.
      expect(typeof outcome.reportPath).toBe('string')
      expect(opened).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns the complete issue text and opens the prefilled page when nothing can file it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-'))
    const { ports, opened } = offline()
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
        1_000_000,
        ports
      )
      expect(outcome.ok).toBe(true)
      expect(outcome.location).toBe(
        newIssueUrl(
          'Install fails for archive sources',
          renderIssueBody(
            {
              title: 'Install fails for archive sources',
              description: 'The install button errors with "invalid override payload".',
              expected: 'The suite installs.',
              actual: 'The request fails.'
            },
            undefined
          )
        )
      )
      expect(outcome.location).toContain('github.com/Sivan757/dsh-agent-plugins-market/issues/new?')
      expect(opened).toEqual([outcome.location])
      expect(outcome.issueText).toContain('Install fails for archive sources')
      expect(outcome.issueText).toContain('invalid override payload')
      expect(outcome.issueText).toContain('**Expected:** The suite installs.')
      expect(outcome.reason).toContain('submit it in the browser')
    } finally {
      if (oldToken !== undefined) process.env['GITHUB_TOKEN'] = oldToken
      if (oldAlt !== undefined) process.env['GH_TOKEN'] = oldAlt
      await rm(root, { recursive: true, force: true })
    }
  })

  it('enforces the burst cooldown between real submissions only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-'))
    const { ports } = offline()
    const filing = { ...ports, ghIssue: async () => 'https://github.com/Sivan757/dsh-agent-plugins-market/issues/9' }
    try {
      const first = await submitFeedback(root, { title: 'a', description: 'b' }, 2_000_000, filing)
      expect(first.ok).toBe(true)
      const second = await submitFeedback(root, { title: 'c', description: 'd' }, 2_000_000 + 1_000, filing)
      expect(second.ok).toBe(false)
      expect(second.reason).toContain('less than a minute')
      // After the cooldown window the submission goes through again.
      const third = await submitFeedback(root, { title: 'e', description: 'f' }, 2_000_000 + 61_000, filing)
      expect(third.ok).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('leaves the cooldown untouched when nothing was filed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-'))
    const { ports, opened } = offline()
    try {
      const first = await submitFeedback(root, { title: 'a', description: 'b' }, 3_000_000, ports)
      const second = await submitFeedback(root, { title: 'c', description: 'd' }, 3_000_000 + 1_000, ports)
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      expect(opened).toHaveLength(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a blank title before opening anything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-'))
    const { ports, opened } = offline()
    try {
      for (const title of ['', '   ']) {
        const outcome = await submitFeedback(root, { title, description: 'something broke' }, 4_000_000, ports)
        expect(outcome.ok).toBe(false)
        expect(outcome.reason).toBe('title is required')
      }
      expect(opened).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('renders a deterministic body', () => {
    expect(renderFeedbackBody({ title: 'x', description: 'y', actual: 'z' })).toContain('**Actual:** z')
  })
})

describe('a report carries its deployment', () => {
  it('attaches the snapshot to the body and saves it beside the report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-'))
    const { ports } = offline()
    try {
      const outcome = await submitFeedback(root, { title: 'Source will not scan', description: 'The source card stays empty.' }, 1_000_000, {
        ...ports,
        diagnostics: async () => ({
          capturedAt: '2023-11-14T22:13:20.000Z',
          plugin: { version: '1.2.3', userRoot: '/tmp/user', dataRoot: root },
          host: { node: 'v22.0.0', platform: 'darwin', arch: 'arm64' },
          totals: { suites: 3, installed: 1, enabled: 1 },
          surfaces: ALL_SURFACES_ON,
          sources: [],
          problems: ['alpha: manifest is unreadable']
        })
      })
      expect(outcome.reportPath).toBeDefined()
      expect(outcome.issueText).toContain('## Deployment')
      expect(outcome.issueText).toContain('dsh-agent-plugins-market@1.2.3')
      expect(outcome.issueText).toContain('3 suite(s) discovered, 1 installed, 1 enabled')
      const saved = await readFile(outcome.reportPath!, 'utf8')
      expect(saved).toContain('alpha: manifest is unreadable')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports without a snapshot when diagnostics cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'feedback-'))
    const { ports } = offline()
    try {
      const outcome = await submitFeedback(root, { title: 'T', description: 'D' }, 1_000_000, {
        ...ports,
        diagnostics: async () => {
          throw new Error('catalog unavailable')
        }
      })
      expect(outcome.ok).toBe(true)
      expect(outcome.issueText).toContain('Diagnostics could not be collected')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
