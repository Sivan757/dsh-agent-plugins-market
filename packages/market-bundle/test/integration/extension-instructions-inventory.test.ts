/**
 * The prompt layer the preset manager lists: an instruction file opens the chain
 * read that belongs to the session the row was listed for.
 *
 * The row's address carries the session id, because the chain is per session: a
 * read with no session answers for the user level only, so a project file's entry
 * id can never be found there. These cases pin the two halves of that contract:
 * a session read lists the project rows `readExtensionInventory` publishes, and
 * the published address names the session again so the dialog can find the row.
 */
import { describe, expect, it } from 'vitest'
import { readExtensionInventory } from '../../../../packages/market-bundle/src/application/extension-inventory.js'
import type { InstructionsPayload } from '../../../../packages/market-contracts/src/contracts/instructions.js'

/** One chain read with a project file and the user-level file beside it. */
const chain = (): InstructionsPayload => ({
  available: true,
  cwd: '/work/project',
  projectRoot: '/work/project',
  budget: 65536,
  maxSourceBytes: 1_048_576,
  total: 20,
  rows: [
    {
      scope: 'user-global',
      directory: '.',
      candidate: 'AGENTS.md',
      displayPath: '$DSH_HOME/AGENTS.md',
      path: '/home/.dsh/AGENTS.md',
      exists: true,
      status: 'loaded',
      size: 8,
      content: '# User\n'
    },
    {
      scope: 'project',
      directory: '.',
      candidate: 'AGENTS.md',
      displayPath: 'AGENTS.md',
      path: '/work/project/AGENTS.md',
      exists: true,
      status: 'loaded',
      size: 12,
      content: '# Project\n'
    }
  ],
  rendered: { text: '', omitted: [], truncated: [] }
})

const ports = {
  catalog: {
    overview: async () => ({ sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '/tmp', data: '/tmp' } }),
    mcpStatus: async () => ({
      entries: [],
      observedAt: '',
      totals: { all: 0, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
      directObservationOnly: false
    }),
    lspStatus: async () => ({ entries: [], totals: { all: 0, mounted: 0, failed: 0, blocked: 0, disabled: 0 }, hostMissing: false })
  },
  panels: {
    skills: { list: async () => [] },
    commands: { list: async () => [] },
    agents: { list: async () => [] }
  },
  instructions: async () => chain()
} as unknown as Parameters<typeof readExtensionInventory>[0]

describe('instruction files as preset rows', () => {
  it('publishes one read-only row per existing chain file, addressed by scope, directory and candidate', async () => {
    const rows = await readExtensionInventory(ports, { projectSuites: [], sessionId: 'session-1' })
    const files = rows.filter(row => row.face === 'instructions')
    expect(files.map(row => row.id)).toEqual(['instructions:user-global/./AGENTS.md', 'instructions:project/./AGENTS.md'])
    // A file is injected whenever it exists, so the row states that instead of
    // offering a switch the host does not have.
    for (const row of files) expect(row).toMatchObject({ globalEnabled: true, available: true, unavailableReason: 'instructions-no-switch' })
    expect(files.map(row => row.detail)).toEqual([
      { kind: 'instructions', entryId: 'user-global/./AGENTS.md', sessionId: 'session-1' },
      { kind: 'instructions', entryId: 'project/./AGENTS.md', sessionId: 'session-1' }
    ])
  })

  it('carries no session for a read that has none, so the dialog falls back to the user level', async () => {
    const rows = await readExtensionInventory(ports, { projectSuites: [] })
    const project = rows.find(row => row.id === 'instructions:project/./AGENTS.md')
    expect(project?.detail).toEqual({ kind: 'instructions', entryId: 'project/./AGENTS.md' })
  })
})
