# Agent Note: Force the host dependency baseline to one release line before it can ship

Status: implemented

## Problem

The published tarball carries whatever `package.json` said at the released tag, so a host pin that has fallen behind ships a stale contract. Two failures came out of the same drift:

1. **A prerelease peer range excludes the next host line.** `^0.1.2-rc.1` matches only `0.1.2-*` prereleases and `0.1.2` itself — semver resolves a prerelease identifier only against a comparator carrying the same `major.minor.patch`. Once the host moved to `0.1.5-rc.2`, every consumer's peer resolution pointed at a line nobody runs.
2. **A dynamically imported host package was never declared.** `src/runtime/lsp-mounts.ts` mounts `@deepseek-ai/dsh-lsp-stdio` through `import(...)`, and the package appeared in no dependency section at all, so nothing versioned it and its `host-missing` diagnostic was the only trace of its absence.

Nothing detected either one: `check:refactor` reads the tree, and the tree was internally consistent — package.json, the lockfile, and `pnpm-workspace.yaml` all agreed on the same stale version.

## Decision

`scripts/check-host-alignment.mjs` resolves the host release line and fails unless everything agrees with it.

**The baseline is resolved, not stored.** The script asks the registry for the `next` dist-tag of every `@deepseek-ai/dsh-*` package the manifest declares or the source imports, and requires the family to agree on one version — the family publishes in lockstep, so a disagreement is an error, not a vote. `latest` is deliberately not the default: the `dsh` family publishes to `next` while `latest` lags several minor lines behind. `--host-version` pins a baseline explicitly and skips the network; `--channel` selects another dist-tag; a five-minute cache under `node_modules/.cache/` keeps the pre-commit path fast, and `--offline` refuses rather than guessing.

**Five rules, each a distinct way the config drifts:**

| Rule | Checks |
| --- | --- |
| `peer-stale` / `dev-stale` | every declared host package carries peer `^<baseline>` and dev `<baseline>` |
| `peer-missing` / `dev-missing` | every host package referenced from `src/` is declared, and every peer has a dev mirror |
| `optional-undeclared` | a package reached _only_ through `import(...)` is an optional peer — a static import carries a compile-time contract and stays required |
| `cordis-mirror` | `@deepseek-ai/cordis` carries one identical range in peer and dev, since it tracks its own 4.x line |
| `exclusion-missing` / `exclusion-stale` | `pnpm-workspace.yaml` `minimumReleaseAgeExclude` admits the baseline for every aligned package |

`@deepseek-ai/dsh-client-*` is exempt from the peer rules: those are host-supplied bundle externals, pinned through devDependencies only, and never installable capabilities.

**Three gates, because the drift can be introduced at three points.** `.githooks/pre-commit` (registered by `prepare` through `core.hooksPath`, so a fresh clone gets it with no hook-manager dependency) stops a drifting commit from existing. `prepack` runs on every `pnpm publish` / `npm pack`, covering the real publish path. `npm-publish.yml` runs the gate in the `release-please` job _before_ release-please-action, so a drifting `main` never becomes a tag and a GitHub Release with no npm artifact behind it — a state release-please would not revisit. `--fix` rewrites the pins, adds missing declarations, and normalizes the exclusion entries the repository owns, then reports that `pnpm install` must refresh the lockfile.

## The 0.1.2-rc.1 → 0.1.5-rc.2 alignment this produced

Realigning the pins required three adaptations:

- `@deepseek-ai/dsh-client-ui-primitives` stopped declaring its browser dependencies (harness `f39a37a523`, "keep browser dependencies out of production installs") while its `lib/index.js` still imports them; the host web app supplies them at bundle time, so this repository declares the sixteen it needs to load the module under Vitest's `inline`.
- `@deepseek-ai/dsh-session` moved its session header to `version: 3`.
- The `surfaceOp` replace shape became `{ op, startSeq, endSeq }`.

## Alternatives considered

- **A checked-in baseline file** (`host-baseline.json`) that the gate reads. Rejected: it is a second source of truth for exactly the field that goes stale, and it would need its own gate to stay current. The registry already answers the question, and `--host-version` covers the offline case.
- **Renovate / Dependabot.** Rejected: they open version PRs on their own schedule, do not know that the `dsh` family releases on `next` as one lockstep line, and do not reason about prerelease peer-range semantics or the `minimumReleaseAgeExclude` escape hatch. They also cannot fail a release.
- **Widening the peer range to span prerelease lines** (`>=0.1.2-rc.1 <0.2.0`). Rejected: it asserts compatibility with host versions this repository has never built against, and hides the very drift the gate exists to surface. Pinning the tested line is the repository's documented convention.
- **Husky or `simple-git-hooks`.** Rejected: a new dependency and a hook manager to install one hook. `core.hooksPath` plus `prepare` reaches the same end state with no dependency, and the hook file stays reviewable in the repository.
- **Auto-fixing inside the pre-commit hook.** Rejected: a commit hook that silently rewrites `package.json` and `pnpm-workspace.yaml` mutates a working tree the author is still editing. The hook fails with the `fix:host-alignment` command instead, so the rewrite is the author's explicit act.
- **Gating only in the `npm-publish` job.** Rejected: that job runs after release-please has created the tag and the GitHub Release, so a failure there leaves a published release with no npm artifact. Gating the `release-please` job prevents the tag instead.
- **Keeping `@deepseek-ai/dsh-client-ui-primitives` on 0.1.2-rc.1 in devDependencies** so its browser dependencies kept arriving transitively. Rejected: it is the drift this change exists to remove, one package at a time.

## Consequences

- A host line that moves now surfaces as a failed commit or a failed release run, with the exact expected version in the message, instead of as a stale tarball nobody notices until a consumer reports a peer resolution failure.
- The gate needs network access on first run in a cache window. It fails closed (exit 2) with the `--host-version` escape hatch named in the message rather than passing silently.
- Aligning is now a two-step habit: `pnpm run fix:host-alignment`, then `pnpm install`. Leaving out the second step leaves the lockfile stale, which `pnpm install --frozen-lockfile` catches in CI.
- The gate can only fire when this repository acts. If the host line moves after the last release, the already-published tarball keeps its old range until the next release — a pre-release check cannot reach further than that.
- `--fix` normalizes only the exclusion entries this repository's own packages need; the entries pnpm writes for transitive packages pass through untouched, including the `a || b` version lists it merges on repeated updates.

## Deferred

`scripts/check-host-alignment.mjs` has no unit test. It is exercised by the three gate points on every commit, publish, and release run, but a broken rule would surface as a false pass rather than a failing assertion; the script reads fixed repository paths, so testing it needs an injectable root first.
