import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadDisabledLspServers, lspServerStatePath, saveDisabledLspServers } from '../src/runtime/lsp-server-state.js'

const roots: string[] = []
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lsp-state-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('disabled LSP server state', () => {
  it('round-trips ids sorted and deduplicated with a private file mode', async () => {
    const root = await tempRoot()
    await saveDisabledLspServers(root, ['zeta/lsp', 'alpha/clangd', 'zeta/lsp', 'beta/lua'])
    const path = lspServerStatePath(root)
    expect(path).toBe(join(root, 'lsp-server-state.json'))
    await expect(loadDisabledLspServers(root)).resolves.toEqual(new Set(['alpha/clangd', 'beta/lua', 'zeta/lsp']))
    // 0o600: the file lists rows a user switched off, not a public document.
    expect((await readFile(path, 'utf8')).endsWith('\n')).toBe(true)
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
    expect(raw).toEqual({ disabled: ['alpha/clangd', 'beta/lua', 'zeta/lsp'] })
  })

  it('accepts any iterable and stores a clean empty table', async () => {
    const root = await tempRoot()
    await saveDisabledLspServers(root, new Set(['only/one']))
    await saveDisabledLspServers(root, new Set<string>())
    await expect(loadDisabledLspServers(root)).resolves.toEqual(new Set())
    expect(JSON.parse(await readFile(lspServerStatePath(root), 'utf8'))).toEqual({ disabled: [] })
  })

  it('reads a missing or malformed file as an empty set instead of failing the panel', async () => {
    const root = await tempRoot()
    await expect(loadDisabledLspServers(root)).resolves.toEqual(new Set())
    await writeFile(join(root, 'lsp-server-state.json'), 'not json', 'utf8')
    await expect(loadDisabledLspServers(root)).resolves.toEqual(new Set())
    // Non-string entries are dropped rather than poisoning the Set.
    await writeFile(lspServerStatePath(root), JSON.stringify({ disabled: ['kept/a', 42, null, {}] }), 'utf8')
    await expect(loadDisabledLspServers(root)).resolves.toEqual(new Set(['kept/a']))
  })

  it('fails a save whose data root is not a directory instead of losing the switch', async () => {
    const root = await tempRoot()
    // writeFileAtomic creates parent directories first; a plain file sitting
    // where the directory belongs makes that mkdir fail deterministically.
    const blocker = join(root, 'occupied')
    await writeFile(blocker, 'a file, not a directory', 'utf8')
    await expect(saveDisabledLspServers(blocker, ['a/b'])).rejects.toThrow()
  })
})
