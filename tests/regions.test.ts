/**
 * Tests for the download-region routing: setting narrowing, locale-based
 * auto resolution, and the GitHub clone-URL rewrite (China mirror prefix,
 * env escape hatch, pass-through for everything else).
 */
import { describe, expect, it } from 'vitest'
import { githubCloneUrl, narrowDownloadRegion, resolveRegion } from '../src/runtime/regions.js'

describe('narrowDownloadRegion', () => {
  it('accepts the three known values and defaults everything else to auto', () => {
    expect(narrowDownloadRegion('auto')).toBe('auto')
    expect(narrowDownloadRegion('global')).toBe('global')
    expect(narrowDownloadRegion('china')).toBe('china')
    expect(narrowDownloadRegion('bogus')).toBe('auto')
    expect(narrowDownloadRegion(undefined)).toBe('auto')
    expect(narrowDownloadRegion(42)).toBe('auto')
  })
})

describe('resolveRegion', () => {
  it('an explicit choice wins over the language', () => {
    expect(resolveRegion('china', 'en')).toBe('china')
    expect(resolveRegion('global', 'zh-CN')).toBe('global')
  })

  it('auto follows the interface language', () => {
    expect(resolveRegion('auto', 'zh')).toBe('china')
    expect(resolveRegion('auto', 'zh-CN')).toBe('china')
    expect(resolveRegion('auto', 'en')).toBe('global')
    expect(resolveRegion('auto', undefined)).toBe('global')
  })
})

describe('githubCloneUrl', () => {
  const GITHUB = 'https://github.com/owner/repo'

  it('passes URLs through unchanged in the global region', () => {
    expect(githubCloneUrl('global', GITHUB)).toBe(GITHUB)
    expect(githubCloneUrl('global', 'https://gitlab.com/owner/repo')).toBe('https://gitlab.com/owner/repo')
  })

  it('wraps github.com clones in the China prefix proxy', () => {
    expect(githubCloneUrl('china', GITHUB)).toBe(`https://gh-proxy.com/${GITHUB}`)
    expect(githubCloneUrl('china', 'https://www.github.com/owner/repo')).toBe('https://gh-proxy.com/https://www.github.com/owner/repo')
  })

  it('leaves non-GitHub URLs and local paths alone in the China region', () => {
    expect(githubCloneUrl('china', 'https://gitlab.com/owner/repo')).toBe('https://gitlab.com/owner/repo')
    expect(githubCloneUrl('china', '/Users/me/local-suite')).toBe('/Users/me/local-suite')
    expect(githubCloneUrl('china', 'not a url')).toBe('not a url')
  })

  it('honors the DSH_MARKET_GITHUB_PROXY escape hatch', () => {
    const env = { DSH_MARKET_GITHUB_PROXY: 'https://my-proxy.example/' }
    expect(githubCloneUrl('china', GITHUB, env)).toBe('https://my-proxy.example/' + GITHUB)
    // The global region ignores the proxy: it routes direct.
    expect(githubCloneUrl('global', GITHUB, env)).toBe(GITHUB)
  })
})
