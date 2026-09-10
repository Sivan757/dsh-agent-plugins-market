# Agent Note: Two release modes — automatic conventional-commit versioning plus an explicit version override

Status: implemented

## Problem

The release version was decided solely by conventional-commit types. That fails the moment the commit types and the intended release differ: a batch of `feat:` commits that ships as a patch (0.6.2), a deliberate minor on a fix-only batch, or a skip. The only lever was editing `.release-please-config.json` (`bump-patch-for-minor-pre-major`), which flips the rule for _every_ future release — fixing one release by misconfiguring the next.

## Decision

`npm-publish.yml` keeps the automatic path and adds one manual input:

- **Automatic (default):** a push to `main` lets release-please derive the version from the conventional commits since the last release (`feat:` → minor, `fix:`/`perf:` → patch, breaking → major). No configuration changes.
- **Explicit:** `workflow_dispatch` accepts a `version` input, passed to `googleapis/release-please-action` as `release-as`. The Release PR then carries exactly that version, regardless of commit types. An empty input leaves the automatic behavior untouched.

Both paths converge on the same Release PR branch, so a manual dispatch updates whatever release-please had already proposed; merging that PR remains the single mandatory human step, and tag/Release/npm publish stay automatic.

The runbook ([docs/release/release-process.md](../../../../docs/release/release-process.md)) documents both modes and the `action_required` approval step for runs on the bot branch.

## Alternatives considered

- **`bump-patch-for-minor-pre-major: true`** was the previous lever. Rejected: it is global and permanent — it made every feature batch a patch until someone remembered to flip it back, which is exactly how the 0.6.0 release was miscomputed as 0.5.4.
- **A `Release-As:` commit footer** works without workflow changes but requires an extra commit on `main` for every forced release, and a `.github/**`-only change cannot carry it (those paths are ignored by the release trigger).
- **Editing `package.json` + `.release-please-manifest.json` by hand** fights the tool: release-please owns both files, and a hand-edited manifest desynchronizes the next automatic computation.

## Consequences

- Forcing a patch over feature commits is now a one-command operation, and the default rule stays semver-honest.
- The explicit input can also produce a version lower than the commits would justify (e.g. 0.6.2 with 9 feats) — a deliberate human decision, recorded in the Release PR for review.
- Version choice is auditable: the Release PR shows the exact version, and the workflow run records the input.
