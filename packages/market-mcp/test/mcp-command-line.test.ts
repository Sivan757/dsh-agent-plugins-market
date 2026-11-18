import { describe, expect, it } from 'vitest'
import { splitCommandLine, withSplitCommand } from '../src/application/mcp/mcp-command-line.js'

describe('withSplitCommand', () => {
  it('splits the command line a README shows', () => {
    expect(withSplitCommand({ type: 'stdio', command: 'npx -y @modelcontextprotocol/server-filesystem .' })).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
    })
  })

  it('keeps quoted words whole', () => {
    expect(withSplitCommand({ type: 'stdio', command: 'npx -y "some package" .' })).toMatchObject({ command: 'npx', args: ['-y', 'some package', '.'] })
  })

  it('appends the arguments the definition already declared', () => {
    expect(withSplitCommand({ type: 'stdio', command: 'uvx mcp-server-git', args: ['--repository', '/repo'] })).toMatchObject({
      command: 'uvx',
      args: ['mcp-server-git', '--repository', '/repo']
    })
  })

  it('splits a quoted path that carries arguments', () => {
    expect(withSplitCommand({ type: 'stdio', command: '"C:\\Program Files\\app.exe" --port 1' })).toMatchObject({
      command: 'C:\\Program Files\\app.exe',
      args: ['--port', '1']
    })
  })

  it('leaves a single program alone', () => {
    const config = { type: 'stdio', command: 'node', args: ['server.js'] }
    expect(withSplitCommand(config)).toBe(config)
  })

  it('leaves a bare path that contains a space alone', () => {
    for (const command of ['/Applications/My App/Contents/MacOS/run', 'C:\\Program Files\\app.exe']) {
      const config = { type: 'stdio', command }
      expect(withSplitCommand(config)).toBe(config)
    }
  })

  it('leaves anything it cannot rewrite alone', () => {
    expect(withSplitCommand(undefined)).toBeUndefined()
    expect(withSplitCommand('npx -y x')).toBe('npx -y x')
    const remote = { type: 'streamable-http', url: 'https://example.com/mcp', command: 'npx -y x' }
    expect(withSplitCommand(remote)).toBe(remote)
    const badArgs = { type: 'stdio', command: 'npx -y x', args: 'oops' }
    expect(withSplitCommand(badArgs)).toBe(badArgs)
  })
})

describe('splitCommandLine', () => {
  it('reads quotes the way a shell would', () => {
    expect(splitCommandLine(`  payment-service "the old billing service" 'core module'  `)).toEqual(['payment-service', 'the old billing service', 'core module'])
    expect(splitCommandLine('a"b c"d')).toEqual(['ab cd'])
    expect(splitCommandLine('system ""')).toEqual(['system', ''])
    expect(splitCommandLine('system "still typing')).toEqual(['system', 'still typing'])
  })
})
