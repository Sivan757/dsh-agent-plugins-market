# AGENTS.md

`dsh-agent-plugins-market` is the DeepSeek Harness plugin that installs Claude Code / Codex / Cursor / Kimi marketplace suites in place — zero conversion, zero file copying — and injects skills, MCP servers, hooks, commands, agents, and LSP servers into dsh sessions at runtime. Domain vocabulary lives in [CONTEXT.md](CONTEXT.md) (source, dialect, suite, surface, install state); use those terms exactly. Human onboarding and PR flow live in [CONTRIBUTING.md](CONTRIBUTING.md) — do not restate them here.

## Repository layout

```
src/
  application/  use cases: Catalog facade, ports, source/snapshot/install stores, MCP + LSP services, queries
  catalog/      pure source scanning: manifests, dialects, scan pipeline, fs probes, lsp-spec validation
  client/       Web market page (React + CSS modules), bilingual locales.ts
  contracts/    API request/response types shared by routes and client (imports nothing)
  model/        domain records only (suite, source, surfaces) — no Node APIs
  runtime/      harness-facing effects: reconciler + scheduling, surface mounts and their shared lifecycle, MCP client bridge, status builders, persisted stores
  index.ts      plugin entry (composition root); routes.ts  API surface
schemas/        versioned mcp.schema.json and friends (strict validation contracts)
tests/          vitest suites mirroring src/; fixtures under tests/fixtures
docs/           user/, reference/, developer/{decisions,design,discussion,release,upstream-proposal}/, scratch/ — see docs/AGENTS.md
docs-site/      Astro docs site
scripts/        build helpers (client banner, lifecycle verification)
```

## Commands

```sh
pnpm run typecheck           # src, client, and both test projects
pnpm run lint                # eslint src tests
pnpm run check:quick         # typecheck + lint — also runs before test and build
pnpm run format:check        # prettier — tracked text except the paths in .prettierignore
pnpm run test                # vitest run (full suite)
pnpm run test:contract       # routes + market contracts only
pnpm run check:architecture  # dependency-cruiser over src/
pnpm run check:refactor      # check:quick + format:check + test:contract + architecture
pnpm run build               # tsc emits lib/, tsdown bundles client/
```

`check:quick` is the cheap half of the gate and runs on its own: `pretest` and `prebuild` invoke it, so a type or lint error surfaces the moment someone tests or builds rather than at review. The pre-commit hook runs it plus `format:check` and the host-alignment check — `git commit --no-verify` bypasses all three deliberately.

`check:refactor` is the standing local gate; `npm-publish.yml` reruns it plus `pnpm run test` on a release tag, so a green full suite before push is enough locally. Prettier covers files eslint does not, except the paths in `.prettierignore` (`docs-site/`, `lib/`, `client/`, `tests/fixtures/`, `CHANGELOG.md`, `docs/reference/compat-report.*`) — run `format:check` after writing docs or HTML before claiming a green tree.

## Conventions

- **Non-trivial changes include an Agent Note** in the same PR — a decision a maintainer may reasonably revisit is recorded under [.agents/notes/](.agents/notes/README.md) (proposed/implemented/rejected by class), and a new note triggers a supersession check of active notes on the same decision. Mechanical or local edits are exempt.
- **Commit types drive releases.** `feat:`/`fix:` in conventional-commit subjects are parsed by release-please into the next version and the changelog; a misclassified subject ships a wrong version. Scope the subject to the surface (`feat(mcp):`, `fix(lsp-status):`) and keep the body carrying the rationale.
- **Releases are workflow-owned.** release-please (embedded in `.github/workflows/npm-publish.yml`) opens the Release PR against `main`; merging it auto-tags, auto-creates the GitHub Release, and auto-publishes npm. Follow [docs/developer/release/release-process.md](docs/developer/release/release-process.md); the runbook's one hard rule: any remote write (`git push`, `git tag`, `npm publish`) requires user confirmation first.
- **Bilingual is part of the change.** User-visible strings go through `src/client/locales.ts` with paired zh/en keys; user-facing docs ship `README.md` and `README.zh.md` as one edit. A surface that renders English-only text is an incomplete change.
- **Validation fails closed.** A malformed manifest, `mcp.json` server, or `lspServers` declaration is diagnosed and skipped (or drops to an empty table), never silently half-mounted; suite data flows into `SourceOverview.scanNotes` and the status panels instead of disappearing. Follow the existing strategy-chain and status-builder patterns in `src/catalog/` and `src/runtime/`.
- **Docs accompany code.** A behavior change to config keys, defaults, routes, error codes, or schemas updates README(s), the affected `docs/` page, and JSDoc in the same PR. Architecture decisions get an ADR under `docs/developer/decisions/`.
- **Runtime owns effects; catalog stays pure.** Keep filesystem, process, and harness-context access in `src/runtime/` and `src/application/`; `src/catalog/` resolvers stay testable pure functions. `check:architecture` enforces the boundaries.
- **New dependencies are justified in the PR body** and land in `pnpm-lock.yaml` (`--frozen-lockfile` is the CI contract).

## Editing these instructions

`AGENTS.md` is this repository's only instruction entry point; edit it here. Keep each rule self-contained and link rationale instead of restating it.

<!-- dsh-workflow:begin -->

## Skill routing

Route these duties through the dsh-workflow skills rather than ad-hoc practice.

| Before you…                                                                | Use the skill            |
| -------------------------------------------------------------------------- | ------------------------ |
| Push, mark ready for review, or claim checks pass                          | dsh-pre-push-checks      |
| Write or review prose, comments, README/JSDoc contracts, CLI or UI strings | dsh-prose-standard       |
| Audit text that reads like a reasoning transcript                          | dsh-trim-cot-leakage     |
| Add, restructure, review, or audit documentation                           | dsh-doc                  |
| Record or reclassify rationale, decisions, or postmortems                  | dsh-archive-agent-notes  |
| Update either side of a bilingual pair                                     | dsh-translate-docs       |
| Review a pull request                                                      | dsh-code-review          |
| Diagnose flaky or nondeterministic tests                                   | dsh-ci-test-reliability  |
| Look for redundancy, dead code, or over-built surfaces                     | dsh-find-simplifications |
| Land dependent pull requests as a stack                                    | dsh-merging-stacked-prs  |
| Investigate a performance regression                                       | dsh-speed-up-perf        |
| Attach a GUI demonstration to a pull request                               | record-browser-gif       |

## Placement

- Bug write-ups go to postmortems, rationale to Agent Notes, procedures to cookbooks, type definitions to source, package contracts to package READMEs, and standing orders to this file.
- Skills hold reusable workflows and specialized decision standards. Product and runtime contracts belong in docs or source.

<!-- dsh-workflow:end -->
