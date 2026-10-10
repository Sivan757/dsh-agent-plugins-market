/**
 * The three name folds and the `${NAME}` matcher read text from third-party
 * marketplace suites. Each used a pattern pair that re-scanned its own runs, so
 * CodeQL reported a polynomial regular expression on each one. They are now
 * single-pass folds; these cases pin both the observable behavior and the
 * adversarial shapes, which is what the patterns were reported for.
 */
import { describe, expect, it } from 'vitest'
import { parseSkillFrontmatter } from '../packages/market-catalog/src/scanning/skills-parse.js'
import { credentialRefsInServer } from '../packages/market-mcp/src/application/mcp/mcp-config.js'
import { mcpAuthRecordId } from '../packages/market-mcp/src/runtime/mcp/mcp-auth-record.js'

describe('name folds over text from a third-party suite', () => {
  it('folds a display skill name to kebab-case', () => {
    // The parser returns the frontmatter record or a rejection string, so the
    // helper reports whichever arrived.
    const nameOf = (name: string): string => {
      const parsed = parseSkillFrontmatter(`---\nname: ${JSON.stringify(name)}\ndescription: d\n---\n\nbody\n`, undefined)
      return typeof parsed === 'string' ? parsed : parsed.name
    }
    expect(nameOf('Presentations')).toBe('presentations')
    expect(nameOf('my skill')).toBe('my-skill')
    expect(nameOf('MiXeD  Case--Name')).toBe('mixed-case-name')
    // A run of separators collapses to one, and the ends lose theirs.
    expect(nameOf('--a--b--')).toBe('a-b')
    expect(nameOf('a___b')).toBe('a-b')
    // Nothing usable remains, so the skill is refused rather than named empty.
    expect(nameOf('---')).toBe('frontmatter name is missing or not kebab-case')
    expect(nameOf('   ')).toBe('frontmatter name is missing or not kebab-case')
  })

  it('keeps a literal dash in a credential-key segment but collapses other runs', () => {
    expect(mcpAuthRecordId('cloudflare__cloudflare-api')).toBe('cloudflare-cloudflare-api')
    expect(mcpAuthRecordId('a--b')).toBe('a--b')
    expect(mcpAuthRecordId('a_-b')).toBe('a--b')
    expect(mcpAuthRecordId('--a--')).toBe('a')
    expect(mcpAuthRecordId('___')).toBe('server')
  })

  it('folds a separator-only name in one pass', () => {
    // These are the shapes the reported patterns were quadratic on. A
    // reintroduced backtracking pattern makes this suite time out rather than
    // fail an assertion, which is the intended signal.
    const dashes = '-'.repeat(200_000)
    expect(mcpAuthRecordId(dashes)).toBe('server')
    expect(parseSkillFrontmatter(`---\nname: ${JSON.stringify(dashes)}\ndescription: d\n---\n\nbody\n`, undefined)).toBe('frontmatter name is missing or not kebab-case')
    const mixed = '-_. '.repeat(50_000)
    expect(mcpAuthRecordId(mixed)).toBe('server')
  })
})

describe('credential reference matching over text from a third-party suite', () => {
  const refs = (value: string): string[] => credentialRefsInServer({ type: 'streamable-http', url: `https://example.test/mcp?k=${value}` })

  it('reads a reference with and without a fallback', () => {
    expect(refs('${TOKEN}')).toEqual(['TOKEN'])
    expect(refs('${TOKEN:-literal}')).toEqual(['TOKEN'])
    expect(refs('${A}${B:-x}')).toEqual(['A', 'B'])
  })

  it('ignores the built-in path variables and non-references', () => {
    expect(refs('${PLUGIN_ROOT}/x')).toEqual([])
    expect(refs('${}')).toEqual([])
    expect(refs('${1A}')).toEqual([])
    expect(refs('$ TOKEN}')).toEqual([])
    expect(refs('${TAIL')).toEqual([])
  })

  it('scans a reference-only run in one pass', () => {
    const hostile = '${{A:-|'.repeat(50_000)
    const started = Date.now()
    expect(refs(hostile)).toEqual([])
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
