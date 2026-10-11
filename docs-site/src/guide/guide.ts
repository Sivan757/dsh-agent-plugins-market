import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, posix } from 'node:path';

/**
 * Repository root, found by walking up from the working directory.
 *
 * The site is built from `docs-site` and reads the guide under `docs/user` at
 * the repository root. A path derived from `import.meta.url` would break once
 * Astro bundles this module into `dist/.prerender/`, so the lookup is explicit.
 */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(join(dir, 'docs', 'user', 'install.md'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('guide: cannot find docs/user/install.md above ' + process.cwd());
}

export const REPO_ROOT = findRepoRoot();

/** Where the rendered guide links back to source the site does not publish. */
export const REPO_BLOB = 'https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/';

/** Directory the guide collection reads, relative to the repository root. */
export const USER_DOCS = 'docs/user';

/**
 * Reading order, English page then its Chinese counterpart.
 *
 * The guide is one page per task, so a reader lands on the thing they came for.
 * The order is part of the documentation: `SECTIONS` below carries it onto the site.
 */
const NAV_ORDER = [
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
  'layout-coverage.zh.md',
];

/** Sections, in order, each naming the pages it groups. */
const SECTIONS = [
  { key: 'start', en: 'Get started', zh: '开始使用', pages: ['install'] },
  { key: 'content', en: 'Content', zh: '内容', pages: ['sources', 'resources'] },
  { key: 'capabilities', en: 'Capabilities', zh: '能力', pages: ['services', 'translation'] },
  { key: 'workspace', en: 'Workspace', zh: '工作区', pages: ['settings', 'workspace'] },
  { key: 'reference', en: 'Reference', zh: '参考', pages: ['agent-roles', 'layout-coverage'] },
];

export interface Guide {
  /** Collection id, which is the bare file name. */
  id: string;
  /** Route path: English at /docs/name/, Chinese at /docs/zh/name/. */
  slug: string;
  lang: 'en' | 'zh';
  title: string;
  /** Page name without its language suffix, which is how a section groups pages. */
  base: string;
  /** Route of the other language, when this page has a counterpart. */
  counterpart: string | undefined;
}

export interface GuideSection {
  key: string;
  label: string;
  guides: Guide[];
}

/** Page name without its markdown and language suffixes. */
export function guideBase(id: string): string {
  return id.replace(/\.md$/, '').replace(/\.zh$/, '');
}

/** Route path for one guide file: English at /docs/name/, Chinese at /docs/zh/name/. */
export function guideSlug(id: string): string {
  const name = id.replace(/\.md$/, '');
  return name.endsWith('.zh') ? 'zh/' + name.slice(0, -'.zh'.length) : name;
}

/** Language of one guide file. */
export function guideLang(id: string): 'en' | 'zh' {
  return id.endsWith('.zh.md') ? 'zh' : 'en';
}

/** Route of the same page in the other language, when one exists. */
export function guideCounterpart(id: string): string | undefined {
  const other = id.endsWith('.zh.md') ? id.slice(0, -'.zh.md'.length) + '.md' : id.slice(0, -'.md'.length) + '.zh.md';
  return NAV_ORDER.includes(other) ? guideSlug(other) : undefined;
}

/** First level-one heading, which is the page title in both languages. */
export function guideTitle(body: string, fallback: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

/** Every guide file, in reading order, with its title read from the file itself. */
export function readGuides(): Guide[] {
  return NAV_ORDER.map((id) => ({
    id,
    slug: guideSlug(id),
    lang: guideLang(id),
    title: guideTitle(readFileSync(join(REPO_ROOT, USER_DOCS, id), 'utf8'), id),
    base: guideBase(id),
    counterpart: guideCounterpart(id),
  }));
}

/** The guide grouped into sections, one list per language. */
export function readSections(lang: 'en' | 'zh'): GuideSection[] {
  const guides = readGuides().filter((g) => g.lang === lang);
  return SECTIONS.map((section) => ({
    key: section.key,
    label: lang === 'zh' ? section.zh : section.en,
    guides: section.pages.map((base) => guides.find((g) => g.base === base)).filter((g): g is Guide => g !== undefined),
  })).filter((section) => section.guides.length > 0);
}

/**
 * Rewrite one markdown link for the published site.
 *
 * A link that stays inside `docs/user/` becomes a site route, so the guide reads
 * as one document. Everything else (README, schemas, sources) points at the
 * repository on GitHub, because the site does not publish those files.
 */
export function rewriteHref(href: string, base: string): string {
  if (/^(?:https?:|mailto:|tel:|#|\/)/.test(href)) return href;

  const hashAt = href.indexOf('#');
  const pathPart = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  if (pathPart === '') return href;

  const fromRepoRoot = posix.normalize(posix.join(USER_DOCS, pathPart));
  if (fromRepoRoot.startsWith(USER_DOCS + '/')) {
    const name = fromRepoRoot.slice(USER_DOCS.length + 1);
    if (NAV_ORDER.includes(name)) return base + '/docs/' + guideSlug(name) + '/' + hash;
  }

  return REPO_BLOB + normalize(fromRepoRoot).split('\\').join('/') + hash;
}

/** Apply {@link rewriteHref} to every href in a rendered markdown document. */
export function rewriteLinks(html: string, base: string): string {
  return html.replace(/href="([^"]*)"/g, (_match, href: string) => 'href="' + rewriteHref(href, base) + '"');
}
