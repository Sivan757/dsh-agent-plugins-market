# Agent Note: Consumer-first documentation tiers

Status: implemented

## Problem

The root READMEs reached 242 lines and served three readers at once: a first-time visitor, someone already running the plugin, and a maintainer checking layout precedence. About a third of the text was developer reference: the layout priority table, the layout support matrix, the project-scope switch, the verified samples and the repository layout. The consumer reader left the first screen before reaching the quick start. The same FAQ existed three times, in `README.md`, `docs/user/usage.md` and `docs-site/src/pages/faq.astro`, with no page named as authoritative.

The install section also led with a terminal command while the DSH Web GUI already installs a plugin from a package name: the sidebar Plugins page opens an Add plugin dialog that accepts an npm package name, a repository address or a local directory (`packages/client/ui-plugin-manager/src/client/locales.ts` lines 56 to 70 in the harness checkout).

## Decision

Each entrance serves one reader and one Diátaxis quadrant. The README is the front door and tutorial; the documentation site is the full documentation; `packages/market-ui/src/locales.ts` is the single source of UI copy; `CONTEXT.md` stays the maintainer glossary. One topic appears in one place.

Both READMEs shrink to 140 lines with the same section order: value, screenshots, quick start, Highlights, everyday use, compatibility, FAQ, documentation, community. `README.md:62` splits Highlights into Core and Advanced, so an advanced capability such as MCP OAuth or the per-workspace surface switches reads as its own line instead of sitting inside a compound sentence.

The quick start installs from the Web GUI in five steps. The terminal command becomes one alternative line. Every image uses its absolute `raw.githubusercontent.com` URL, because npm renders the same `README.md` with a different base path.

Compatibility leaves the README. The `docs-site/src/pages/compatible-plugins.astro` page carries the runtime-surface table, the layout precedence table, the support matrix, the project switch and the verified samples, and the README links to it. The README keeps a four-item FAQ and points to the site FAQ for the rest. The docs-site FAQ is the single source. Install, home and FAQ pages on the site state the GUI path first.

## Alternatives considered

**Rewrite the prose and keep the structure.** Rejected: the problem is allocation, not wording. The three readers would still compete for the same 242 lines.

**Split the eight private packages into published npm packages.** Rejected for this change, and deferred on its own merits. The plugin publishes one artifact and the workspace packages stay private, so a split changes the release surface from one version to nine with no external consumer asking for it. A split, if it ever happens, needs per-package npm front pages and belongs in its own decision.

**Keep the compatibility tables in the README and shorten elsewhere.** Rejected: GitHub and npm render the same `README.md`, so the README is the only page that serves both the newcomer and the person evaluating layout support. Reference detail belongs on the site, which has its own navigation.

## Consequences

The site now owns the compatibility reference and its inbound links. `.github/workflows/docs-pages.yml` watches only `docs-site/**`, so an edit under `docs/` does not rebuild the deployed site; the site links such pages by absolute GitHub URL instead of rendering them.

Three inbound links pointed at the moved README table: `docs/user/usage.md` and its Chinese counterpart, and `schemas/README.md`. All three now point at the site anchor `compatible-plugins/#shared-layout-precedence`.

`CONTRIBUTING.md` still described a removed `src/` directory. The same change corrects its repository map to `index.ts` plus `packages/`.

`docs/reference/version-audit-2026-10-07.md` cites README line ranges from the 242-line file. The dated audit snapshot keeps those ranges unchanged, because editing it would rewrite the record of that audit.

This note partially supersedes [README information structure](2026-09-08-readme-information-structure.md): its structural order and its "keep expanding the feature list" alternative no longer describe the READMEs, while its copy rule remains active through [User-facing copy omits decisions and unrequested hints](2026-09-11-user-facing-copy-omits-decisions.md). Both notes stay active and cross-linked.

## Testing

`pnpm run format:check` and the TypeScript projects in `tsconfig.json` and `tsconfig.client.json` pass. The full vitest suite passes on Node 24: 213 files and 2048 tests. `tests/compat-report.test.ts` still finds `docs/reference/compat-report.md` and `docs/user/layout-coverage` linked from both READMEs. The Astro build emits four pages, and the live routes and the precedence anchor return 200.
