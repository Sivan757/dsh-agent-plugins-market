import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('private domain workspace delivery', () => {
  it('declares cross-domain imports and forbids bare private runtime specifiers', async () => {
    const visit = async (directory: string): Promise<string[]> => {
      const entries = await readdir(directory, { withFileTypes: true })
      return (await Promise.all(entries.map(entry => (entry.isDirectory() ? visit(join(directory, entry.name)) : Promise.resolve([join(directory, entry.name)]))))).flat()
    }
    for (const directory of await readdir('packages')) {
      const manifest = JSON.parse(await readFile(join('packages', directory, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
      for (const file of (await visit(join('packages', directory, 'src'))).filter(file => /[.]tsx?$/.test(file))) {
        const source = await readFile(file, 'utf8')
        expect(source, file).not.toMatch(/(?:from\s*|import\s*[(]\s*)['"]@dsh-market[/]/)
        for (const match of source.matchAll(/(?:from\s*|import\s*[(]\s*)['"]([.][^'"]+)['"]/g)) {
          const target = normalize(join(dirname(file), match[1]!)).replaceAll('\\', '/')
          const owner = target.split('/')[1]
          if (!target.startsWith('packages/') || owner === directory) continue
          expect(manifest.dependencies?.['@dsh-market/' + owner!.slice('market-'.length)], file + ' -> ' + target).toBe('workspace:*')
        }
      }
    }
  })

  it('keeps one public package and eight private entry owners', async () => {
    const root = JSON.parse(await readFile('package.json', 'utf8')) as { name: string; exports: Record<string, unknown>; dependencies: Record<string, string> }
    expect(root.name).toBe('dsh-agent-plugins-market')
    expect(root.exports['.']).toEqual({ types: './lib/types/index.d.ts', default: './lib/index.js' })
    expect(root.exports['./client']).toBe('./client/client.js')
    expect(Object.keys(root.dependencies).some(name => name.startsWith('@dsh-market/'))).toBe(false)
    const directories = (await readdir('packages')).filter(name => name.startsWith('market-')).sort()
    expect(directories).toEqual(['market-bundle', 'market-catalog', 'market-contracts', 'market-lsp', 'market-mcp', 'market-runtime', 'market-translation', 'market-ui'])
    for (const directory of directories) {
      const manifest = JSON.parse(await readFile(join('packages', directory, 'package.json'), 'utf8')) as { private: boolean; exports: Record<string, string> }
      expect(manifest.private, directory).toBe(true)
      expect(manifest.exports['.'], directory).toBe('./src/index.ts')
      expect((await readFile(join('packages', directory, 'src/index.ts'), 'utf8')).length).toBeGreaterThan(0)
    }
  })

  it('keeps package graph acyclic and records every workspace dependency', async () => {
    const graph = new Map<string, string[]>()
    for (const directory of await readdir('packages')) {
      const manifest = JSON.parse(await readFile(join('packages', directory, 'package.json'), 'utf8')) as { name: string; dependencies?: Record<string, string> }
      graph.set(manifest.name, Object.keys(manifest.dependencies ?? {}))
      for (const version of Object.values(manifest.dependencies ?? {})) expect(version).toBe('workspace:*')
    }
    const visit = (name: string, chain: string[]): void => {
      expect(chain, name).not.toContain(name)
      expect(graph.has(name), name).toBe(true)
      for (const dependency of graph.get(name) ?? []) visit(dependency, [...chain, name])
    }
    for (const name of graph.keys()) visit(name, [])
  })
})
