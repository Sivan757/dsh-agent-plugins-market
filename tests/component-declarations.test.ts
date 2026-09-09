import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanSource } from '../src/catalog/suite-scanner.js'
import { PLUGIN_LAYOUTS } from '../src/model/layouts.js'
import { readCommands } from '../src/runtime/commands-mounts.js'
import { agentRoleCatalog } from '../src/runtime/agent-role-router.js'
import { suiteInstructions } from '../src/runtime/project-runtime.js'
import { HooksMountRegistry } from '../src/runtime/hooks-mounts.js'
import { discoverNativeProjectSuites } from '../src/catalog/native-project.js'

const roots: string[] = []
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'market-components-'))
  roots.push(path)
  return path
}
async function put(root: string, path: string, value: string | object) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
}
const skill = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n${name} body`
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('schema component declarations', () => {
  it('counts and mounts nested native resources through the same descriptor contract', async () => {
    const dir = await root()
    await put(dir, '.qoder/commands/git/review.md', 'Review changes')
    await put(dir, '.qoder/agents/team/reviewer.agent.md', '---\ndescription: Review code\n---\nReview')
    const [suite] = await discoverNativeProjectSuites(dir, 'project')
    expect(suite?.surfaces).toMatchObject({ commands: 1, agents: 1 })
    expect((await readCommands(suite!.root, suite?.resources?.commands))[0]?.name).toBe('git-review')
    const role = suite!.resources!.agents[0]!
    expect((await agentRoleCatalog([{ name: role.name, path: role.file, description: '', disabled: false }], new AbortController().signal))[0]).toMatchObject({
      name: 'team/reviewer.agent',
      description: 'Review code'
    })
  })
  it.each(PLUGIN_LAYOUTS.filter(layout => layout.kind !== 'agent-plugin-v1'))('$kind resolves custom resources into runtime commands and agents', async layout => {
    const dir = await root()
    await put(dir, layout.manifest, { name: 'declared', commands: ['./prompts'], agents: ['./roles/review.agent.md'], skills: ['./knowledge'] })
    await put(dir, 'prompts/nested/check.md', '---\ndescription: Check changes\n---\nCheck $ARGUMENTS')
    await put(dir, 'roles/review.agent.md', '---\ndescription: Review changes\n---\nReview')
    await put(dir, 'knowledge/check/SKILL.md', skill('check'))
    const [suite] = (await scanSource(dir, 'schema', 'user')).suites
    expect(suite?.errors).toEqual([])
    expect(suite?.skills[0]?.name).toBe('check')
    expect((await readCommands(dir, suite?.resources?.commands))[0]?.name).toBe('nested-check')
    const role = suite!.resources!.agents[0]!
    expect((await agentRoleCatalog([{ name: role.name, path: role.file, description: '', disabled: false }], new AbortController().signal))[0]).toMatchObject({
      name: 'review.agent',
      description: 'Review changes'
    })
  })
  it('Cursor uses schema-less mcp.json and declaration overrides, including arrays', async () => {
    const dir = await root()
    await put(dir, '.cursor-plugin/plugin.json', { name: 'cursor' })
    await put(dir, 'mcp.json', { mcpServers: { native: { command: 'native' } } })
    expect((await scanSource(dir, 's', 'user')).suites[0]?.surfaces.mcp).toBe(1)
    await put(dir, '.cursor-plugin/plugin.json', { name: 'cursor', mcpServers: ['./config/services.json', { remote: { url: 'https://example.test/mcp' } }], commands: './prompts' })
    await put(dir, 'config/services.json', { mcpServers: { custom: { command: 'custom' } } })
    await put(dir, 'prompts/explain.mdc', 'Explain code')
    const [suite] = (await scanSource(dir, 's', 'user')).suites
    expect(Object.keys(suite!.mcp!.servers)).toEqual(['custom', 'remote'])
    expect((await readCommands(dir, suite?.resources?.commands))[0]?.name).toBe('explain')
  })
  it('supports file LSP tables and inline commands without writing manifest content as Markdown', async () => {
    const dir = await root()
    await put(dir, '.qoder-plugin/plugin.json', {
      name: 'inline',
      commands: { review: { content: 'Review $ARGUMENTS', description: 'Review', argumentHint: 'target' } },
      lspServers: './language.json'
    })
    await put(dir, 'language.json', { lspServers: { ts: { command: 'typescript-language-server', extensionToLanguage: { '.ts': 'typescript' } } } })
    const [suite] = (await scanSource(dir, 's', 'user')).suites
    expect(suite?.lsp?.servers.ts?.command).toBe('typescript-language-server')
    expect((await readCommands(dir, suite?.resources?.commands))[0]).toMatchObject({ name: 'review', body: 'Review $ARGUMENTS', hint: 'target' })
  })
  it('resolves marketplace pluginRoot and entry-only declarations', async () => {
    const dir = await root()
    await put(dir, '.cursor-plugin/marketplace.json', {
      name: 'm',
      metadata: { pluginRoot: 'bundles' },
      plugins: [{ name: 'entry', source: 'entry', commands: './prompts', mcpServers: { remote: { url: 'https://example.test/mcp' } } }]
    })
    await put(dir, 'bundles/entry/prompts/explain.txt', 'Explain this code')
    const result = await scanSource(dir, 's', 'user')
    expect(result.suites[0]?.manifest.layout).toBe('cursor')
    expect(result.suites[0]?.surfaces).toMatchObject({ commands: 1, mcp: 1 })
    expect(result.marketplacePath).toBe(join(dir, '.cursor-plugin/marketplace.json'))
  })
  it('supports Kimi primary manifests, inline hooks, startup instructions and URL aliases', async () => {
    const dir = await root()
    await put(dir, 'kimi.plugin.json', {
      name: 'kimi',
      author: 'Author',
      systemPrompt: 'System',
      systemPromptPath: './SYSTEM.md',
      hooks: [{ event: 'SessionStart', command: 'echo start', timeout: 3 }]
    })
    await put(dir, 'SYSTEM.md', 'Additional system text')
    const [suite] = (await scanSource(dir, 's', 'user')).suites
    expect(suite?.manifest.author).toBe('Author')
    expect(suite?.surfaces.hooks).toBe(1)
    expect((await suiteInstructions([{ ...suite!, enabled: true }])).text).toBe('System\n\nAdditional system text')
    await put(dir, 'marketplace.json', { plugins: [{ id: 'remote', downloadUrl: 'https://example.test/repo.git' }] })
    expect((await scanSource(dir, 's', 'user')).suites[0]?.remote?.url).toBe('https://example.test/repo.git')
  })
  it('supports Codex api_marketplace.json and additive declared skills', async () => {
    const dir = await root()
    await put(dir, '.agents/plugins/api_marketplace.json', { name: 'm', plugins: [{ name: 'codex', source: '.' }] })
    await put(dir, '.codex-plugin/plugin.json', { name: 'codex', skills: './extra/custom.md' })
    await put(dir, 'skills/default/SKILL.md', skill('default'))
    await put(dir, 'extra/custom.md', skill('custom'))
    const result = await scanSource(dir, 's', 'user')
    expect(result.marketplacePath).toBe(join(dir, '.agents/plugins/api_marketplace.json'))
    expect(result.suites[0]?.skills.map(skill => skill.name).sort()).toEqual(['custom', 'default'])
  })
  it('rejects escaped paths and does not revive default hooks after invalid explicit declarations', async () => {
    const dir = await root()
    const outside = await root()
    await put(outside, 'secret.md', 'Not a component')
    await symlink(outside, join(dir, 'escape'))
    await put(dir, '.claude-plugin/plugin.json', { name: 'bad', commands: 'escape', hooks: './missing.json' })
    await put(dir, 'hooks/hooks.json', { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'must-not-run' }] }] } })
    const [suite] = (await scanSource(dir, 's', 'user')).suites
    expect(suite?.resources?.commands).toEqual([])
    expect(suite?.errors.join('\n')).toContain('symlink')
    let mounts = 0
    const registry = new HooksMountRegistry({
      plugin: () => {
        mounts++
        throw new Error('must not mount')
      }
    } as never)
    await registry.reconcile([{ ...suite!, enabled: true }])
    expect(mounts).toBe(0)
  })
})
