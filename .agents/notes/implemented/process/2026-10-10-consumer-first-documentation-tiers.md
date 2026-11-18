# Agent Note: Consumer-first documentation tiers

Status: implemented

## Problem

The root READMEs reached 242 lines and served three readers at once: a first-time visitor, someone already running the plugin, and a maintainer checking layout precedence. About a third of the text was developer reference: the layout priority table, the layout support matrix, the project-scope switch, the verified samples and the repository layout. The consumer reader left the first screen before reaching the quick start. The same FAQ existed three times, in `README.md`, `docs/user/usage.md` and `docs-site/src/pages/faq.astro`, with no page named as authoritative.

The install section also led with a terminal command while the DSH Web GUI already installs a plugin from a package name: the sidebar Plugins page opens an Add plugin dialog that accepts an npm package name, a repository address or a local directory (`packages/client/ui-plugin-manager/src/client/locales.ts` lines 56 to 70 in the harness checkout).

## Decision

Each entrance serves one reader and one Diátaxis quadrant. The README is the front door and tutorial; the documentation site is the full documentation; `packages/market-ui/src/locales.ts` is the single source of UI copy; `CONTEXT.md` stays the maintainer glossary. One topic appears in one place.

Both READMEs hold 148 lines with the same section order: value, demo, quick start, popular repositories, Highlights, everyday use, compatibility, FAQ, documentation, feedback. `README.md:57` splits Highlights into Core and Advanced, so an advanced capability such as MCP OAuth or the per-workspace surface switches reads as its own line instead of sitting inside a compound sentence.

The demo section sits directly under the value statement and tells one story in five captioned steps: add a source, install suites, save an extension preset, switch presets in a session, then work. It is a real recording of the Web GUI in a throwaway profile, so no maintainer workspace content appears. Each language has its own take, `docs/screenshots/demo.en.gif` and `docs/screenshots/demo.zh.gif`, and the image links to an MP4 of the same take beside it. The five numbered lines under the animation repeat the captions, so the story survives where the animation does not load.

Everyday use opens with a second recording made the same way, `docs/screenshots/workspace.en.gif` and `docs/screenshots/workspace.zh.gif`. It covers what a reader does without installing anything: write a skill, edit the system prompt, switch off the connector tools a session does not need, and select an output style. Four numbered lines repeat its captions. The six page screenshots left the READMEs: they showed an interface that has since changed, and they showed a maintainer's own workspace.

The value statement leads with the words a reader searches for: a skills and extensions manager that installs Claude Code, Codex, Cursor and Kimi plugin repositories as they are. The popular repositories section then names five repositories and what the market finds in each. On 2026-11-18 the four skill repositories were added and installed through the market routes of the published 0.15.3 package in a throwaway profile, and the Skills panel listed 15, 39, 22 and 19 skills. The fifth, claude-plugins-official, is the source the demo recording installs from. The section states the counts of that day. The WeChat group left the READMEs, and the last section sends feedback to GitHub Issues.

The quick start installs from the Web GUI in five steps. The terminal command becomes one alternative line. Every image uses its absolute `raw.githubusercontent.com` URL, because npm renders the same `README.md` with a different base path.

Compatibility leaves the README. The `docs-site/src/pages/compatible-plugins.astro` page carries the runtime-surface table, the layout precedence table, the support matrix, the project switch and the verified samples, and the README links to it. The README keeps a four-item FAQ and points to the site FAQ for the rest. The docs-site FAQ is the single source. Install, home and FAQ pages on the site state the GUI path first.

## Alternatives considered

**Rewrite the prose and keep the structure.** Rejected: the problem is allocation, not wording. The three readers would still compete for the same 242 lines.

**Split the eight private packages into published npm packages.** Rejected for this change, and deferred on its own merits. The plugin publishes one artifact and the workspace packages stay private, so a split changes the release surface from one version to nine with no external consumer asking for it. A split, if it ever happens, needs per-package npm front pages and belongs in its own decision.

**Keep the compatibility tables in the README and shorten elsewhere.** Rejected: GitHub and npm render the same `README.md`, so the README is the only page that serves both the newcomer and the person evaluating layout support. Reference detail belongs on the site, which has its own navigation.

**Lead with the six page screenshots and add no demo.** Rejected: six static pages show what the workspace contains, but not the order of use. A reader who arrives asking how to control what a session carries finds the answer only in one Highlights line. The screenshots also age with every interface change, so the READMEs no longer embed them.

**Replace each page screenshot with its own animation.** Rejected: six animations repeat the tab table below them and multiply the recording work for every interface change. Two recordings follow the two questions a reader brings: what to install, and what to write.

**Keep "one-stop manager" as the lead and present the plugin as a market.** Rejected: in the 14 days to 2026-11-17 the repository had 197 unique visitors and 3 new stars, while community ports of single repositories that this plugin installs unchanged held 168 to 381 stars and a skills manager held 581. Readers look for a skill repository by name or for a skills manager, and neither led the README.

**Embed the MP4 directly with a video element.** Rejected: the README must render the same way on GitHub and on npm, and images already render on both from absolute URLs, so an animated image takes the same path. Video embedding was not verified on npm. The MP4 stays as the link target because it is sharper and can be paused.

**Generate a motion graphic instead of recording the product.** Rejected: a recording proves the flow works as shown. A rendered animation would need to be redrawn for every interface change and would prove nothing.

## Consequences

The eight recording files add about 28 MB of binary media to the repository history. A change to the market page, the preset manager or the composer's preset button makes the demo recording stale. A change to the Skills, System prompt, Connectors or Output styles tab makes the workspace recording stale. A stale take is recorded again in both languages.

The six page screenshots stay in `docs/screenshots/` until a release publishes the new README. The README of the npm version published before this change still loads them from `main`, so an earlier deletion breaks the images on that npm page.

The counts in the popular repositories table age with the five repositories. A change to skill discovery in the scanner, or a listed repository that changes its layout, calls for the same check again.

`screenshots.json` sits in the repository root because community storefronts read it beside `package.json` and resolve its paths from that directory. It lists five stills under `docs/screenshots/`, cut from the English recordings. `docs/screenshots/social-preview.png` is the image for the repository's social preview setting, which only the repository owner can upload.

The WeChat QR image stays in `docs/screenshots/` for the same reason as the six page screenshots.

The site now owns the compatibility reference and its inbound links. At the time of this change `.github/workflows/docs-pages.yml` watched only `docs-site/**`, so an edit under `docs/` did not rebuild the deployed site and the site linked such pages by absolute GitHub URL instead of rendering them. [The docs site renders the user guide](2026-10-11-docs-site-renders-the-user-guide.md) later added `docs/user/**` to that trigger and made the site render the guide pages directly, so this note's GitHub-link consequence no longer describes the site.

Three inbound links pointed at the moved README table: `docs/user/usage.md` and its Chinese counterpart, and `packages/market-catalog/schemas/README.md`. All three now point at the site anchor `compatible-plugins/#shared-layout-precedence`. [The docs site renders the user guide](2026-10-11-docs-site-renders-the-user-guide.md) later split that guide into seven task pages, so `docs/user/usage.md` no longer exists.

`CONTRIBUTING.md` still described a removed `src/` directory. The same change corrects its repository map to `index.ts` plus `packages/`.

`docs/reference/version-audit-2026-10-07.md` cites README line ranges from the 242-line file. The dated audit snapshot keeps those ranges unchanged, because editing it would rewrite the record of that audit.

This note partially supersedes [README information structure](2026-09-08-readme-information-structure.md): its structural order and its "keep expanding the feature list" alternative no longer describe the READMEs, while its copy rule remains active through [User-facing copy omits decisions and unrequested hints](2026-09-11-user-facing-copy-omits-decisions.md). Both notes stay active and cross-linked.

## Testing

`pnpm run format:check` and the TypeScript projects in `tsconfig.json` and `tsconfig.client.json` pass. The full vitest suite passes on Node 24: 213 files and 2048 tests. `packages/market-bundle/test/repo/compat-report.test.ts` still finds `docs/reference/compat-report.md` and `docs/user/layout-coverage` linked from both READMEs. The Astro build emits four pages, and the live routes and the precedence anchor return 200.
