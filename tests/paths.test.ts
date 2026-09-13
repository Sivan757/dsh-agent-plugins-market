/**
 * Containment has to answer the same question however each side was spelled.
 * The win32 rows drive `isWithinUnder` with `path.win32`, so the rules that once
 * rejected every local marketplace entry on Windows stay covered by a POSIX run
 * — `isWithin` itself reads the host's path rules and cannot reach them here.
 *
 * The home rows pin the harness helper's precedence: a configured path is read
 * back through the same platform rules it will be expanded with.
 */
import { homedir } from 'node:os'
import { join, posix, resolve, win32 } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expandHome, isWithin, isWithinUnder, resolveAgentsRoot, resolveDshHome } from '../src/catalog/paths.js'

const win32Cases: Array<{ name: string; root: string; candidate: string; contained: boolean }> = [
  {
    name: 'contains an entry resolved under a checkout configured with forward slashes',
    root: 'C:/Users/x/marketplace',
    candidate: 'C:\\Users\\x\\marketplace\\plugins\\typescript-lsp',
    contained: true
  },
  {
    name: 'ignores drive-letter and segment case',
    root: 'c:\\Users\\X\\marketplace',
    candidate: 'C:\\users\\x\\marketplace\\plugins\\a',
    contained: true
  },
  { name: 'contains the root itself', root: 'C:\\a\\b', candidate: 'C:\\a\\b', contained: true },
  {
    name: 'contains a child of a root spelled with a trailing separator',
    root: 'C:\\a\\b\\',
    candidate: 'C:\\a\\b\\c',
    contained: true
  },
  {
    name: 'rejects a sibling whose name merely starts with the root name',
    root: 'C:\\a\\b',
    candidate: 'C:\\a\\bc\\d',
    contained: false
  },
  { name: 'rejects a parent sibling', root: 'C:\\a\\b', candidate: 'C:\\a\\outside', contained: false },
  {
    name: 'resolves an unnormalized parent segment instead of trusting it as text',
    root: 'C:\\a\\b',
    candidate: 'C:\\a\\b\\..\\..\\outside',
    contained: false
  },
  { name: 'rejects a path on another drive', root: 'C:\\a', candidate: 'D:\\a\\b', contained: false }
]

const posixCases: Array<{ name: string; root: string; candidate: string; contained: boolean }> = [
  { name: 'contains a child', root: '/a/b', candidate: '/a/b/c', contained: true },
  { name: 'contains the root itself', root: '/a/b', candidate: '/a/b', contained: true },
  {
    name: 'rejects a sibling whose name merely starts with the root name',
    root: '/a/b',
    candidate: '/a/bc/d',
    contained: false
  },
  { name: 'rejects a parent', root: '/a/b', candidate: '/a', contained: false },
  {
    name: 'resolves an unnormalized parent segment instead of trusting it as text',
    root: '/a/b',
    candidate: '/a/b/../../outside',
    contained: false
  },
  {
    name: 'keeps a backslash an ordinary filename character, so /a/b\\c is a sibling',
    root: '/a/b',
    candidate: '/a/b\\c',
    contained: false
  }
]

describe('isWithinUnder: win32 rules', () => {
  it.each(win32Cases)('$name', ({ root, candidate, contained }) => {
    expect(isWithinUnder(win32, root, candidate)).toBe(contained)
  })
})

describe('isWithinUnder: posix rules', () => {
  it.each(posixCases)('$name', ({ root, candidate, contained }) => {
    expect(isWithinUnder(posix, root, candidate)).toBe(contained)
  })
})

describe('isWithin', () => {
  it('contains a joined child and rejects an escaping and a sibling path', () => {
    const root = resolve('root')
    expect(isWithin(root, join(root, 'child'))).toBe(true)
    expect(isWithin(root, root)).toBe(true)
    expect(isWithin(root, resolve(root, '..', 'outside'))).toBe(false)
    expect(isWithin(root, `${root}sibling`)).toBe(false)
  })
})

describe('home resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each([
    ['a bare tilde', '~', homedir()],
    ['a POSIX tilde prefix', '~/plugins', join(homedir(), 'plugins')],
    ['a Windows tilde prefix', '~\\plugins', join(homedir(), 'plugins')],
    ['an absolute path', '/opt/plugins', '/opt/plugins'],
    ['a relative path', 'plugins', 'plugins']
  ])('expands %s against the OS home', (_name, configured, expected) => {
    expect(expandHome(configured)).toBe(expected)
  })

  it('resolves the default harness home and a configured override', () => {
    vi.stubEnv('DSH_HOME', '/custom/home')
    expect(resolveDshHome()).toBe(resolve('/custom/home'))
  })

  it('treats a blank harness home as unset instead of the working directory', () => {
    vi.stubEnv('DSH_HOME', '   ')
    expect(resolveDshHome()).toBe(join(homedir(), '.dsh'))
  })

  it('treats a blank Agent layout root as unset and expands a configured one', () => {
    vi.stubEnv('DSH_AGENTS_HOME', '')
    expect(resolveAgentsRoot()).toBe(join(homedir(), '.agents'))
    vi.stubEnv('DSH_AGENTS_HOME', '~/agents-shared')
    expect(resolveAgentsRoot()).toBe(join(homedir(), 'agents-shared'))
  })
})
