import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeLegacySeam, findLegacyLspSeams, migrateLegacyLspSeam } from '../src/application/lsp/profile-seam.js'
import { required } from './helpers/fixture.js'

/** A profile patch file shaped like the one the pre-self-provisioning docs told users to write. */
const LEGACY_PATCH = `# user patch layer
- insert:
    - id: hooks-claude-code
      name: '@deepseek-ai/dsh-hooks-claude-code'
      config:
        configPath: /home/u/.claude/settings.json
- id: compaction-basic
  disabled: false

# ── LSP（升级前手工添加） ────────────────
- insert:
    - id: lsp
      name: '@deepseek-ai/dsh-lsp'
    - id: tool-lsp
      name: '@deepseek-ai/dsh-tool-lsp'
      config:
        maxLocations: 100
        maxResultChars: 16000
- id: skill-filesystem
  disabled: false
`

/** Write one profile directory into a temporary Harness home. */
async function makeHome(profiles: Record<string, { patch?: string; manifest?: unknown }>): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'seam-'))
  await mkdir(join(home, 'profiles'), { recursive: true })
  // The installation fallback sibling must never be mistaken for a profile.
  await mkdir(join(home, 'profiles', 'node_modules'), { recursive: true })
  for (const [name, files] of Object.entries(profiles)) {
    const dir = join(home, 'profiles', name)
    await mkdir(dir, { recursive: true })
    if (files.patch !== undefined) await writeFile(join(dir, 'cordis.patch.yml'), files.patch, 'utf8')
    if (files.manifest !== undefined) await writeFile(join(dir, 'package.json'), JSON.stringify(files.manifest, undefined, 2), 'utf8')
  }
  return home
}

const LEGACY_MANIFEST = {
  name: 'dsh-profile-web',
  private: true,
  dependencies: { '@deepseek-ai/dsh-lsp': '0.1.2-rc.1', 'dsh-agent-plugins-market': 'link:/tmp/market' },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-agent-plugins-market'], patchReload: 'live' } }
}

describe('findLegacyLspSeams', () => {
  it('reports the profile, its seam rows, and its declared dependencies', async () => {
    const home = await makeHome({ web: { patch: LEGACY_PATCH, manifest: LEGACY_MANIFEST } })
    const seams = await findLegacyLspSeams(home)
    expect(seams).toHaveLength(1)
    const seam = required(seams[0], 'a legacy LSP seam')
    expect(seam.profile).toBe('web')
    expect(seam.rows).toEqual([
      { id: 'lsp', name: '@deepseek-ai/dsh-lsp' },
      { id: 'tool-lsp', name: '@deepseek-ai/dsh-tool-lsp' }
    ])
    expect(seam.dependencies).toEqual(['@deepseek-ai/dsh-lsp'])
    expect(seam.bundles).toEqual([])
    expect(seam.patchReload).toBe('live')
  })

  it('skips profiles whose dependencies are not backed by an insert row', async () => {
    const home = await makeHome({ web: { patch: '- id: skill-filesystem\n  disabled: false\n', manifest: LEGACY_MANIFEST } })
    expect(await findLegacyLspSeams(home)).toEqual([])
  })

  it('reports a profile that lists a seam package as a bundle layer', async () => {
    const home = await makeHome({
      web: { patch: '- id: skill-filesystem\n  disabled: false\n', manifest: { dsh: { profile: { bundles: ['@deepseek-ai/dsh-lsp'] } } } }
    })
    expect(required((await findLegacyLspSeams(home))[0], 'a legacy LSP seam').bundles).toEqual(['@deepseek-ai/dsh-lsp'])
  })

  it('treats an unparsable patch file as clean rather than failing the status surface', async () => {
    const home = await makeHome({ web: { patch: '- insert: [\n', manifest: LEGACY_MANIFEST } })
    expect(await findLegacyLspSeams(home)).toEqual([])
  })

  it('returns nothing when the Harness home has no profiles directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'seam-empty-'))
    expect(await findLegacyLspSeams(home)).toEqual([])
  })

  it('resolves the path with the platform separator, so Windows and POSIX both work', async () => {
    const home = await makeHome({ web: { patch: LEGACY_PATCH, manifest: LEGACY_MANIFEST } })
    const seam = required((await findLegacyLspSeams(home))[0], 'a legacy LSP seam')
    expect(seam.patchPath).toBe(join(home, 'profiles', 'web', 'cordis.patch.yml'))
    expect(seam.patchPath.endsWith(join('profiles', 'web', 'cordis.patch.yml'))).toBe(true)
  })
})

describe('migrateLegacyLspSeam', () => {
  it('removes the seam rows, keeps every other entry, and preserves comments', async () => {
    const home = await makeHome({ web: { patch: LEGACY_PATCH, manifest: LEGACY_MANIFEST } })
    const seam = required((await findLegacyLspSeams(home))[0], 'a legacy LSP seam')
    const result = await migrateLegacyLspSeam(seam, new Date(2026, 8, 13, 16, 30, 5))
    expect(result.removed).toEqual(seam.rows)
    expect(result.restartRequired).toBe(false)
    const written = await readFile(seam.patchPath, 'utf8')
    expect(written).not.toContain('@deepseek-ai/dsh-lsp')
    expect(written).not.toContain('@deepseek-ai/dsh-tool-lsp')
    // Everything unrelated survives, including the user's own comments.
    expect(written).toContain('# user patch layer')
    expect(written).toContain("name: '@deepseek-ai/dsh-hooks-claude-code'")
    expect(written).toContain('- id: compaction-basic')
    expect(written).toContain('- id: skill-filesystem')
    // The comment introducing the removed layer goes with it, and the emptied
    // `- insert:` entry leaves no `{}` stub behind.
    expect(written).not.toContain('- {}')
    expect(await findLegacyLspSeams(home)).toEqual([])
  })

  it('writes a timestamped backup beside the profile patch file and keeps its content', async () => {
    const home = await makeHome({ web: { patch: LEGACY_PATCH, manifest: LEGACY_MANIFEST } })
    const seam = required((await findLegacyLspSeams(home))[0], 'a legacy LSP seam')
    const result = await migrateLegacyLspSeam(seam, new Date(2026, 8, 13, 16, 30, 5))
    expect(result.backupPath).toBe(`${seam.patchPath}.bak-lsp-seam-20260913-163005`)
    // The stamp itself must stay filename-safe: Windows rejects ':' in a path
    // segment, and a `toLocaleString`-style timestamp would carry two of them.
    // Only the segment this code adds is checked — a Windows path legitimately
    // has a colon in its drive letter.
    expect(basename(result.backupPath)).not.toContain(':')
    expect(await readFile(result.backupPath, 'utf8')).toBe(LEGACY_PATCH)
    const siblings = await readdir(seam.dir)
    expect(siblings).toContain('cordis.patch.yml.bak-lsp-seam-20260913-163005')
  })

  it('keeps a group patch that also inserts, dropping only its seam entry', async () => {
    const patch = `- id: some-group
  insert:
    - id: lsp
      name: '@deepseek-ai/dsh-lsp'
    - id: keep-me
      name: dsh-something-else
`
    const home = await makeHome({ web: { patch } })
    const seam = required((await findLegacyLspSeams(home))[0], 'a legacy LSP seam')
    await migrateLegacyLspSeam(seam)
    const written = await readFile(seam.patchPath, 'utf8')
    expect(written).toContain('id: some-group')
    expect(written).toContain('id: keep-me')
    expect(written).not.toContain('@deepseek-ai/dsh-lsp')
  })

  it('flags a restart when the profile patch file is not hot-reloaded', async () => {
    const home = await makeHome({ web: { patch: LEGACY_PATCH, manifest: { dsh: { profile: { bundles: [], patchReload: 'startup' } } } } })
    const seam = required((await findLegacyLspSeams(home))[0], 'a legacy LSP seam')
    expect((await migrateLegacyLspSeam(seam)).restartRequired).toBe(true)
  })

  it('refuses to migrate an already-clean profile and writes nothing', async () => {
    const home = await makeHome({ web: { patch: '- id: skill-filesystem\n  disabled: false\n' } })
    const seam = {
      profile: 'web',
      dir: join(home, 'profiles', 'web'),
      patchPath: join(home, 'profiles', 'web', 'cordis.patch.yml'),
      rows: [],
      bundles: [],
      dependencies: [],
      patchReload: 'live' as const
    }
    await expect(migrateLegacyLspSeam(seam)).rejects.toThrow(/no longer registers an LSP layer/)
    expect(existsSync(`${seam.patchPath}.bak-lsp-seam`)).toBe(false)
  })
})

describe('describeLegacySeam', () => {
  it('names the profile, the rows, and the file to edit', async () => {
    const home = await makeHome({ web: { patch: LEGACY_PATCH, manifest: LEGACY_MANIFEST } })
    const text = describeLegacySeam(required((await findLegacyLspSeams(home))[0], 'a legacy LSP seam'))
    expect(text).toContain('profile "web"')
    expect(text).toContain('lsp (@deepseek-ai/dsh-lsp)')
    expect(text).toContain('tool-lsp (@deepseek-ai/dsh-tool-lsp)')
    expect(text).toContain(join('profiles', 'web', 'cordis.patch.yml'))
  })
})
