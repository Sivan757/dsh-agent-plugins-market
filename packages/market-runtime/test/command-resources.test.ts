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
