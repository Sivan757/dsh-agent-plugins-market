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
import { readFile } from 'node:fs/promises'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillSource } from '@deepseek-ai/dsh-skill'
import type { Catalog } from '../application/catalog.js'
import { parseSkillFrontmatter, stripFrontmatter } from '../catalog/skills-parse.js'
import type { Suite, SuiteSkill } from '../model/types.js'
import { parseFrontmatterRecord } from './user-store.js'
import { PLUGIN_ROOT_VARIABLES } from '../model/layouts.js'

export const SUITE_PROJECT_SOURCE = 'agent-plugin-project' satisfies SkillSource
export const SUITE_USER_SOURCE = 'agent-plugin-user' satisfies SkillSource
const PROJECT_RANK = 250
const USER_RANK = 450

interface SkillLocator {
  content?: string
  skillInstructions?: string
  file: string
  directory: string
  suiteRoot: string
}

interface LocatedSkill {
  content?: string
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

  async get(candidate: SkillCandidate, _options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as SkillLocator
    let text: string
    try {
      text = locator.content ?? (await readFile(locator.file, 'utf8'))
    } catch {
      return undefined
    }
    try {
      if (parseFrontmatterRecord(text).disabled === true) return undefined
    } catch {
      return undefined
    }
    const parsed = parseSkillFrontmatter(text, candidate.name)
    if (typeof parsed === 'string') return undefined
    const content = [stripFrontmatter(text), ...(locator.skillInstructions === undefined ? [] : [locator.skillInstructions])]
      .join('\n\n')
      .replace(/\$\{([A-Z_]+)\}/g, (match, name: string) => (PLUGIN_ROOT_VARIABLES.has(name) ? locator.suiteRoot : match))
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
        ...(entry.content === undefined ? {} : { content: entry.content }),
        ...(entry.suite.manifest.skillInstructions === undefined ? {} : { skillInstructions: entry.suite.manifest.skillInstructions }),
        file: entry.skill.file,
        directory: entry.skill.directory,
        suiteRoot: entry.suite.root
      } satisfies SkillLocator,
      path: entry.skill.file,
      resourceBase: { kind: 'directory', path: entry.skill.directory }
    }
  }

  private async locate(cwd: string | undefined): Promise<LocatedSkill[]> {
    const located: LocatedSkill[] = []
    const userSuites = await this.manager.enabledUserSuites()
    for (const suite of userSuites) {
      for (const skill of suite.activeSurfaces?.skills === false ? [] : suite.skills) {
        try {
          if (parseFrontmatterRecord(await readFile(skill.file, 'utf8')).disabled === true) continue
        } catch {
          continue
        }
        located.push({ rank: USER_RANK, source: SUITE_USER_SOURCE, suite, skill })
      }
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
      for (const skill of suite.activeSurfaces?.skills === false ? [] : suite.skills) {
        try {
          if (parseFrontmatterRecord(await readFile(skill.file, 'utf8')).disabled === true) continue
        } catch {
          continue
        }
        located.push({ rank: PROJECT_RANK, source: SUITE_PROJECT_SOURCE, suite, skill })
      }
    }
    return located
  }
}
