import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { expandPluginPaths, pluginRootOf } from '../src/catalog/plugin-variables.js'
import { suiteDataDir } from '../src/catalog/paths.js'
import { scanSource } from '../src/catalog/suite-scanner.js'
import { discoverNativeProjectSuites } from '../src/catalog/native-project.js'
import { defaultMarkdownResources } from '../src/catalog/component-files.js'
import { expandLspServerConfig } from '../src/runtime/lsp-mounts.js'
import { CommandMountRegistry } from '../src/runtime/commands-mounts.js'
import { SuiteSkillProvider } from '../src/runtime/skills-provider.js'
import { agentRoleCatalog, readAgentRole } from '../src/runtime/agent-role-router.js'
import { suiteInstructions } from '../src/runtime/project-runtime.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'

const DATA_ROOT = '/data'
const PROJECT_DIR = '/project'

const roots: string[] = []
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'market-plugin-variables-'))
  roots.push(path)
  return path
}
async function put(dir: string, path: string, value: string | object): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), typeof value === 'string' ? value : JSON.stringify(value))
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

/** Capture every registered slash command so one handler can be invoked directly. */
function commandHost(agent: Record<string, unknown> = {}) {
  const registered: Array<{ name: string; handler: (invocation: { agent: unknown; rawInput: string }) => unknown }> = []
  const ctx = {
    // No optional service resolves here, so the template's placeholders stay literal.
    get: () => undefined,
    commands: {
      register: (definition: (typeof registered)[number]) => {
        registered.push(definition)
        return () => {
          registered.splice(registered.indexOf(definition), 1)
        }
      }
    }
  }
  return { ctx, registered, agent: { followup: () => {}, ...agent } }
}

/** Forward one registered command and return the text the model would receive. */
function forward(registered: Array<{ handler: (invocation: { agent: unknown; rawInput: string }) => unknown }>, agent: unknown, rawInput = ''): string {
  let text: string | undefined
  registered[0]?.handler({
    agent: { ...(agent as object), followup: (message: { content: Array<{ type: string; text: string }> }) => (text = message.content[0]?.text) },
    rawInput
  })
  if (text === undefined) throw new Error('expected the command handler to forward one follow-up')
  return text
}

/** One suite of the conventional Claude Code layout under its own temp root. */
async function claudeSuite(files: Record<string, string | object> = {}): Promise<{ dir: string; suite: Awaited<ReturnType<typeof scanSource>>['suites'][number] }> {
  const dir = await root()
  await put(dir, '.claude-plugin/plugin.json', { name: 'demo' })
  for (const [path, value] of Object.entries(files)) await put(dir, path, value)
  const [suite] = (await scanSource(dir, 's', 'user')).suites
  if (suite === undefined) throw new Error('expected the Claude Code layout to resolve to one suite')
  return { dir, suite }
}

describe('path variable expansion', () => {
  it('resolves every known spelling and leaves everything else as written', () => {
    const text = [
      '${PLUGIN_ROOT} ${CLAUDE_PLUGIN_ROOT} ${CODEX_PLUGIN_ROOT} ${ZCODE_PLUGIN_ROOT} ${QODER_PLUGIN_ROOT}',
      '${PLUGIN_DATA} ${CLAUDE_PLUGIN_DATA} ${ZCODE_PLUGIN_DATA} ${QODER_PLUGIN_DATA}',
      '${CLAUDE_SKILL_DIR}',
      '${CLAUDE_PROJECT_DIR} ${ZCODE_PROJECT_DIR} ${QODER_PROJECT_DIR}',
      '${HOME} ${NAME:-default} ${user_config.KEY} plain'
    ].join('\n')
    expect(expandPluginPaths(text, { root: '/suite', data: '/data/s', skillDir: '/suite/skills/x', projectDir: '/project' })).toBe(
      [
        '/suite /suite /suite /suite /suite',
        '/data/s /data/s /data/s /data/s',
        '/suite/skills/x',
        '/project /project /project',
        '${HOME} ${NAME:-default} ${user_config.KEY} plain'
      ].join('\n')
    )
  })

  it('keeps a variable verbatim when the calling layer holds no value for it', () => {
    expect(expandPluginPaths('${CLAUDE_PLUGIN_ROOT} ${CLAUDE_PLUGIN_DATA} ${CLAUDE_SKILL_DIR} ${CLAUDE_PROJECT_DIR}', { root: '/suite' })).toBe(
      '/suite ${CLAUDE_PLUGIN_DATA} ${CLAUDE_SKILL_DIR} ${CLAUDE_PROJECT_DIR}'
    )
  })

  it('reports no plugin root for a project-native directory', async () => {
    const dir = await root()
    await put(dir, '.qoder/commands/review.md', '---\ndescription: Review\n---\nReview')
    const [native] = await discoverNativeProjectSuites(dir, 'project')
    if (native === undefined) throw new Error('expected the qoder directory to resolve to one native suite')
    expect(pluginRootOf(native)).toBeUndefined()

    const { suite } = await claudeSuite()
    expect(pluginRootOf(suite)).toBe(suite.root)
  })
})

describe('suite text surfaces resolve their paths', () => {
  it('forwards a command template with root, data and project paths resolved', async () => {
    const { suite } = await claudeSuite({
      'commands/rescue.md':
        '---\ndescription: Rescue\n---\nnode "${CLAUDE_PLUGIN_ROOT}/scripts/rescue.mjs" --cache "${CLAUDE_PLUGIN_DATA}/cache" --root "${CLAUDE_PROJECT_DIR}" $ARGUMENTS'
    })
    const host = commandHost()
    const registry = new CommandMountRegistry(host.ctx as never, undefined, DATA_ROOT)
    await expect(registry.reconcile([withDefaultSurfaces({ ...suite, enabled: true })])).resolves.toEqual([])
    const data = suiteDataDir(DATA_ROOT, suite.sourceId, suite.id)
    expect(forward(host.registered, { session: { header: { cwd: PROJECT_DIR } } }, 'focus')).toBe(
      // The variable resolves to the suite root; the `/scripts/...` after it is
      // the author's text and stays exactly as written, on every platform.
      `node "${suite.root}/scripts/rescue.mjs" --cache "${data}/cache" --root "${PROJECT_DIR}" focus`
    )
    registry.disposeAll()
  })

  it('keeps the plugin variables verbatim in a project-native command file', async () => {
    const dir = await root()
    await put(dir, '.qoder/commands/review.md', '---\ndescription: Review\n---\nRun ${CLAUDE_PLUGIN_ROOT}/x $ARGUMENTS')
    const [native] = await discoverNativeProjectSuites(dir, 'project')
    if (native === undefined) throw new Error('expected the qoder directory to resolve to one native suite')
    const host = commandHost()
    const registry = new CommandMountRegistry(host.ctx as never, undefined, DATA_ROOT)
    await expect(registry.reconcile([withDefaultSurfaces(native)])).resolves.toEqual([])
    expect(forward(host.registered, { session: { header: { cwd: PROJECT_DIR } } })).toBe('Run ${CLAUDE_PLUGIN_ROOT}/x ')
    registry.disposeAll()
  })

  it('expands an agent card persona and its catalog description', async () => {
    const { suite } = await claudeSuite({
      'agents/rescue.md': '---\ndescription: Cache at ${CLAUDE_PLUGIN_DATA}/cache\n---\nRun node "${CLAUDE_PLUGIN_ROOT}/scripts/rescue.mjs" from ${CLAUDE_PROJECT_DIR}'
    })
    const resource = (await defaultMarkdownResources(suite.root, 'agents'))[0]
    if (resource === undefined) throw new Error('expected the agent file to resolve to one role')
    const data = suiteDataDir(DATA_ROOT, suite.sourceId, suite.id)
    const entry = { name: resource.name, path: resource.file, description: '', disabled: false, suiteRoot: suite.root, suiteData: data }

    const policy = await readAgentRole(entry, PROJECT_DIR)
    expect(policy.content).toContain(`${suite.root}/scripts/rescue.mjs`)
    expect(policy.content).toContain(PROJECT_DIR)
    const [summary] = await agentRoleCatalog([entry], new AbortController().signal, undefined, PROJECT_DIR)
    expect(summary?.description).toContain(`${data}/cache`)
  })

  it('resolves skill paths including the skill directory and the session project', async () => {
    const { suite } = await claudeSuite({
      'skills/greet/SKILL.md':
        '---\nname: greet\ndescription: Greet\n---\nRun ${CLAUDE_PLUGIN_ROOT}/greet.mjs in ${CLAUDE_SKILL_DIR}, cache ${CLAUDE_PLUGIN_DATA} for ${CLAUDE_PROJECT_DIR}'
    })
    const provider = new SuiteSkillProvider({ enabledUserSuites: async () => [withDefaultSurfaces({ ...suite, enabled: true })] } as never, { dataRoot: DATA_ROOT })
    const [candidate] = await provider.list({})
    if (candidate === undefined) throw new Error('expected the suite to list one skill')
    const content = (await provider.get(candidate, { cwd: PROJECT_DIR }))?.content ?? ''
    expect(content).toContain(`${suite.root}/greet.mjs`)
    // ${CLAUDE_SKILL_DIR} is a path the product builds itself, so it carries
    // the host's separators rather than the author's.
    expect(content).toContain(join(suite.root, 'skills', 'greet'))
    expect(content).toContain(suiteDataDir(DATA_ROOT, suite.sourceId, suite.id))
    expect(content).toContain(PROJECT_DIR)
  })

  it('expands declared startup instructions', async () => {
    const dir = await root()
    await put(dir, 'kimi.plugin.json', {
      name: 'kimi',
      systemPrompt: 'Root ${CLAUDE_PLUGIN_ROOT} data ${CLAUDE_PLUGIN_DATA}',
      systemPromptPath: './SYSTEM.md',
      sessionStart: { skill: 'boot' }
    })
    await put(dir, 'SYSTEM.md', 'Docs at ${CLAUDE_PLUGIN_ROOT}/docs for ${CLAUDE_PROJECT_DIR}')
    await put(dir, 'skills/boot/SKILL.md', '---\nname: boot\ndescription: Boot\n---\nRead ${CLAUDE_PLUGIN_ROOT}/GUIDE.md')
    const [suite] = (await scanSource(dir, 's', 'user')).suites
    if (suite === undefined) throw new Error('expected the Kimi manifest to resolve to one suite')
    const text = (await suiteInstructions([withDefaultSurfaces({ ...suite, enabled: true })], { dataRoot: DATA_ROOT, projectDir: PROJECT_DIR })).text
    const data = suiteDataDir(DATA_ROOT, suite.sourceId, suite.id)
    expect(text).toBe([`Root ${dir} data ${data}`, `Docs at ${dir}/docs for ${PROJECT_DIR}`, `Read ${dir}/GUIDE.md`].join('\n\n'))
  })

  it('resolves LSP declaration paths at mount time', () => {
    const config = {
      command: '${CLAUDE_PLUGIN_ROOT}/bin/server',
      args: ['--root', '${CLAUDE_PLUGIN_ROOT}', '${CLAUDE_PLUGIN_DATA}/cache'],
      env: { ROOT: '${PLUGIN_ROOT}' },
      extensionToLanguage: { '.ts': 'typescript' }
    }
    expect(expandLspServerConfig(config, { root: '/suite', data: '/data/s' })).toMatchObject({
      command: '/suite/bin/server',
      args: ['--root', '/suite', '/data/s/cache'],
      env: { ROOT: '/suite' }
    })
  })

  it('leaves the scanned LSP declaration as the author wrote it', async () => {
    const { suite } = await claudeSuite({
      '.lsp.json': { ts: { command: '${CLAUDE_PLUGIN_ROOT}/bin/server', args: ['--root', '${CLAUDE_PLUGIN_DATA}/cache'], extensionToLanguage: { '.ts': 'typescript' } } }
    })
    expect(suite.lsp?.servers['ts']?.command).toBe('${CLAUDE_PLUGIN_ROOT}/bin/server')
    expect(suite.lsp?.servers['ts']?.args).toEqual(['--root', '${CLAUDE_PLUGIN_DATA}/cache'])
  })
})
