import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, posix } from 'node:path';

/**
 * Repository root, found by walking up from the working directory.
 *
 * The site is built from \`docs-site\` and reads the guide under \`docs/user\` at
 * the repository root. A path derived from \`import.meta.url\` would break once
 * Astro bundles this module into \`dist/.prerender/\`, so the lookup is explicit.
 */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(join(dir, 'docs', 'user', 'usage.md'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('guide: cannot find docs/user/usage.md above ' + process.cwd());
}

export const REPO_ROOT = findRepoRoot();

/** Where the rendered guide pages link back to source the site does not publish. */
export const REPO_BLOB = 'https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/';

/** Directory the guide collection reads, relative to the repository root. */
export const USER_DOCS = 'docs/user';

/** Reading order on the site. English first, each Chinese page beside its source. */
const NAV_ORDER = [
  'usage.md',
  'usage.zh.md',
  'agent-roles.md',
  'agent-roles.zh.md',
  'layout-coverage.md',
  'layout-coverage.zh.md',
];

export interface Guide {
  /** Collection id, which is the bare file name. */
  id: string;
  /** Route segment: the id without its `.md` suffix. */
  slug: string;
  lang: 'en' | 'zh';
  title: string;
  /** Route segment of the other language, when this page has a counterpart. */
  counterpart: string | undefined;
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

/** Route segment of the same page in the other language, when one exists. */
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
  return NAV_ORDER.map((id) => {
    const body = readFileSync(join(REPO_ROOT, USER_DOCS, id), 'utf8');
    return {
      id,
      slug: guideSlug(id),
      lang: guideLang(id),
      title: guideTitle(body, id),
      counterpart: guideCounterpart(id),
    };
  });
}

/**
 * Rewrite one markdown link for the published site.
 *
 * A link that stays inside `docs/user/` becomes a site route, so the guide
 * reads as one document. Everything else (README, schemas, sources) points at
 * the repository on GitHub, because the site does not publish those files.
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

  // A directory link keeps its trailing slash; a file link does not need one.
  return REPO_BLOB + normalize(fromRepoRoot).split('\\').join('/') + hash;
}

/** Apply {@link rewriteHref} to every href in a rendered markdown document. */
export function rewriteLinks(html: string, base: string): string {
  return html.replace(/href="([^"]*)"/g, (_match, href: string) => 'href="' + rewriteHref(href, base) + '"');
}
