/**
 * Skill provider feeding installed suites into `ctx.skills`.
 *
 * One provider serves both dimensions. Ranks sit between the shipped
 * filesystem roots so each dimension's own skills still win:
 * project suites (250) lose to the project's `.dsh/skills` (100) and
 * `.agents/skills` (200) but beat custom (300); user suites (450) lose to
 * the user's own `~/.dsh/skills` (400) and beat `~/.agents/skills` (500).
 *
 * Bodies are rewritten on load: `${CLAUDE_PLUGIN_ROOT}` (which Claude Code
 * authors write into skill prose) is substituted with the suite root, and the
 * resource base points at the skill directory, so CC-authored skills work
 * verbatim under the harness.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillSource } from '@deepseek-ai/dsh-skill'
import type { Catalog } from '../application/catalog.js'
import { parseSkillFrontmatter, stripFrontmatter } from '../catalog/skills-parse.js'
import type { Suite, SuiteSkill } from '../model/types.js'

export const SUITE_PROJECT_SOURCE = 'agent-plugin-project' satisfies SkillSource
export const SUITE_USER_SOURCE = 'agent-plugin-user' satisfies SkillSource
const PROJECT_RANK = 250
const USER_RANK = 450

interface SkillLocator {
  file: string
  directory: string
  suiteRoot: string
  /** 'skill' for SKILL.md, 'agent' for a Claude Code agent definition. */
  kind: 'skill' | 'agent'
}

interface LocatedSkill {
  rank: number
  source: SkillSource
  suite: Suite
  skill: SuiteSkill
}

export class SuiteSkillProvider implements SkillProvider {
  readonly name = 'agent-plugin'

  constructor(private readonly manager: Catalog) {}

  async list(options: SkillLookupOptions): Promise<SkillCandidate[]> {
    const located = await this.locate(options.cwd)
    located.sort((a, b) => a.rank - b.rank || a.suite.id.localeCompare(b.suite.id) || a.skill.name.localeCompare(b.skill.name))
    // Dedupe by skill name across dimensions: the sort above puts project
    // suites (250) ahead of user suites (450), so a project's own skill
    // always wins over an installed suite shipping a skill of the same name.
    const seen = new Set<string>()
    const unique: LocatedSkill[] = []
    for (const entry of located) {
      if (seen.has(entry.skill.name)) continue
      seen.add(entry.skill.name)
      unique.push(entry)
    }
    return unique.map(entry => this.candidateFor(entry))
  }

  /** Parse `agents/*.md` of one suite into agent-definition candidates. */
  private async agentsOf(suite: Suite): Promise<LocatedSkill[]> {
    const dir = join(suite.root, 'agents')
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return []
    }
    const located: LocatedSkill[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const file = join(dir, entry)
      try {
        const info = await stat(file)
        if (!info.isFile()) continue
      } catch {
        continue
      }
      const agentName = entry.slice(0, -3)
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch {
        continue
      }
      const parsed = parseSkillFrontmatter(text, agentName)
      const description = typeof parsed === 'string' ? (suite.manifest.description ?? agentName) : parsed.description
      const skill: SuiteSkill = {
        name: `agent-${agentName}`,
        directory: dir,
        file,
        description,
        ...(typeof parsed !== 'string' && parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
        invocation: typeof parsed === 'string' ? { modelInvocable: true, userInvocable: false } : parsed.invocation
      }
      located.push({
        rank: suite.dimension === 'project' ? PROJECT_RANK : USER_RANK,
        source: suite.dimension === 'project' ? SUITE_PROJECT_SOURCE : SUITE_USER_SOURCE,
        suite,
        skill
      })
    }
    return located
  }

  async get(candidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as SkillLocator
    let text: string
    try {
      text = await readFile(locator.file, 'utf8')
    } catch {
      return undefined
    }
    if (locator.kind === 'agent') {
      const suiteName = locator.suiteRoot.split(/[\\/]/).at(-1) ?? 'suite'
      const content = [
        `## 子代理定义（来自 Agent Plugins ${suiteName}，Claude Code agents 格式）`,
        '',
        '当任务匹配下方描述时，通过 subagent 工具创建子代理并将「定义正文」原样作为指令执行。',
        '',
        '```markdown',
        text,
        '```'
      ].join('\n')
      return {
        name: candidate.name,
        description: candidate.description,
        invocation: candidate.invocation,
        source: candidate.source,
        provider: this.name,
        resourceBase: { kind: 'directory', path: locator.directory },
        path: locator.file,
        content
      }
    }
    const parsed = parseSkillFrontmatter(text, candidate.name)
    if (typeof parsed === 'string') return undefined
    const content = stripFrontmatter(text).replaceAll('${CLAUDE_PLUGIN_ROOT}', locator.suiteRoot)
    return {
      name: parsed.name,
      description: candidate.description,
      ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
      invocation: parsed.invocation,
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: locator.file,
      content
    }
  }

  private candidateFor(entry: LocatedSkill): SkillCandidate {
    return {
      name: entry.skill.name,
      description: `[${entry.suite.manifest.name}] ${entry.skill.description}`,
      ...(entry.skill.whenToUse === undefined ? {} : { whenToUse: entry.skill.whenToUse }),
      invocation: entry.skill.invocation,
      source: entry.source,
      provider: this.name,
      rank: entry.rank,
      locator: {
        file: entry.skill.file,
        directory: entry.skill.directory,
        suiteRoot: entry.suite.root,
        kind: entry.skill.name.startsWith('agent-') ? 'agent' : 'skill'
      } satisfies SkillLocator,
      path: entry.skill.file,
      resourceBase: { kind: 'directory', path: entry.skill.directory }
    }
  }

  private async locate(cwd: string | undefined): Promise<LocatedSkill[]> {
    const located: LocatedSkill[] = []
    const userSuites = await this.manager.enabledUserSuites()
    for (const suite of userSuites) {
      for (const skill of suite.skills) {
        located.push({ rank: USER_RANK, source: SUITE_USER_SOURCE, suite, skill })
      }
      located.push(...(await this.agentsOf(suite)))
    }
    if (cwd !== undefined) {
      located.push(...(await this.locateProject(cwd)))
    }
    return located
  }

  private async locateProject(cwd: string): Promise<LocatedSkill[]> {
    const snapshot = await this.manager.readProjectCatalog(cwd)
    const located: LocatedSkill[] = []
    for (const suite of snapshot.enabledSuites) {
      for (const skill of suite.skills) {
        located.push({ rank: PROJECT_RANK, source: SUITE_PROJECT_SOURCE, suite, skill })
      }
    }
    return located
  }
}
