# Agent Note: The docs site is rebuilt on VitePress 2

Status: implemented

## Problem

The Astro 7 site needed three self-built mechanisms that a static-docs framework ships with: a link rewriter over rendered HTML, a dead-link checker over the build output, and a sitemap generator. Its templates also rendered guide titles by regex and its type check (`astro check`) read only the site's own files. Upstream, Astro 7 is a full web framework; the site is nine bilingual markdown pairs and four landing pages. The gap between the two is what the self-built code filled.

VitePress 2 publishes the same class of site with those mechanisms built in: dead internal links fail the build, sitemap generation is a config line, dark mode and search are theme features, and markdown is the authoring format it optimizes for.

## Decision

The site is a VitePress 2.0.0-alpha.20 root (`docs-site/.vitepress/config.mts`) with `srcDir: '.'`. The user asked for the 2.0 line, which is in alpha; the pin is exact, so a future alpha cannot break the build silently.

The decision in [The docs site renders the user guide instead of restating it](2026-10-11-docs-site-renders-the-user-guide.md) stands: `docs/user/` stays the single authoring source, pages ship as English/Chinese pairs with equal line counts, and each page carries its `**Guide:**` sibling line. This change replaces that note's rendering mechanism, not its decision.

The build is a five-step chain (`docs-site/package.json`):

1. `copy-guide.mjs` copies `docs/user/*.md` into `guide/`, rewriting each link: a guide-page target becomes a site route (`/docs/<name>`, `/docs/zh/<name>`), everything else becomes a `blob/main/` GitHub URL. The rewrite logic moved from a post-render HTML string pass into the copy step, where it operates on authored markdown and can fail loudly.
2. `vitepress build` renders the copies through the `rewrites` map in the config, which preserves the Astro-era URLs.
3. `directories.mjs` moves every emitted `<route>.html` into `<route>/index.html`. GitHub Pages resolves the trailing-slash URLs the READMEs deep-link only against that layout; `cleanUrls: true` makes internal links extensionless so they survive the move. `404.html` and the search-engine verification file stay flat, because both work only at the site root.
4. `generate-sitemap.mjs` writes `sitemap.xml` from the final output at trailing-slash URLs. VitePress's built-in sitemap derives from route records and emitted an `index.html`-suffixed set; deriving from the emitted files also keeps the verification file out.
5. `check-links.mjs` resolves every href in the output: routes and fragments against emitted files and ids.

The language switch is injected into the copied pages by `copy-guide.mjs` as static HTML after the first heading. The default theme's layout slots receive no page identity at prerender time in VitePress 2 (`useRoute()` is empty and `page.relativePath` is an empty string in SSG output), so a slot component cannot know which page it sits on. The switch's counterpart follows from the file name alone, so the copy step is the one place that knows it.

The guide index at `docs/index.md` reads its titles from the copied files with `import.meta.glob`, so the landing page cannot drift from what the guide pages show. `guide.ts` in `.vitepress/` carries `GUIDES` (the routing table, formerly `NAV_ORDER`) and `SECTIONS` (the sidebar groups), and `check-guide.mjs` reads both from that file.

The Astro sources (`src/`, `astro.config.mjs`) are deleted. `check:guide` gains a fifth assertion — the build copy must equal the rewritten source, so a stale copy cannot ship — and the GitHub Pages workflow steps shrink to `check:guide`, `build`, `check:links`.

## Alternatives considered

**Stay on Astro 7.** Rejected: it keeps the three self-built mechanisms as permanent maintenance, and the framework's weight buys nothing for a static site. The rewriter-over-rendered-HTML in particular could never validate a fragment, which is why `check-links.mjs` still exists.

**VitePress 1.6.4 (latest stable).** Rejected on the user's explicit instruction to use the 2.0 line. The alpha is pinned exactly, and the CI build pins nothing by time, so an upstream alpha release cannot enter the lockfile uninvited.

**Directory-style URLs via a server-side redirect.** Rejected: GitHub Pages offers no redirect configuration. The output must physically be `<route>/index.html`.

**Language switch as a theme slot component.** Rejected after two probes proved the SSG hole: the slot fired but every page-identity API was empty at prerender time, so the component rendered nothing in the shipped HTML. Static injection is testable by grep.

**Keep the Astro-era `astro check` step.** Rejected: it type-checked `.astro` templates, which no longer exist. The remaining TypeScript (`guide.ts`, config) is read by the root typecheck indirectly through VitePress's own build, and adding a second tsconfig for four files bought nothing.

## Consequences

The self-built surface shrinks by one script: the sitemap generator, the link rewriter (now part of the copy step), and Astro's template typing are gone; `directories.mjs` is new. Dark mode, code-copy buttons and the mobile nav are theme features the old site's CSS approximated by hand.

The guide pages now render through VitePress's markdown pipeline: heading anchors are generated with the same `<name>` slugs the Astro anchors used for English headings, and the Chinese anchors the READMEs deep-link (`#其他安装方式`, `#存储与发现`) survive verbatim. All fourteen README deep-link targets were resolved against the final output.

Fragments inside guide pages are now checked by `check-links.mjs` against the emitted ids, closing the validation gap the HTML string rewrite had.

The alpha pin is a standing cost: when VitePress 2 goes stable, the pin moves and the build is re-verified. `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` does not list `vitepress@2.0.0-alpha.20`, so pnpm's release-age window already treats it as one version among the declared range; the exact pin is what keeps upgrades deliberate.

`guide/` is gitignored build state, like `dist/`. `check-guide.mjs` fails with a clear message when it is missing, so a fresh clone must run the build chain before the check — the same ordering the scripts already encode.

## Testing

`pnpm --dir docs-site run check:guide` passes over 18 files in nine pairs, including the new in-sync assertion (a stale copy fails it).

`pnpm --dir docs-site run build` emits 23 pages plus `404.html` and the verification file: the flat-to-directory pass moves 21, keeps 2, and the sitemap lists 22 URLs at trailing-slash form. A clean build from a removed `dist/` was run before every verification round.

`pnpm --dir docs-site run check:links` passes: 25 pages, 541 internal links, 113 anchors, 142 asset references and 125 external links all resolve. Its fragment check was exercised by the README set, which includes two Chinese anchors.

All fourteen README deep-link targets (`README.md` and `README.zh.md`) were resolved against the emitted output by a temporary probe script; every target, including both Chinese anchors, exists.

The built site was served with `vitepress preview` and inspected in Chrome: the home hero and feature grid render, the sidebar groups and expands on guide pages, the injected language switch shows the current language and links to the counterpart, dark mode is the default, and code blocks carry the copy button. Screenshots confirmed each.

`pnpm --dir docs-site run typecheck` (`tsc --noEmit` over `guide.ts` and the config) passes.

## Related

Extends [The docs site renders the user guide instead of restating it](2026-10-11-docs-site-renders-the-user-guide.md), whose decision this note preserves and whose mechanism this note replaces.
