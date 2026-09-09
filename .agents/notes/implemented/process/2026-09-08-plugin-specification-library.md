# Agent Note: A specification library under `schemas/` that the runtime does not enforce

Status: implemented

## Problem

The compatibility matrix in [README.md](../../../../README.md) named ten plugin layouts, but the repository pinned a field-level contract for only one of them: the vendored agent-plugins.org v1.0.0 schemas under `schemas/1.0.0/`. Everything else — Claude Code, Codex, Cursor, Kimi, the universal `.plugin/` convention, and the newly researched ZCode, Qoder CLI, and GitHub Copilot CLI layouts — lived as prose in README tables and as scattered facts in `docs/research/`. That is not enough to answer the questions a dialect change actually raises: which manifest path wins when several exist, which MCP filename the client reads, whether a `source` object accepts `github`, and which upstream document any of it came from. Adding three dialects at once made the gap acute, because two of them (ZCode, Qoder) publish no schema and one (GitHub Copilot) publishes a schema for a different, adjacent format.

## Decision

- **`schemas/` holds two kinds of file, and the distinction is explicit.** `schemas/1.0.0/*.schema.json` stay the only **vendored** schemas: they are bundled and loaded at runtime by `src/catalog/validate.ts`, and they are replaced wholesale from upstream. Every other directory holds an **authored reference contract** that the scanner does not read. `schemas/README.md` states this in its first paragraph and in the provenance section, so a maintainer cannot mistake a reference schema for a gate.
- **One directory per dialect, with a fixed shape.** `<dialect>/plugin.schema.json`, `<dialect>/marketplace.schema.json`, and `<dialect>/spec.md`. `agent-plugins/spec.md` and `skill-collection/spec.md` carry no schemas because the first reuses `1.0.0/` and the second has no manifest to validate. `tests/schemas.test.ts` enforces the pairing so a future dialect cannot land half-documented.
- **Provenance lives in the artifacts, not only in the prose.** Every authored schema carries a `$comment` naming the sources and the verification date, and every `spec.md` opens with a verification date, an evidence list, the upstream schema status, and a closing evidence-gaps section. The gaps are recorded deliberately: for ZCode and Qoder the shipped runtime and the published docs disagree on several points, and a contract that hides that would be worse than no contract.
- **Authored schemas are open by default.** Clients ignore or strip unknown manifest fields, so `additionalProperties: true` is the honest contract everywhere except the vendored agent-plugins.org schema, which upstream closes. Required lists and `pattern` constraints mirror documented or implemented validation only.
- **The authored schemas are not wired into runtime validation.** Making the scanner validate Claude Code or Qoder manifests against these files would change fail-closed behavior for every existing source, which is a separate decision with its own compatibility surface. The schemas describe what the clients accept; the scanner keeps its strategy-chain rules.
- **The Agent Plugins standard keeps exactly one copy in the tree.** `agent-plugins/spec.md` documents the published cross-vendor format and points at `1.0.0/`, rather than duplicating the schemas into a second dialect directory.
- **Supersession check.** No active note owned the specification library. [README information structure](2026-09-08-readme-information-structure.md) owns README organization only and stays active; its compatibility matrix remains the user-facing summary, while `schemas/` becomes the field-level contract behind it.

## Alternatives considered

- **A single long `docs/standards/` document.** Cheaper to write, but it cannot be compiled, cannot be referenced per dialect, and would have to restate the field tables that a schema states mechanically. The repository already has `docs/standards/dsh-plugin-development-standard.md` for a different audience.
- **Markdown only, no JSON Schema.** Rejected because the repository's own convention for a pinned contract is a schema file, and because authoring the schemas surfaced real contradictions (ZCode's top-level `pluginRoot` versus `metadata.pluginRoot`; Qoder's documented three scopes versus the CLI's four) that prose alone had smoothed over.
- **Vendoring the SchemaStore Claude Code schemas.** They are community-maintained and stale relative to the docs (generated 2026-04-23, missing `displayName`, `metadata`, `defaultEnabled`, `experimental`, `workflows`, and `renames`). Vendoring them would have imported a wrong contract with an upstream badge.
- **Porting the upstream validators (`scripts/validate.py`, the Qoder Zod bundle) into the schemas.** That would make the schemas executable against the vendors' own rules, but it copies implementation into a documentation directory and goes stale on every client release. The `$comment` records the version that was observed instead.
- **Moving `1.0.0/` into `agent-plugins/1.0.0/` for symmetry.** It would require editing the runtime path constant in `src/catalog/validate.ts` and the tests for no functional gain; the vendored directory keeps its name and its runtime role.

## Consequences

- A maintainer changing a dialect now updates three things together: the schema, the `spec.md`, and the `$comment` provenance line. The guard test catches a missing file, not a stale fact — freshness stays a review responsibility, as it already is for the compatibility matrix.
- The `schemas/` directory is in the package `files` list, so the authored contracts ship to users as documentation. They are small JSON and Markdown files; the cost is packaging noise, not runtime behavior.
- Dialects whose upstream publishes nothing now have a contract with an explicit "authored, not vendored" label, which is the correct signal for anyone tempted to treat it as vendor authority.
- The evidence-gaps sections make the unverified parts of ZCode, Qoder, Kimi, and the universal layout discoverable at the point of use instead of in a research document.

## Verification

- `pnpm exec vitest run tests/schemas.test.ts` — 5 tests: schema count, Ajv 2020-12 compilation of every schema, unique absolute `$id`s, vendored ids pinned to `PLUGIN_SCHEMA_ID` / `MCP_SCHEMA_ID`, and the spec/paired-schema invariant.
- Every authored schema was compiled and then run against real manifests taken from the cited repositories (ZCode `example-plugin` and the official catalog, Qoder's first-party `security-scan` and the Apify catalog, the Copilot LSP example, the Claude Code docs example and the official catalog entry, the Codex marketplace fixture, the Cursor template and `vercel/vercel-plugin`, the Kimi docs example, and `vercel/vercel-plugin/.plugin/plugin.json`).
- `pnpm run typecheck`, `pnpm exec eslint tests/schemas.test.ts`, and `pnpm run test` (353 tests) pass.
