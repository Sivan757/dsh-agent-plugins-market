/**
 * A document's translation: split for the provider's request budget, cached per
 * chunk, and assembled back into one body the reader can render as a whole.
 */
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTranslationProviders } from '../packages/market-translation/src/runtime/host/translation-providers.js'
import { Catalog } from '../packages/market-bundle/src/application/catalog.js'
import { createPanelResources } from '../packages/market-runtime/src/application/panel-resources.js'
import { createUserPanelStores } from '../packages/market-runtime/src/runtime/panels/user-panels.js'
import { resetCircuitBreaker, type TranslationProvider } from '../packages/market-translation/src/application/translation/chain.js'

const fixture = join(process.cwd(), 'tests', 'fixtures', 'v1-suite')
const roots: string[] = []

afterEach(async () => {
  resetCircuitBreaker()
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A provider that records every batch and prefixes each text, so a translation is unmistakable. */
function recorder(): { provider: TranslationProvider; batches: string[][] } {
  const batches: string[][] = []
  return {
    batches,
    provider: {
      id: 'microsoft',
      available: () => true,
      translate: async ({ texts }) => {
        batches.push([...texts])
        return texts.map(text => 'ZH:' + text)
      }
    }
  }
}

/** One installed suite fixture, with the locale and provider chain a case needs. */
async function seededCatalog(options: { provider?: TranslationProvider; locale?: string } = {}): Promise<{ catalog: Catalog; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'market-document-i18n-'))
  roots.push(root)
  const source = join(root, '.sources', 'active')
  await mkdir(source, { recursive: true })
  await cp(fixture, source, { recursive: true })
  await writeFile(
    join(root, 'state.json'),
    JSON.stringify({
      version: 1,
      sources: [{ id: 'active', url: source, local: true }],
      installed: { 'active/v1-suite': { enabled: true, installedAt: new Date(0).toISOString() } }
    })
  )
  const catalog = new Catalog({
    userRoot: root,
    dataRoot: join(root, 'data'),
    agentsRoot: join(root, 'agents'),
    onChanged: () => {},
    ports: {
      localePreference: () => options.locale ?? 'zh',
      ...(options.provider === undefined ? {} : { translationProviders: [options.provider], translationProviderIdentity: () => 'test-chain' })
    }
  })
  await catalog.load()
  return { catalog, root }
}

/** A body with enough prose to need more than one chunk, and no trailing newline. */
function longBody(): string {
  return Array.from({ length: 10 }, (_, index) => `Paragraph ${String(index)} ` + 'of a document that is long enough to travel in chunks.'.repeat(4)).join('\n\n')
}

describe('Catalog.translateDocument', () => {
  it('accepts the Microsoft article-omission response through masking cache and AST reconstruction', async () => {
    const sent: string[][] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      if (typeof init.body !== 'string') throw new Error('expected a JSON request body')
      sent.push(JSON.parse(init.body) as string[])
      return new Response(JSON.stringify([{ translations: [{ text: '⟦D1⟧flow⟦D2⟧是技能的路径。' }] }]), { status: 200 })
    })
    const provider = createTranslationProviders({ host: {} })[1]!
    const { catalog } = await seededCatalog({ provider })
    const body = 'A **flow** is a path through the skill.'
    expect(catalog.translateDocument('skills', 'article-omission', body, 'zh').pending).toBe(1)
    expect(await catalog.settleDescriptions(5000)).toBe(true)
    const translated = catalog.translateDocument('skills', 'article-omission', body, 'zh')
    expect(translated.pending).toBe(0)
    expect(translated.text).toBe('**flow**是技能的路径。')
    expect(translated.bilingualText).toContain(body)
    expect(translated.bilingualText).toContain('**flow**是技能的路径。')
    expect(sent).toEqual([['A ⟦D1⟧flow⟦D2⟧ is a path through the skill.']])
    await catalog.settleDescriptions(5000)
    expect(sent).toHaveLength(1)
    catalog.dispose()
  })

  it('reuses unchanged paragraphs after another paragraph is inserted before them', async () => {
    const { provider, batches } = recorder()
    const { catalog } = await seededCatalog({ provider })
    const paragraphs = Array.from({ length: 8 }, (_, index) => 'Paragraph ' + index + ' ' + 'word '.repeat(72))
    const body = paragraphs.join('\n\n')
    catalog.translateDocument('skills', 'stable', body, 'zh')
    await catalog.settleDescriptions(5000)
    batches.length = 0
    catalog.translateDocument('skills', 'stable', 'New note.\n\n' + body, 'zh')
    await catalog.settleDescriptions(5000)
    expect(batches.flat()).toEqual(['New note.'])
  })
  it('answers with the authored body and reports every chunk it queued', async () => {
    const { provider } = recorder()
    const { catalog } = await seededCatalog({ provider })
    const body = longBody()
    const first = catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh')
    // The caller renders immediately: nothing here waits on a provider.
    expect(first.text).toBe(body)
    expect(first.pending).toBeGreaterThan(1)
  })

  it('assembles the translated body from its chunks, in order, once they land', async () => {
    const { provider } = recorder()
    const { catalog } = await seededCatalog({ provider })
    const body = longBody()
    const queued = catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh').pending
    expect(await catalog.settleDescriptions(5_000)).toBe(true)
    const settled = catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh')
    expect(settled.pending).toBe(0)
    // One mark per chunk and the authored body underneath them: a chunk left
    // in English, dropped, or assembled out of order fails both halves.
    expect(settled.text.split('ZH:').length - 1).toBe(queued)
    expect(settled.text.replace(/ZH:/g, '')).toBe(body)
    expect(queued).toBeGreaterThan(1)
  })

  it('keeps the authored body byte for byte when a fence sits inside a list item', async () => {
    const { provider } = recorder()
    const { catalog } = await seededCatalog({ provider })
    // Reproduced from a real marketplace document: the author wrote a single
    // newline between the list text and the fence, and the fence is indented far
    // enough to be part of the list item. Reassembly used to join chunks with a
    // blank line, which inserts structure the author never wrote — the item goes
    // loose and the code block moves out of the `<li>`.
    const body = [
      '**Install from a local clone:**',
      '',
      '1. Clone the repository:',
      '   ```bash',
      '   git clone https://example.test/agent-skills',
      '   ```',
      '2. Then run it.'
    ].join('\n')
    const first = catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh')
    expect(first.text).toBe(body)
    expect(first.pending).toBeGreaterThan(0)

    await catalog.settleDescriptions(5_000)
    const settled = catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh')
    expect(settled.pending).toBe(0)
    // Translated chunks in place, authored structure untouched.
    expect(settled.text.replace(/ZH:/g, '')).toBe(body)
    expect(settled.text).toContain('1. ZH:Clone the repository:\n   ```bash')
  })

  it('keeps a trailing newline the authored body carries', async () => {
    const { provider } = recorder()
    const { catalog } = await seededCatalog({ provider })
    const body = '# Title\n\nOne paragraph.\n'
    const first = catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh')
    expect(first.text).toBe(body)
    await catalog.settleDescriptions(5_000)
    expect(catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh').text.replace(/ZH:/g, '')).toBe(body)
  })

  it('queues an English paragraph that quotes Chinese, instead of reporting settled', async () => {
    const { provider } = recorder()
    const { catalog } = await seededCatalog({ provider })
    // One incidental Han character used to decline the whole chunk — and a
    // declined chunk reports nothing pending, so the section showed the authored
    // English with no note while the document was half translated.
    const body = 'The report shows 中文 labels beside every row and keeps the file names as authored.'
    const first = catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh')
    expect(first.pending).toBe(1)
    await catalog.settleDescriptions(5_000)
    const settled = catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh')
    expect(settled.pending).toBe(0)
    expect(settled.text).toBe('ZH:' + body)
  })

  it('reports nothing pending for a body that is already Chinese', async () => {
    const { provider, batches } = recorder()
    const { catalog } = await seededCatalog({ provider })
    // The honest half of the same rule: this text is written in the language the
    // reader asked for, so declining it is not a hidden gap.
    const body = '读取文件，然后按回车键继续。'
    expect(catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh')).toEqual({ text: body, bilingualText: body, pending: 0 })
    await catalog.settleDescriptions(200)
    expect(batches).toEqual([])
  })

  it('answers a body with no text at all with the body itself', async () => {
    const { provider } = recorder()
    const { catalog } = await seededCatalog({ provider })
    expect(catalog.translateDocument('skills', 'active/v1-suite/greet', '\n\n', 'zh')).toEqual({ text: '\n\n', bilingualText: '\n\n', pending: 0 })
  })

  it('pays for a chunk once: a second read is answered from the cache', async () => {
    const { provider, batches } = recorder()
    const { catalog } = await seededCatalog({ provider })
    const body = longBody()
    catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh')
    await catalog.settleDescriptions(5_000)
    const callsAfterFirstRead = batches.length
    expect(callsAfterFirstRead).toBeGreaterThan(0)
    expect(catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh').pending).toBe(0)
    await catalog.settleDescriptions(5_000)
    expect(batches.length).toBe(callsAfterFirstRead)
  })

  it('never sends a fenced code block, and keeps it verbatim in the translated body', async () => {
    const { provider, batches } = recorder()
    const { catalog } = await seededCatalog({ provider })
    const body = ['Prose before.', '', '```bash', 'npm run build -- --flag', '```', '', 'Prose after.'].join('\n')
    catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh')
    await catalog.settleDescriptions(5_000)
    // The example is what the reader copies; a provider asked to translate it
    // answers with code that no longer runs.
    for (const batch of batches) {
      for (const text of batch) expect(text).not.toContain('npm run build')
    }
    const settled = catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh')
    expect(settled.text).toContain('```bash\nnpm run build -- --flag\n```')
    expect(settled.text).toContain('ZH:Prose before.')
    expect(settled.text).toContain('ZH:Prose after.')
  })

  it('translates nothing, and queues nothing, under an interface language the documents are already in', async () => {
    const { provider, batches } = recorder()
    const { catalog } = await seededCatalog({ provider, locale: 'en' })
    const body = longBody()
    expect(catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'en')).toEqual({ text: body, bilingualText: body, pending: 0 })
    await catalog.settleDescriptions(5_000)
    expect(batches).toEqual([])
  })

  it('queues nothing at all when the deployment has no provider chain', async () => {
    const { catalog } = await seededCatalog()
    const body = longBody()
    expect(catalog.translateDocument('skills', 'active/v1-suite/greet', body, 'zh')).toEqual({ text: body, bilingualText: body, pending: 0 })
  })
})

describe('PanelResourceStore.translateDocument', () => {
  it('propagates actual description pending status on both detail read paths', async () => {
    const { provider } = recorder()
    const { catalog, root } = await seededCatalog({ provider })
    const users = createUserPanelStores(root)
    await users.skills.create('pending', '---\nname: pending\ndescription: Pending description\n---\nBody')
    const panels = createPanelResources(catalog, users)
    expect((await panels.skills.get('pending'))?.translationPending).toBe(1)
    expect((await catalog.suiteDetail('active', 'v1-suite')).translationPending).toBeGreaterThan(0)
    await catalog.settleDescriptions(5000)
    expect((await panels.skills.get('pending'))?.translationPending ?? 0).toBe(0)
    expect((await catalog.suiteDetail('active', 'v1-suite')).translationPending ?? 0).toBe(0)
  })

  it('reads the named entry itself and translates its body without the frontmatter', async () => {
    const { provider, batches } = recorder()
    const { catalog, root } = await seededCatalog({ provider })
    const panels = createPanelResources(catalog, createUserPanelStores(root))
    const entry = (await panels.skills.list()).find(row => row.origin === 'plugin')
    if (entry === undefined) throw new Error('expected the fixture skill row')
    const id = entry.id ?? entry.name
    const first = await panels.skills.translateDocument(id)
    expect(first.pending).toBe(2)
    await catalog.settleDescriptions(5_000)
    const settled = await panels.skills.translateDocument(id)
    expect(settled.pending).toBe(0)
    expect(settled.text.startsWith('# ZH:Greet')).toBe(true)
    // Frontmatter is metadata the overview block already shows, and a provider
    // asked to translate YAML answers with YAML that no longer parses.
    expect(settled.text).not.toContain('name: greet')
    for (const batch of batches) {
      for (const text of batch) expect(text).not.toContain('name: greet')
    }
  })

  it('rejects an entry that does not exist', async () => {
    const { catalog, root } = await seededCatalog({ provider: recorder().provider })
    const panels = createPanelResources(catalog, createUserPanelStores(root))
    await expect(panels.skills.translateDocument('nobody')).rejects.toThrow('no entry named')
  })
})
