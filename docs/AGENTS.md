# AGENTS.md — Documentation

Markdown under `docs/` is organized by the reader it serves. A page states its own subject; lower-level detail belongs to the owning descendant, reached by link. Product contracts live beside the code that owns them ([README.md](../README.md), [schemas/README.md](../schemas/README.md), `src/` JSDoc); decision rationale lives in [.agents/notes/](../.agents/notes/README.md).

## Tree

| Directory | Holds | Examples |
| --- | --- | --- |
| `user/` | Product-facing guides for someone using the plugin | [usage.md](user/usage.md), [agent-roles.md](user/agent-roles.md), [layout-coverage.md](user/layout-coverage.md) |
| `reference/` | Stable material a page or PR cites: contracts, audits, generated reports | [dsh-plugin-development-standard.md](reference/dsh-plugin-development-standard.md), [compat-report.md](reference/compat-report.md) |
| `developer/decisions/` | Accepted decisions, one page per decision | [0002-versioning-and-release-policy.md](developer/decisions/0002-versioning-and-release-policy.md) |
| `developer/design/` | Design and staged plans for maintainers | [engineering-refactor-plan.md](developer/design/engineering-refactor-plan.md) |
| `developer/discussion/` | Findings that inform a decision, kept as evidence | [2026-09-02-agent-config-compat-ecosystem.md](developer/discussion/2026-09-02-agent-config-compat-ecosystem.md) |
| `developer/release/` | Release runbook and per-version materials | [release-process.md](developer/release/release-process.md) |
| `developer/upstream-proposal/` | Work aimed at an upstream repository | [mcp-oauth-relocation-plan.md](developer/upstream-proposal/mcp-oauth-relocation-plan.md) |
| `scratch/` | Expiring working material; not authoritative | [promotion/](scratch/promotion/promotion-kit.md) |
| `screenshots/` | Images the root READMEs embed | `screenshots/market.png` |

Place a new page in the directory of its reader. Choose `reference/` over `scratch/` when another page or a test cites it, and promote a scratch page into `user/`, `reference/`, or `developer/` when it becomes durable.

## Bilingual pages

`user/` pages ship English and Simplified Chinese as one edit: `usage.md` with `usage.zh.md`. Keep headings, lists, tables, code fences, and link targets aligned one for one, and keep the physical line count equal. The English side keeps its own link when no counterpart exists. Developer, reference, and scratch material stays English-only.

## Generated artifacts

[compat-report.md](reference/compat-report.md) and `compat-report.json` come from `node scripts/compat-report.mjs`; do not hand-edit them. Both are in `.prettierignore`. Moving or renaming one means updating the generator, [tests/compat-report.test.ts](../tests/compat-report.test.ts), and every inbound link in the same change.

## Moving a page

Move one topic at a time, with `git mv`, and repair every inbound reference in the same change: relative Markdown links, path mentions in [.agents/notes/](../.agents/notes/README.md), the `docs-site/` pages, and the READMEs. Re-run `grep -rn 'docs/' --include='*.md' .` afterwards to confirm no page still points at the old path.
