# Agent Note: The docs site renders the user guide instead of restating it

Status: implemented

## Problem

The site under `docs-site/` shipped four pages: a home page, an install guide, a compatible-plugins reference and an FAQ. Every page that needed user-guide detail linked out to `github.com` with a `blob/main/docs/user/usage.md` URL, so a reader who arrived at the site left it to read the guide. The site was a landing page wearing a documentation site's address.

The guide itself was one 223-line page per language (`docs/user/usage.md`, `docs/user/usage.zh.md`) covering installation, sources, storage, MCP, LSP, hooks, translation, settings and the operation overlay: a reader looking for one answer scrolled past nine unrelated topics, and could not link to one of them except by an anchor inside a very long page. Two further paired pages, `agent-roles` and `layout-coverage`, were also GitHub-only from the site.

## Decision

The site renders the guide files. A content collection (`docs-site/src/content.config.ts`) globs `../docs/user`, and `docs-site/src/pages/docs/[...slug].astro` renders each entry. The repository stays the single source: an edit under `docs/user/` updates the GitHub view and the published site together, with no second copy to drift.

Routes come from the source file name, not from the collection id. The glob loader slugifies `entry.id` and drops the dot (`usage.zh` becomes `usagezh`), so `guideSlug` reads `entry.filePath` instead. English pages sit at `/docs/<name>/` and Chinese pages at `/docs/zh/<name>/`, which also gives the language switch a real target: each guide page links to its counterpart beside it.

Links survive the move. A rendered guide keeps its authored markdown links, and `rewriteLinks` maps each one: a target that stays inside `docs/user/` becomes a site route, everything else (README, `schemas/`, sources, tests) becomes a `blob/main/` URL on GitHub. The site does not publish those files, so it must not pretend to.

The repository root is resolved by walking up from the working directory until `docs/user/usage.md` exists. A path derived from `import.meta.url` breaks once Astro bundles the module into `dist/.prerender/`, which the first build proved. The helper lives at `docs-site/src/guide/guide.ts`, deliberately not under a `lib/` directory: see [Consequences](#consequences).

**The guide becomes one page per task.** The 223-line pair splits into seven pairs: `install`, `sources`, `resources`, `services`, `translation`, `settings` and `workspace`. Each page owns one subject, so a reader lands on the thing they came for and can link to it. Sections that were children of the old page's parts (`Project layouts`, `MCP configuration`, `Hooks and LSP`, `Resource detail editing`) become top-level sections of the page that now owns them, and the reading order lives in the guide library: `NAV_ORDER` lists the pages, `SECTIONS` groups them into `Get started`, `Content`, `Capabilities`, `Workspace` and `Reference`.

The split is mechanical, not a rewrite: a script sliced the old file by line range and re-emitted the text verbatim. Two changes are deliberate. The old line 9 restated what the `Project layouts` section already covers in full, so it is dropped as a duplicate and its one unique clause moves onto the sentence that owns that fact. The container headings `## Format details and development` and `## 格式细节与开发` dissolve with the container.

Each page carries a `**Guide:**` line of sibling links, because the site sidebar does not exist on GitHub: without it the sequence of pages would be invisible in the repository view.

The site adds one guide index at `/docs/`, a sectioned sidebar, a language switch, and a `User guide` entry in the shared navigation. The existing pages stop linking to GitHub for guide detail.

`docs-pages.yml` now watches `docs/user/**` as well as `docs-site/**`. Before this change a guide edit did not rebuild the deployed site, and the site linked the guide by absolute GitHub URL precisely because of it.

## Alternatives considered

**Copy the guide into `docs-site/` as Astro pages.** Rejected: two copies of a bilingual 223-line page drift, and the repository rule that `docs/user/` pages ship as one edit would stop being the whole story. The site would also stop proving that what it publishes is what the repository ships.

**Publish the guide as a separate Astro content directory that the build syncs from `docs/user/`.** Rejected: a sync step is a second source of truth with a window where it is stale, and it needs its own test. The loader reads the repository files directly.

**Install `@astrojs/markdown-remark` to run a rehype plugin for link rewriting.** Rejected as unnecessary. Astro 7 renders content collections with its own processor, and the rendered HTML carries plain `href` attributes that a targeted string rewrite handles with no new dependency. A new dependency would need the justification the repository's rules ask for, and this one buys nothing.

**Keep the site's GitHub links and add the guide as one long page.** Rejected: the sidebar, the language switch and the per-page head metadata are what make the guide navigable from the site. One 223-line page per language reads as a dump, and the reader cannot link to a section of it. This is also why the page later split by task rather than staying whole.

**Add a full-text search index.** Deferred, not rejected. The site is 23 static pages and a sectioned sidebar covers them; search needs a client-side index and a decision about where it is built. Nothing in this change forecloses it.

**Keep the guide as one page and split it later.** Rejected: the split is what makes the pages linkable, and doing it in the same change keeps one review of the content move instead of two.

## Consequences

The site is now the complete user documentation rather than an entrance to it: 23 pages, of which 18 are the guide (nine bilingual pairs). `docs/user/` edits publish on the next push to `main`, and the guide pages carry the same navigation as the rest of the site.

Splitting one page into seven creates a new silent failure: a file that is not in `NAV_ORDER` renders nowhere and reports nothing. `docs-site/scripts/check-guide.mjs` closes it. It compares the files on disk against the library and fails when a page is unrouted, ungrouped, nameless in `SECTIONS`, missing its counterpart, unequal in line count against that counterpart, or missing its `**Guide:**` line. It also fails when `NAV_ORDER` names a file that does not exist, so a typo cannot reach the build.

Link rewriting is the fragile part. It is a string rewrite over rendered HTML, not a link graph, so it cannot tell a link it should rewrite from one it should leave alone. A new link target outside `docs/user/` is rewritten to a GitHub URL automatically, so a wrong target shows as a 404 on GitHub rather than a broken site route.

`docs-site/scripts/check-links.mjs` guards that. It reads the build output, resolves every internal route, fragment and asset reference against the emitted files and ids, and fails on a relative link that should have been rewritten. `docs-pages.yml` runs it after the build, so a broken link cannot deploy. The check was verified in both directions: 132 internal links, 6 anchors and 11 asset references resolve on the current content, and injected faults (a missing page, a missing fragment, a relative path and an unrewritten markdown link) each fail the run with exit code 1.

The guide keeps its bilingual parity rule from [docs/AGENTS.md](../../docs/AGENTS.md): one English and one Chinese file, edited together, same line count. The rule applies per pair, so it survives the split: each of the seven new pairs has identical line counts, as do the two existing pairs. The site renders the pair and links them to each other, so a missing counterpart is visible as a missing language switch.

This note extends [Consumer-first documentation tiers](2026-10-10-consumer-first-documentation-tiers.md), which moved compatibility reference onto the site and made the site the full documentation entrance. That note's decision stands; this one makes the site render the guide rather than link out to it.

## The ignore rules that swallowed a source file

The root `.gitignore` carried a bare `lib/`. In gitignore syntax a pattern without a slash matches at any depth, so it also matched `docs-site/src/lib/`. The first commit of this change therefore shipped a template that imported `../../lib/guide`, and the module it imported was not in the commit; a fresh checkout would fail to build.

Two fixes, both in this change. The helper moved to `docs-site/src/guide/guide.ts`, which sidesteps the pattern. `/lib/` in `.gitignore` and `.prettierignore` anchors the rule to the build output it was written for, so a nested `src/lib/` can no longer disappear. Verified: `lib/probe.js` at the root stays ignored, `docs-site/src/lib/probe.ts` is now committable, and `client/*.js` build output stays ignored.

A repository-wide scan of `*.ts`, `*.tsx`, `*.mjs`, `*.astro` and `*.md` outside `node_modules`, `lib` and `client` found no other ignored source file. The remaining ignored paths are tool state (`.mnemon/`, `AGENTS.local.md`) and Astro's `.astro/` cache.

## The site's own type check, which read nothing at first

The four root `tsconfig` projects do not include `.astro` files, and eslint runs over `index.ts packages tests`. Nothing read the site's templates, so `docs-site/package.json` declared `@astrojs/check` without any script or workflow step that used it.

Adding `docs-site/tsconfig.json` (extending `astro/tsconfigs/strict`) and a `check` script turned that into a working gate. Without the `tsconfig` the command reported 0 errors on 12 files even when a frontmatter type error was injected; with it, the same injection fails the run. The baseline then showed three real errors and one unused variable in this change's own code: `entry.filePath`, `entry.body` and `entry.rendered` are all optional in the collection types. The page throws when any of them is missing, because a route or an empty body built from an absent field is worse than a failed build.

`pnpm --dir docs-site run check` passes with 0 errors, 0 warnings and 0 hints over 12 files.

All three steps run in two workflows. `docs-pages.yml` runs them before deploying on a push to `main`. `quality.yml` gained a `Docs site` job that runs the same three on every push and pull request, because `docs-pages.yml` runs on `main` only: without that job a broken site change passed review and failed after merge.

## The sitemap that fell behind the pages

`public/sitemap.xml` was hand-maintained and named four URLs. This change added seven guide routes and did not touch it, so the deployed sitemap would have advertised a third of the site. Hand-maintaining it is the defect, not the omission.

`docs-site/scripts/generate-sitemap.mjs` now writes `dist/sitemap.xml` from the emitted `index.html` files, and the `build` script runs it. The static file is deleted. `robots.txt` keeps pointing at the same URL, which the build now produces. A page whose file name is not `index.html` stays out, which is why the Google verification token in `public/` is excluded.

Verified in both directions: the current build writes 11 URLs covering every content page, a page added under `dist/` appears in the sitemap with no edit to the script and disappears again after regeneration, and a missing build exits 2 rather than writing an empty sitemap.

## Testing

`pnpm --dir docs-site run build` builds 23 pages from the repository root, which is the command `docs-pages.yml` runs. Its output carries the seven task pages, `/docs/agent-roles/`, `/docs/layout-coverage/` and the `/docs/zh/` counterpart of each.

The split is proved lossless rather than trusted. Every non-heading content line of the old 223-line pair appears in the new pages, with two accounted exceptions: the duplicated line 9 and the two container headings that dissolve with their container. Both language sides were checked independently, and each new pair has identical line counts.

`pnpm --dir docs-site run check` reports 0 errors, 0 warnings and 0 hints over 12 files, and was proven to have teeth: with a frontmatter type error injected it fails, and without `docs-site/tsconfig.json` that same injection passed, which is why the config is part of this change.

`pnpm --dir docs-site run check:links` passes on that output: 559 internal links, 2 same-page anchors and 23 asset references resolve across 24 pages. Its failure path is proven by injecting four faults into a copy of the build: a missing page, a missing fragment, a relative path and an unrewritten markdown link each produce a `BROKEN` line and exit code 1. The check caught four real cross-page anchors the split broke — `settings` still pointed at `#project-layouts` and `#translation`, which had moved to other pages — before any of them reached a deployment.

`pnpm --dir docs-site run check:guide` passes over 18 files in nine pairs. Its failure path is proven three ways: an unlisted page, a pair with unequal line counts, and a missing counterpart each exit 1.

Every URL the READMEs and the site's own pages point at was resolved against the build: 14 distinct targets, all present, including the two Chinese anchors. The root suite stays green at 213 files and 2048 tests on Node 24.
