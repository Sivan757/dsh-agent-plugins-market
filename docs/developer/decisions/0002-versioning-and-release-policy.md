# Versioning and release policy

Releases are automated through release-please (ADR-0001 companion): conventional commit messages drive the version bump, the CHANGELOG, the git tag, and the npm publish (OIDC trusted publishing, no long-lived token). This ADR fixes the decision rules that make that automation predictable. The single most important rule is the commit-type classification: **only user-visible behavior changes may use `feat:` or `fix:`** — everything else must use a non-bumping type, or every internal tweak becomes a release.

## Version strategy

Semantic Versioning as implemented by release-please `release-type: node` (default strategy):

| Commit type                                                  | 0.x bump              | 1.x bump              |
| ------------------------------------------------------------ | --------------------- | --------------------- |
| `feat`                                                       | minor (0.4.6 → 0.5.0) | minor (1.2.0 → 1.3.0) |
| `fix`                                                        | patch (0.5.0 → 0.5.1) | patch (1.3.0 → 1.3.1) |
| `perf`                                                       | patch                 | patch                 |
| `BREAKING CHANGE` footer / `feat!` / `fix!`                  | minor                 | major                 |
| `refactor`, `test`, `docs`, `chore`, `ci`, `build`, `revert` | no bump               | no bump               |

The pre-1.0 exception: breaking changes bump minor, not major. This matches the convention that 0.x signals "API may still shift"; consumers must read CHANGELOG for every 0.x minor.

## Commit classification (the rule that matters)

The question to ask before choosing a commit type: **does a user of the installed package observe this change?**

- **User-visible behavior change** → `feat:` (new capability) or `fix:` (corrected behavior). This is a release candidate.
- **Internal refactor, tests, CI, documentation, build** → `refactor:`, `test:`, `ci:`, `docs:`, `build:`, `chore:`. Never use `fix(ci):` or `feat(ci):` — a scoped `fix(ci)` still bumps patch and opens a release PR.
- **Rules of thumb:**
  - Changes under `.github/`, `docs/`, `docs-site/`, `CHANGELOG.md`, `README*` never need a bumping type. The release-please workflow also ignores these paths (`paths-ignore`), so a `feat:` there would dead-letter — still, use the correct type for history clarity.
  - A pure dependency bump (`chore(deps):`) does not bump; a dependency change that alters runtime behavior is a `fix:` and should say so in the body.
  - If a change is both internal and user-visible (e.g. a refactor that fixes a bug), use the user-visible type (`fix:`) and describe the refactor in the body.
- A one-line test: if the commit message would be embarrassing in the CHANGELOG, it is the wrong type.

## Release trigger

- A release PR is opened only by release-please, only when the push touched bump-relevant paths (`src/`, `schemas/`, `package.json` deps) — enforced by `paths-ignore` in `.github/workflows/npm-publish.yml`.
- Merging a release PR is the release action. Before merging, the maintainer reviews the PR:
  1. Version is the expected semver bump (check the diff vs the previous release).
  2. CHANGELOG entries are the real user-visible changes — no internal noise.
  3. `quality` and `release-please` workflows are green on the PR.
- A release PR with wrong content is edited in the PR (CHANGELOG, version) or closed and the underlying commits are fixed — never "fix forward" by adding another bumping commit.

## Rollback and incident policy

- **Bug in a published version** → fix and ship a patch release. Do not delete the broken version.
- **Accidental publish** (wrong content, wrong version) → `npm deprecate` first (reversible, keeps the version available); `npm unpublish` only within npm's 72-hour window and only for versions with zero downloads, because it is irreversible and breaks anyone who already resolved the version.
- **`latest` tag** is managed by npm; to point consumers at a different version use `npm dist-tag` (e.g. keep a stable 0.5.x while testing 0.6.0 under `next`).

## Status

Accepted. Supersedes the informal "push and hope" release flow used before the release automation was introduced.

## Consequences

- Commit hygiene is load-bearing: a misclassified commit type directly produces a wrong version or a noise release. Enforced by review, not by tooling (release-please cannot know intent).
- The CHANGELOG is machine-generated and should not be hand-edited except inside a release PR.
- Version history stays linear and boring: one release per meaningful change set, no per-commit releases.
