import { describe, expect, it } from 'vitest'
import { parseCommandResource, readCommands, type CommandParseIssue } from '../src/application/command-resources.js'

const resource = (name: string, content?: string) => ({ name, file: `/fixture/${name}.md`, ...(content === undefined ? {} : { content }) })

describe('command resource parsing', () => {
  it('reports invalid frontmatter instead of dropping the command silently', () => {
    const issues: CommandParseIssue[] = []
    const spec = parseCommandResource(resource('modernize'), '---\ndescription: Front door\nargument-hint: [system] [--source <path>]\n---\nBody', {
      onIssue: issue => issues.push(issue)
    })

    expect(spec).toBeUndefined()
    expect(issues).toHaveLength(1)
    expect(issues[0]?.resourceName).toBe('modernize')
    expect(issues[0]?.reason).toContain('invalid frontmatter')
  })

  it('keeps a valid command quiet', () => {
    const issues: CommandParseIssue[] = []
    const spec = parseCommandResource(resource('assess'), '---\ndescription: Assess\nargument-hint: <system>\n---\nBody', { onIssue: issue => issues.push(issue) })

    expect(spec).toMatchObject({ name: 'assess', description: 'Assess' })
    expect(issues).toEqual([])
  })

  it('does not report a disabled command as a parse issue', () => {
    const issues: CommandParseIssue[] = []
    expect(parseCommandResource(resource('off'), '---\ndescription: Off\ndisabled: true\n---\nBody', { onIssue: issue => issues.push(issue) })).toBeUndefined()
    expect(issues).toEqual([])
  })

  it('surfaces one issue per refused resource from readCommands', async () => {
    const issues: CommandParseIssue[] = []
    const specs = await readCommands(
      '/fixture',
      [
        { name: 'good', file: '/fixture/good.md', content: '---\ndescription: Good\n---\nBody' },
        { name: 'broken', file: '/fixture/broken.md', content: '---\ndescription: [\n---\nBody' }
      ],
      { onIssue: issue => issues.push(issue) }
    )

    expect(specs.map(spec => spec.name)).toEqual(['good'])
    expect(issues.map(issue => issue.resourceName)).toEqual(['broken'])
  })
})

describe('command argument declarations', () => {
  it('reads one space-separated declaration in order', () => {
    const spec = parseCommandResource(resource('harden'), '---\ndescription: Harden\narguments: system target_stack\n---\nHarden $system for $target_stack')
    expect(spec?.args).toEqual(['system', 'target_stack'])
  })

  it('reads a comma-separated declaration', () => {
    const spec = parseCommandResource(resource('review'), '---\ndescription: Review\narguments: system, scope\n---\nReview $system $scope')
    expect(spec?.args).toEqual(['system', 'scope'])
  })

  it('reads a YAML list', () => {
    const spec = parseCommandResource(resource('uplift'), '---\ndescription: Uplift\narguments:\n  - system\n  - source_version\n---\nUplift $system')
    expect(spec?.args).toEqual(['system', 'source_version'])
  })

  it('declares no argument when the frontmatter has none', () => {
    const spec = parseCommandResource(resource('plain'), '---\ndescription: Plain\n---\nBody')
    expect(spec?.args).toBeUndefined()
  })

  it('reports an unusable name and keeps the rest binding', () => {
    const issues: CommandParseIssue[] = []
    const spec = parseCommandResource(resource('typed'), '---\ndescription: Typed\narguments: system $target\n---\nBody', { onIssue: issue => issues.push(issue) })

    expect(spec?.args).toEqual(['system'])
    expect(issues).toHaveLength(1)
    expect(issues[0]?.reason).toContain('$target')
  })

  it('reports a name declared twice', () => {
    const issues: CommandParseIssue[] = []
    const spec = parseCommandResource(resource('twice'), '---\ndescription: Twice\narguments: system system\n---\nBody', { onIssue: issue => issues.push(issue) })

    expect(spec?.args).toEqual(['system'])
    expect(issues).toHaveLength(1)
    expect(issues[0]?.reason).toContain('more than once')
  })

  it('reports a declaration that is neither a string nor a list', () => {
    const issues: CommandParseIssue[] = []
    const spec = parseCommandResource(resource('numeric'), '---\ndescription: Numeric\narguments: 42\n---\nBody', { onIssue: issue => issues.push(issue) })

    expect(spec?.args).toBeUndefined()
    expect(issues).toHaveLength(1)
    expect(issues[0]?.reason).toContain('must be a string or a list')
  })
})
