# Agent Note: Compatibility report measured on one real repository per schema

Status: implemented

## Problem

The compatibility matrix was a documentation and source audit: "Checked against official documentation and this plugin's source on 2026-09-08". That sentence could not answer the two questions a compatibility claim actually raises. First, does a real repository's manifest satisfy the contract we publish in `schemas/`? Second, when this plugin reads that repository, does it read the dialect at all — or does a higher-precedence manifest win? The [specification library](2026-09-08-plugin-specification-library.md) added field-level contracts for ten layouts without ever running them against a real file, and the new ZCode, Qoder CLI and GitHub Copilot CLI rows had no evidence of any kind.

## Decision

- **Two independent measurements per schema, because they fail separately.** _Schema conformance_ parses the dialect manifest and validates it with Ajv against `schemas/<dialect>/*.schema.json`. _Scanner integration_ runs the shipped scanner (`lib/catalog/suite-scanner.js` `scanSource`) over the same checkout and records the winning layout, suite count, surfaces and scan notes. A row can be schema-valid and scanner-shadowed at the same time — which is exactly what six of the nine samples turned out to be.
- **One repository per schema, pinned by branch.** `scripts/compat-sources.json` pins the sample chosen as the highest-starred GitHub candidate that ships the layout, found with code search and a batched GraphQL star lookup, then verified file-by-file. The report records the commit actually checked out, so a sample can never silently drift.
- **Acquisition is sparse, blobless and delayed.** The harness clones with `--depth 1 --filter=blob:none --no-checkout`, applies the sparse patterns, then checks out. `--no-checkout` matters: a plain `--sparse` clone still materializes root blobs first, which cost 54 MB of GIFs at 155 KB/s on one sample. With the patterns applied first, a 12 GB repository costs under a megabyte. Checkouts cache under `node_modules/.cache/compat-report/`.
- **A verdict vocabulary that names the interesting case.** `integrated` — the scanner read this dialect's own manifest as the suite identity. `shadowed` — suites were discovered, but a different dialect's manifest won. `unread` — no suite. `error` — acquisition or scanning failed. Shadowing is the finding the matrix previously could not express.
- **The report is generated, and guarded offline.** `node scripts/compat-report.mjs` writes `docs/compat-report.md` and `docs/compat-report.json`; both are in `.prettierignore` because they are generated. `tests/compat-report.test.ts` enforces coverage (every dialect schema has a sample, plus the vendored agent-plugins schema), shape, commit and verdict validity, that every referenced schema file exists, and that both READMEs cite every sampled repository and link the report. It never touches the network.
- **The README matrix carries measured rows.** ZCode, Qoder CLI and GitHub Copilot CLI have recognized manifest paths with explicit surface boundaries. A "Verified samples" table lists layout, repository, dialect manifest, schema verdict and scanner verdict. The script recompiles the current scanner before measuring and loads marketplace lookup paths from its layout registry. File presence is distinguished from a productive strategy result.
- **The schemas stay reference contracts.** The report measures; it does not make the scanner validate against the authored schemas at runtime. That remains a separate fail-closed decision, deliberately not taken here.
- **Supersession check.** This extends, and does not supersede, [the specification library note](2026-09-08-plugin-specification-library.md): the schemas keep their role, and this note owns only how their claims are measured. [README information structure](2026-09-08-readme-information-structure.md) still owns the README's organization; this note owns the evidence behind the compatibility section.

## Alternatives considered

- **A hand-written evidence table in the README only.** Rejected: it cannot be regenerated, and a reader has no way to tell a measured cell from an asserted one.
- **Running the harness in CI.** Rejected: nine network clones, one of them a 12 GB repository, do not belong in CI. The guard test keeps the checked-in report structurally honest without network access.
- **Validating with the vendors' own validators** (`scripts/validate.py` for ZCode, the compiled Zod bundle for Qoder). Rejected: that copies vendor implementation into this repository and goes stale with every client release. The schemas we publish are the contract under test.
- **Full shallow clones.** Rejected: `saadeghi/daisyui` is 12.3 GB. The sparse blobless clone is ~836 KB for the same repository.
- **One sample per surface instead of per schema.** Rejected: the request is one repository per schema, and a 1:1 mapping keeps the coverage test trivial and the report readable.
- **Wiring the authored schemas into runtime validation while we have real manifests.** Rejected here: it would change fail-closed behavior for every existing source and belongs in its own change with its own compatibility surface.

## Consequences

- All nine sampled manifests satisfy the published schemas, and three are read as their own dialect. Six are shadowed: `saadeghi/daisyui` (Codex sample) reads as agent-plugins v1, `EveryInc/compound-engineering-plugin` and `DietrichGebert/ponytail` and `zenstory-ai/oh-story-claudecode` and `headroomlabs-ai/headroom` read as Claude Code, and `obra/superpowers` reads as Claude Code. That is a property of the ecosystem — popular repositories ship several dialects at once — not a defect in the scanner, but it does mean a dialect's own identity is often not the one used.
- The three new dialects are recognized, but the sampled repositories still resolve through higher-priority manifests. Synthetic layout tests exercise their unshadowed identities separately; the report does not infer runtime compatibility from schema validity.
- The report is a point-in-time measurement. `generatedAt`, the per-sample commits and the selection date make its staleness visible, and regenerating is one command.
- Adding a schema now requires adding a sample, because the coverage test fails otherwise. That coupling is the point.
- The matrix still does not certify end-to-end behavior on the original platform; it records what this plugin does with a real repository.

## Verification

- `node scripts/compat-report.mjs` — nine samples, all schema-valid, three `integrated` and six `shadowed`, written to `docs/compat-report.json` and `docs/compat-report.md`.
- `pnpm exec vitest run tests/compat-report.test.ts tests/schemas.test.ts` — ten tests covering report coverage/shape, schema compilation and the README evidence links.
- `README.md`, `README.zh.md` and `docs-site/src/pages/compatible-plugins.astro` updated with the new rows, the verified-samples table and the report link.
