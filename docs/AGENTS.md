# AGENTS.md — Documentation

Markdown under `docs/` is organized by the reader it serves. A page states its own subject; lower-level detail belongs to the owning descendant, reached by link. Product contracts live beside the code that owns them ([README.md](../README.md), [packages/market-catalog/schemas/README.md](../packages/market-catalog/schemas/README.md), `src/` JSDoc); decision rationale lives in [.agents/notes/](../.agents/notes/README.md).

## Tree

| Directory | Holds | Examples |
| --- | --- | --- |
| `user/` | Product-facing guides for someone using the plugin, one page per task | [install.md](user/install.md), [sources.md](user/sources.md), [resources.md](user/resources.md), [ai-assist.md](user/ai-assist.md), [instructions.md](user/instructions.md), [output-styles.md](user/output-styles.md), [services.md](user/services.md), [translation.md](user/translation.md), [settings.md](user/settings.md), [workspace.md](user/workspace.md), [agent-roles.md](user/agent-roles.md), [layout-coverage.md](user/layout-coverage.md) |
| `reference/` | Stable material a page or PR cites: contracts, audits, generated reports | [dsh-plugin-development-standard.md](reference/dsh-plugin-development-standard.md), [host-foundation-map.md](reference/host-foundation-map.md), [compat-report.md](reference/compat-report.md) |
| `developer/decisions/` | Accepted decisions, one page per decision | [0002-versioning-and-release-policy.md](developer/decisions/0002-versioning-and-release-policy.md) |
| `developer/design/` | Design and staged plans for maintainers | [engineering-refactor-plan.md](developer/design/engineering-refactor-plan.md) |
| `developer/discussion/` | Findings that inform a decision, kept as evidence | [2026-09-02-agent-config-compat-ecosystem.md](developer/discussion/2026-09-02-agent-config-compat-ecosystem.md) |
| `developer/release/` | Release runbook and per-version materials | [release-process.md](developer/release/release-process.md) |
| `developer/upstream-proposal/` | Work aimed at an upstream repository | [mcp-oauth-relocation-plan.md](developer/upstream-proposal/mcp-oauth-relocation-plan.md) |
| `scratch/` | Expiring working material; not authoritative | [promotion/](scratch/promotion/promotion-kit.md) |
| `screenshots/` | Images the root READMEs embed | `screenshots/market.png` |

Place a new page in the directory of its reader. Choose `reference/` over `scratch/` when another page or a test cites it, and promote a scratch page into `user/`, `reference/`, or `developer/` when it becomes durable.

## Bilingual pages

`user/` pages ship English and Simplified Chinese as one edit: `install.md` with `install.zh.md`. Keep headings, lists, tables, code fences, and link targets aligned one for one, and keep the physical line count equal. The English side keeps its own link when no counterpart exists. Developer, reference, and scratch material stays English-only.

Each `user/` page owns one task, and the reading order lives in [the guide library](../docs-site/.vitepress/guide.ts): `GUIDES` lists the pages and `SECTIONS` groups them. Add a page to both, or the site will not route it. A page carries a `**Guide:**` line of sibling links, so the sequence survives on GitHub where the site sidebar does not exist.

The [docs site](../docs-site/.vitepress/config.mts) renders every `user/` page, so a guide edit is also a site edit: the pair becomes `/docs/<name>/` and `/docs/zh/<name>/`. `docs-pages.yml` watches `docs/user/**` and `docs-site/**` for that reason. `docs-site/scripts/copy-guide.mjs` copies the pages into the site before each build and rewrites their links: a target inside `user/` becomes a site route, and anything else (README, `schemas/`, sources) becomes a GitHub URL. `docs-site/scripts/check-guide.mjs` recomputes the rewrite, so an out-of-date copy fails the check.

## Generated artifacts

[compat-report.md](reference/compat-report.md) and `compat-report.json` come from `node scripts/compat-report.mjs`; do not hand-edit them. Both are in `.prettierignore`. Moving or renaming one means updating the generator, [compat-report.test.ts](../packages/market-bundle/test/repo/compat-report.test.ts), and every inbound link in the same change.

The `docs-site/guide/` directory is the same kind of artifact: generated from `user/` by `copy-guide.mjs`, gitignored, and never edited by hand.

## Moving a page

Move one topic at a time, with `git mv`, and repair every inbound reference in the same change: relative Markdown links, path mentions in [.agents/notes/](../.agents/notes/README.md), the `docs-site/` pages, and the READMEs. Re-run `grep -rn 'docs/' --include='*.md' .` afterwards to confirm no page still points at the old path.
