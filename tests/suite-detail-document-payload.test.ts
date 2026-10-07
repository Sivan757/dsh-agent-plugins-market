/**
 * The suite detail payload carries a document's identity, never its bytes.
 *
 * A suite can ship many large commands and agents while the detail modal renders
 * one row per document: the payload names each one — the name its row shows and
 * the description beside it — and the text is read on demand when a reader opens
 * that row. This holds that line for a suite whose documents together are far
 * larger than any sane payload, and proves the on-demand read is whole rather
 * than the 64 KiB slice the payload used to ship.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSuiteDetail, readSuiteDocument } from '../packages/market-bundle/src/application/details.js'
import { discoverSuitesInSource } from '../packages/market-catalog/src/scanning/suite-scanner.js'
import { required } from './helpers/fixture.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'

const COMMAND_COUNT = 6
const AGENT_COUNT = 4
const COMMAND_BYTES = 120 * 1024
const AGENT_BYTES = 90 * 1024

/** One document of exactly `bytes` characters, ending in a marker only a whole read shows. */
function document(bytes: number, name: string): string {
  const frontmatter = `---\ndescription: the ${name} document\n---\n`
  const tail = `\nEND-OF-${name.toUpperCase()}\n`
  return `${frontmatter}${'x'.repeat(bytes - frontmatter.length - tail.length)}${tail}`
}

/** A discovered suite whose commands and agents are each far past the old payload cap. */
async function largeSuite(): Promise<{ root: string; suite: ReturnType<typeof withDefaultSurfaces> }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doc-payload-'))
  await mkdir(join(root, '.claude-plugin'), { recursive: true })
  await mkdir(join(root, 'commands'), { recursive: true })
  await mkdir(join(root, 'agents'), { recursive: true })
  await writeFile(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'large-suite', description: 'Many large documents' }))
  for (let index = 0; index < COMMAND_COUNT; index += 1) await writeFile(join(root, 'commands', `cmd-${index}.md`), document(COMMAND_BYTES, `cmd-${index}`))
  for (let index = 0; index < AGENT_COUNT; index += 1) await writeFile(join(root, 'agents', `agent-${index}.md`), document(AGENT_BYTES, `agent-${index}`))
  const suites = await discoverSuitesInSource(root, 'demo', 'user')
  return { root, suite: withDefaultSurfaces(required(suites[0], 'the generated suite to be discovered')) }
}

describe('suite detail: document identity on the wire, bodies on demand', () => {
  it('keeps every command and agent entry to its name and description', async () => {
    const { suite } = await largeSuite()
    const detail = await buildSuiteDetail(suite, undefined, [])

    expect(detail.commands).toHaveLength(COMMAND_COUNT)
    expect(detail.agents).toHaveLength(AGENT_COUNT)
    expect(detail.commands[0]).toEqual({ name: 'cmd-0', description: 'the cmd-0 document' })
    for (const entry of [...detail.commands, ...detail.agents]) {
      expect(Object.keys(entry).sort()).toEqual(['description', 'name'])
    }

    // The payload is bounded by how many documents a suite has, not by how large
    // they are: the same suite used to ship a 64 KiB slice of every one of them.
    const authored = COMMAND_COUNT * COMMAND_BYTES + AGENT_COUNT * AGENT_BYTES
    const payloadBytes = Buffer.byteLength(JSON.stringify(detail), 'utf8')
    expect(authored).toBeGreaterThan(1024 * 1024)
    expect(payloadBytes).toBeLessThan(8 * 1024)
  })

  it('reads a document whole on demand, past the point the payload used to cut it', async () => {
    const { root, suite } = await largeSuite()
    const text = await readSuiteDocument(suite, 'commands', 'cmd-5')

    expect(text).toHaveLength(COMMAND_BYTES)
    expect(text.length).toBeGreaterThan(64 * 1024)
    expect(text.endsWith('END-OF-CMD-5\n')).toBe(true)
    expect(text).toBe(await readFile(join(root, 'commands', 'cmd-5.md'), 'utf8'))
    await expect(readSuiteDocument(suite, 'agents', 'agent-9')).rejects.toThrow('no agents document named "agent-9"')
  })
})
