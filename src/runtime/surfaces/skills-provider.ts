/**
 * Skill provider feeding installed suites into `ctx.skills`.
 *
 * One provider serves both dimensions. Ranks sit between the shipped
 * filesystem roots so each dimension's own skills still win:
 * project suites (250) lose to the project's `.dsh/skills` (100) and
 * `.agents/skills` (200) but beat custom (300); user suites (450) lose to
 * the user's own `~/.dsh/skills` (400) and beat `~/.agents/skills` (500).
 *
 * Bodies are rewritten on load: the path variables Claude Code authors write
 * into skill prose (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`,
 * `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SKILL_DIR}`) are substituted, `` !`cmd` ``
 * dynamic-context placeholders run, and the resource base points at the skill
 * directory, so CC-authored skills work verbatim under the harness.
 */
import { readFile } from 'node:fs/promises'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillSource } from '@deepseek-ai/dsh-skill'
import type { Catalog } from '../../application/catalog.js'
import { parseSkillFrontmatter, stripFrontmatter } from '../../catalog/skills-parse.js'
import type { Suite, SuiteSkill } from '../../model/types.js'
import { parseFrontmatterRecord } from '../../application/panels/user-store.js'
import { expandPluginPaths, pluginRootOf } from '../../catalog/plugin-variables.js'
import { suiteDataDir } from '../../catalog/paths.js'
import { injectDynamicContext, type ShellSeam } from './dynamic-context.js'

export const SUITE_PROJECT_SOURCE = 'agent-plugin-project' satisfies SkillSource
export const SUITE_USER_SOURCE = 'agent-plugin-user' satisfies SkillSource
const PROJECT_RANK = 250
const USER_RANK = 450

interface SkillLocator {
  content?: string
  skillInstructions?: string
  file: string
  directory: string
  /** Absent for a project-native skill, whose directory carries no plugin root. */
  suiteRoot?: string
  /** The suite's `${PLUGIN_DATA}` directory; absent for a project-native skill. */
  data?: string
}

/** Runtime inputs the provider cannot read off one suite. */
export interface SuiteSkillProviderOptions {
  /** Plugin storage root holding each suite's data directory. */
  dataRoot?: string
  /** Resolves the live shell seam; absent keeps dynamic-context placeholders literal. */
  shell?: () => ShellSeam | undefined
  /** Whether one user-dimension suite may contribute skills here; absent allows all. */
  suiteAllowed?: (suite: Suite) => boolean
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

  constructor(
    private readonly manager: Catalog,
    private readonly options: SuiteSkillProviderOptions = {}
  ) {}

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

  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
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
    const authored = [stripFrontmatter(text), ...(locator.skillInstructions === undefined ? [] : [locator.skillInstructions])].join('\n\n')
    const withPaths = expandPluginPaths(authored, {
      ...(locator.suiteRoot === undefined ? {} : { root: locator.suiteRoot }),
      ...(locator.data === undefined ? {} : { data: locator.data }),
      skillDir: locator.directory,
      ...(options.cwd === undefined ? {} : { projectDir: options.cwd })
    })
    const shell = this.options.shell?.()
    const content =
      shell === undefined
        ? withPaths
        : await injectDynamicContext(withPaths, {
            shell,
            ...(options.cwd === undefined ? {} : { workdir: options.cwd }),
            ...(options.signal === undefined ? {} : { signal: options.signal })
          })
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
      // The author's description verbatim — the harness renders it into the
      // model's skill catalog, where a suite-name prefix is our packaging.
      description: entry.skill.description,
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
        ...(pluginRootOf(entry.suite) === undefined
          ? {}
          : {
              suiteRoot: entry.suite.root,
              ...(this.options.dataRoot === undefined ? {} : { data: suiteDataDir(this.options.dataRoot, entry.suite.sourceId, entry.suite.id) })
            })
      } satisfies SkillLocator,
      path: entry.skill.file,
      resourceBase: { kind: 'directory', path: entry.skill.directory }
    }
  }

  private async locate(cwd: string | undefined): Promise<LocatedSkill[]> {
    const located: LocatedSkill[] = []
    const userSuites = await this.manager.enabledUserSuites()
    for (const suite of userSuites) {
      if (this.options.suiteAllowed?.(suite) === false) continue
      for (const skill of suite.activeSurfaces.skills === false ? [] : suite.skills) {
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
      for (const skill of suite.activeSurfaces.skills === false ? [] : suite.skills) {
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

/**
 * A skill provider that answers nothing while the workspace's skills switch is
 * off.
 *
 * The wrapper is generic over the provider it guards, so both contributors to
 * the skills surface — installed suites and the user's own panel entries —
 * answer the one switch. Only the two data-carrying methods observe it and the
 * wrapped provider keeps its own name, so the provider seat survives a toggle
 * without re-registering.
 */
export class ToggledSkillProvider implements SkillProvider {
  constructor(
    private readonly inner: SkillProvider,
    private readonly allows: () => boolean
  ) {}

  get name(): string {
    return this.inner.name
  }

  list(options: Parameters<SkillProvider['list']>[0]): ReturnType<SkillProvider['list']> {
    return this.allows() ? this.inner.list(options) : Promise.resolve([])
  }

  get(...args: Parameters<SkillProvider['get']>): ReturnType<SkillProvider['get']> {
    return this.allows() ? this.inner.get(...args) : Promise.resolve(undefined)
  }
}

/**
 * A skill provider that drops the entries this workspace filtered off, while
 * the surface switch itself keeps flowing through {@link ToggledSkillProvider}.
 *
 * The filter answers by the resource-window entry id (`skills:${name}`), which
 * is the candidate name the harness would surface, so window and provider
 * agree on what one row names. `get` stays unfiltered: a candidate the list
 * never offered is never asked for, and keeping one code path for an explicit
 * name lookup preserves direct reads the window cannot influence.
 */
export class EntryFilteredSkillProvider implements SkillProvider {
  constructor(
    private readonly inner: SkillProvider,
    private readonly allowsEntry: (entryId: string) => boolean
  ) {}

  get name(): string {
    return this.inner.name
  }

  async list(options: Parameters<SkillProvider['list']>[0]): ReturnType<SkillProvider['list']> {
    const result = await this.inner.list(options)
    // The observation shape keeps its completeness flag: filtering only trims
    // which candidates are on offer, never whether discovery was authoritative.
    if (!('candidates' in result)) return result.filter(candidate => this.allowsEntry(`skills:${candidate.name}`))
    return { ...result, candidates: result.candidates.filter(candidate => this.allowsEntry(`skills:${candidate.name}`)) }
  }

  get(...args: Parameters<SkillProvider['get']>): ReturnType<SkillProvider['get']> {
    return this.inner.get(...args)
  }
}
