import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { en, zh } from '../packages/market-ui/src/locales.js'

const labels = (language: 'zh' | 'en'): typeof zh | typeof en => (language === 'zh' ? zh : en)

describe('published Agent Plugins branding', () => {
  it('exports the localized brand title so the Installed card reads as the product names it', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; files: string[]; icon: string }
    expect(manifest.name).toBe('dsh-agent-plugins-market')
    expect(manifest.files).toContain('locale')
    expect(manifest.files).toContain('assets/dsh-agent-plugins.png')
    // The host renders meta.title as the card title; the npm name stays on the
    // package page, so the technical identity keeps exactly one home.
    for (const language of ['zh', 'en'] as const) {
      const resource = import.meta.resolve(`dsh-agent-plugins-market/locale/${language}.json`)
      const { meta } = JSON.parse(await readFile(fileURLToPath(resource), 'utf8')) as { meta: { title: string; description: string } }
      expect(meta.title).toBe(labels(language).nav)
      expect(meta.description).toBe(labels(language).marketCardDesc)
    }
  })

  it('ships a PNG icon inside the host metadata size limit', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; files: string[]; icon: string }
    expect(manifest.icon).toBe('./assets/dsh-agent-plugins.png')
    const file = new URL('../assets/dsh-agent-plugins.png', import.meta.url)
    expect((await stat(file)).size).toBeLessThanOrEqual(256 * 1024)
    const bytes = await readFile(file)
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(bytes.readUInt32BE(16)).toBe(256)
    expect(bytes.readUInt32BE(20)).toBe(256)
  })
})
