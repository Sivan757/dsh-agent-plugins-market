/**
 * Link rewriting for the copied guide pages.
 *
 * The guide under docs/user/ is authored for the GitHub view: pages link each
 * other by bare file name and reach repository-root files with ../ paths. The
 * published site serves the pages under rewritten routes and does not publish
 * repository-root files at all, so copy-guide.mjs applies this rewrite to the
 * build copies. The repository source stays untouched, and check-guide.mjs
 * recomputes the rewrite to prove the shipped copy is fresh.
 */

/** Every guide page name, shared with .vitepress/guide.ts GUIDES. */
const GUIDE_PAGES = new Set([
  'install.md',
  'install.zh.md',
  'sources.md',
  'sources.zh.md',
  'resources.md',
  'resources.zh.md',
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
])

/** Where a link that leaves the guide lands: the repository view on GitHub. */
const REPO_BLOB = 'https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/'

/** Route of one guide page name: English at /docs/<name>, Chinese at /docs/zh/<name>. */
function guideRoute(name) {
  const base = name.replace(/\.md$/, '')
  return base.endsWith('.zh') ? '/docs/zh/' + base.slice(0, -3) : '/docs/' + base
}

/**
 * Rewrite one markdown link target for the published site.
 *
 * A target that names a guide page becomes a site route. Everything else
 * (README, schemas, sources, tests) points at the repository on GitHub,
 * because the site does not publish those files.
 */
export function rewriteHref(href) {
  if (/^(?:https?:|mailto:|tel:|#|\/)/.test(href)) return href

  const hashAt = href.indexOf('#')
  const pathPart = hashAt === -1 ? href : href.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : href.slice(hashAt)
  if (pathPart === '') return href

  const name = pathPart.replace(/^\.\//, '')
  if (GUIDE_PAGES.has(name)) return guideRoute(name) + hash

  const repoPath = pathPart
    .split('/')
    .reduce(
      (acc, part) => {
        if (part === '..') acc.pop()
        else if (part !== '.') acc.push(part)
        return acc
      },
      ['docs', 'user']
    )
    .join('/')

  return REPO_BLOB + repoPath + hash
}

/**
 * Language switch block for one copied guide page.
 *
 * The default theme's layout slots receive no page identity at prerender
 * time in VitePress 2, so a component cannot know which page it sits on.
 * The switch is therefore injected into the copy as static HTML: the
 * counterpart route follows from the file name alone.
 */
function switchBlock(name) {
  const isZh = name.endsWith('.zh.md')
  const base = name.replace(/\.md$/, '').replace(/\.zh$/, '')
  const other = withBasePrefix(isZh ? '/docs/' + base + '/' : '/docs/zh/' + base + '/')
  return [
    '<div class="guideLang">',
    '<span class="label">Language</span>',
    '<ul>',
    isZh
      ? '<li><a href="' + other + '">English</a></li><li><span class="current">简体中文</span></li>'
      : '<li><span class="current">English</span></li><li><a href="' + other + '">简体中文</a></li>',
    '</ul>',
    '</div>',
    ''
  ].join('\n')
}

/** Site-absolute counterpart link with the deployed base path. */
function withBasePrefix(route) {
  return '/dsh-agent-plugins-market' + route
}

/** Apply {@link rewriteHref} to every inline markdown link, then inject the language switch. */
export function rewriteGuideSource(markdown, name) {
  const rewritten = markdown.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (match, bang, text, href) => bang + '[' + text + '](' + rewriteHref(href) + ')')
  const h1 = rewritten.match(/^#\s+.*$/m)
  if (h1 === null || h1.index === undefined) return rewritten + '\n' + switchBlock(name)
  const at = h1.index + h1[0].length
  return rewritten.slice(0, at) + '\n\n' + switchBlock(name) + rewritten.slice(at)
}
