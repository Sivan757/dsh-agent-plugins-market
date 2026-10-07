/** Language chooses a target; only the resolved display preference enables translation. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { interfaceLanguageTranslates, resolveMarketSettings, resolveTranslationTarget } from '../src/contracts/settings.js'
import { bindHostLocale } from '../src/runtime/host/host-locale.js'
import { resetCircuitBreaker, type TranslationProvider } from '../src/application/translation/chain.js'

const locales = ['zh', 'zh-CN', 'zh-Hant', 'ja', 'en', 'en-US'] as const
const roots: string[] = []
const catalogs: Catalog[] = []
afterEach(async () => {
  for (const catalog of catalogs.splice(0)) {
    await catalog.settleDescriptions()
    catalog.dispose()
  }
  resetCircuitBreaker()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function hostRendersChinese(locale: string | undefined): boolean {
  return bindHostLocale(locale)('feedbackToolCardTitle') === bindHostLocale('zh')('feedbackToolCardTitle')
}

async function fixture(locale: string, stored: boolean | undefined) {
  const root = await mkdtemp(join(tmpdir(), 'translation-target-'))
  roots.push(root)
  const targets: string[] = []
  const provider: TranslationProvider = {
    id: 'microsoft',
    available: () => true,
    translate: async ({ texts, locale: target }) => {
      targets.push(target)
      return texts.map(text => (target === 'zh' ? '译文 ' + text : 'Translation ' + text))
    }
  }
  const catalog = new Catalog({
    userRoot: root,
    dataRoot: join(root, 'data'),
    agentsRoot: join(root, 'agents'),
    onChanged: () => {},
    ports: {
      localePreference: () => locale,
      translationProviders: [provider],
      translationProviderIdentity: () => 'test-chain',
      translationEnabled: () => resolveMarketSettings({ translationEnabled: stored }, locale).translationEnabled
    }
  })
  catalogs.push(catalog)
  await catalog.load()
  return { catalog, targets }
}

describe('translation target and display preference', () => {
  it.each(locales)('derives only the default from %s', locale => {
    const chinese = hostRendersChinese(locale)
    expect(interfaceLanguageTranslates(locale)).toBe(chinese)
    expect(resolveTranslationTarget(locale)).toBe(chinese ? 'zh' : 'en')
    expect(resolveMarketSettings({}, locale).translationEnabled).toBe(chinese)
    expect(resolveMarketSettings({ translationEnabled: true }, locale).translationEnabled).toBe(true)
    expect(resolveMarketSettings({ translationEnabled: false }, locale).translationEnabled).toBe(false)
  })

  it.each(['zh', 'en'] as const)('translates descriptions and documents into %s when explicitly on', async locale => {
    const { catalog, targets } = await fixture(locale, true)
    const source = locale === 'zh' ? 'Read files from disk' : '读取磁盘文件'
    const description = () => catalog.translateFields('skills', 'description', { description: source }, locale)
    const document = () => catalog.translateDocument('skills', 'document', source, locale)
    expect(description().pending).toBeGreaterThan(0)
    expect(document().pending).toBeGreaterThan(0)
    await catalog.settleDescriptions()
    expect(description().fields.translatedDescription).toBeDefined()
    expect(document().text).not.toBe(source)
    expect(targets.length).toBeGreaterThan(0)
    expect(targets.every(target => target === locale)).toBe(true)
  })

  it.each(['zh', 'en'] as const)('does not queue either surface under %s when explicitly off', async locale => {
    const { catalog, targets } = await fixture(locale, false)
    const source = locale === 'zh' ? 'Read files from disk' : '读取磁盘文件'
    expect(catalog.translateFields('skills', 'description', { description: source }, locale)).toEqual({ fields: {}, pending: 0 })
    expect(catalog.translateDocument('skills', 'document', source, locale)).toMatchObject({ text: source, pending: 0 })
    await catalog.settleDescriptions()
    expect(targets).toEqual([])
  })

  it('keeps an untouched English setting off without removing its target', async () => {
    const { catalog, targets } = await fixture('en', undefined)
    expect(resolveTranslationTarget('en')).toBe('en')
    expect(catalog.translateDocument('skills', 'doc', '读取磁盘文件', 'en').pending).toBe(0)
    await catalog.settleDescriptions()
    expect(targets).toEqual([])
  })
})
