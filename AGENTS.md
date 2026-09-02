# AGENTS.md

`dsh-agent-plugins-market` is the DeepSeek Harness plugin that installs Claude Code / Codex / Cursor / Kimi marketplace suites in place — zero conversion, zero file copying — and injects skills, MCP servers, hooks, commands, agents, and LSP servers into dsh sessions at runtime. Domain vocabulary lives in [CONTEXT.md](CONTEXT.md) (source, dialect, suite, surface, install state); use those terms exactly. Human onboarding and PR flow live in [CONTRIBUTING.md](CONTRIBUTING.md) — do not restate them here.

## Repository layout

```
src/
  application/  use-case layer: catalog assembly, queries, install orchestration
  catalog/      source scanning: manifests, dialects, scan pipeline, lsp-spec validation
  client/       Web market page (React + CSS modules), bilingual locales.ts
  contracts/    API request/response types shared by routes and client
  model/        domain types (suite, source, surfaces)
  runtime/      harness-facing effects: reconciler, MCP client bridge, MCP/LSP mounts, status builders
  index.ts      plugin entry; routes.ts  API surface
schemas/        versioned mcp.schema.json and friends (strict validation contracts)
tests/          vitest suites mirroring src/; fixtures under tests/fixtures
docs/           adr/, design/, release/, promotion/, research/, standards/
docs-site/      Astro docs site
scripts/        build helpers (client banner, npm token, lifecycle verification)
```

## Commands

```sh
pnpm run typecheck           # both tsconfig.json and tsconfig.client.json
pnpm run lint                # eslint src tests
pnpm run format:check        # prettier — covers ALL files including docs/ and HTML
pnpm run test                # vitest run (full suite)
pnpm run test:contract       # routes + market contracts only
pnpm run check:architecture  # dependency-cruiser over src/
pnpm run check:refactor      # typecheck + lint + format:check + test:contract + architecture
pnpm run build               # tsc emits lib/, tsdown bundles client/
```

`check:refactor` is the standing local gate; `npm-publish.yml` reruns it plus `pnpm run test` on a release tag, so a green full suite before push is enough locally. Prettier covers files eslint does not — after writing docs, HTML, or fixtures, run `format:check` before claiming a green tree.

## Conventions

- **Non-trivial changes include an Agent Note** in the same PR — a decision a maintainer may reasonably revisit is recorded under [.agents/notes/](.agents/notes/README.md) (proposed/implemented/rejected by class), and a new note triggers a supersession check of active notes on the same decision. Mechanical or local edits are exempt.
- **Commit types drive releases.** `feat:`/`fix:` in conventional-commit subjects are parsed by release-please into the next version and the changelog; a misclassified subject ships a wrong version. Scope the subject to the surface (`feat(mcp):`, `fix(lsp-status):`) and keep the body carrying the rationale.
- **Releases are workflow-owned.** release-please (embedded in `.github/workflows/npm-publish.yml`) opens the Release PR against `main`; merging it auto-tags, auto-creates the GitHub Release, and auto-publishes npm. Follow [docs/release/release-process.md](docs/release/release-process.md); the runbook's one hard rule: any remote write (`git push`, `git tag`, `npm publish`) requires user confirmation first.
- **Bilingual is part of the change.** User-visible strings go through `src/client/locales.ts` with paired zh/en keys; user-facing docs ship `README.md` and `README.zh.md` as one edit. A surface that renders English-only text is an incomplete change.
- **Validation fails closed.** A malformed manifest, `mcp.json` server, or `lspServers` declaration is diagnosed and skipped (or drops to an empty table), never silently half-mounted; suite data flows into `SourceOverview.scanNotes` and the status panels instead of disappearing. Follow the existing strategy-chain and status-builder patterns in `src/catalog/` and `src/runtime/`.
- **Docs accompany code.** A behavior change to config keys, defaults, routes, error codes, or schemas updates README(s), the affected `docs/` page, and JSDoc in the same PR. Architecture decisions get an ADR under `docs/adr/`.
- **Runtime owns effects; catalog stays pure.** Keep filesystem, process, and harness-context access in `src/runtime/` and `src/application/`; `src/catalog/` resolvers stay testable pure functions. `check:architecture` enforces the boundaries.
- **New dependencies are justified in the PR body** and land in `pnpm-lock.yaml` (`--frozen-lockfile` is the CI contract).

## Editing these instructions

`CLAUDE.md` symlinks this file at the root; edit `AGENTS.md`. Keep each rule self-contained and link rationale instead of restating it.
