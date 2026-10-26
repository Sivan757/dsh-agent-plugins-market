/**
 * Reading order for the guide, shared by the sidebar and the guide index.
 *
 * The guide is one page per task, shipped as an English/Chinese pair under
 * `docs/user/` and copied to `guide/` before the build. `SECTIONS` carries
 * the order onto the site; `check-guide.mjs` verifies the copy against it.
 */
export interface GuidePage {
  /** Page name without its language suffix. */
  base: string
  /** English title, read from the page's first level-one heading. */
  title: string
  /** Chinese title, same rule on the zh side. */
  titleZh: string
}

/**
 * Every guide file the site routes, in reading order: the English page then its
 * Chinese counterpart. check-guide.mjs verifies `docs/user/` against this list.
 */
export const GUIDES: string[] = [
  'install.md',
  'install.zh.md',
  'sources.md',
  'sources.zh.md',
  'resources.md',
  'resources.zh.md',
  'instructions.md',
  'instructions.zh.md',
  'output-styles.md',
  'output-styles.zh.md',
  'services.md',
  'services.zh.md',
  'translation.md',
  'translation.zh.md',
  'settings.md',
  'settings.zh.md',
  'workspace.md',
  'workspace.zh.md',
  'agent-roles.md',
  'agent-roles.zh.md',
  'layout-coverage.md',
  'layout-coverage.zh.md'
]

export interface GuideSection {
  key: string
  en: string
  zh: string
  pages: string[]
}

export const SECTIONS: GuideSection[] = [
  { key: 'start', en: 'Get started', zh: '开始使用', pages: ['install'] },
  { key: 'content', en: 'Content', zh: '内容', pages: ['sources', 'resources', 'instructions', 'output-styles'] },
  { key: 'capabilities', en: 'Capabilities', zh: '能力', pages: ['services', 'translation'] },
  { key: 'workspace', en: 'Workspace', zh: '工作区', pages: ['settings', 'workspace'] },
  { key: 'reference', en: 'Reference', zh: '参考', pages: ['agent-roles', 'layout-coverage'] }
]

/** Route of one guide page in one language, with the leading slash. */
export function guideRoute(base: string, lang: 'en' | 'zh'): string {
  return lang === 'zh' ? '/docs/zh/' + base + '.html' : '/docs/' + base + '.html'
}
