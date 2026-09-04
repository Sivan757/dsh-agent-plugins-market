---
name: market-release
description: Use when the user asks to release, publish a version, tag a release, or mentions 发版/发布/npm publish for dsh-agent-plugins-market, to follow the workflow-owned release chain (release-please Release PR → auto tag/release/publish) and the user-confirmation rule for every remote write.
---

# Market Release

Releases are workflow-owned: release-please (embedded in `.github/workflows/npm-publish.yml`) opens the Release PR against `main`, and merging it auto-tags, auto-creates the GitHub Release, and auto-publishes npm. The full runbook lives at [docs/release/release-process.md](../../../docs/release/release-process.md); read it before acting.

## Hard rule

Every remote write — `git push`, `git tag`, `npm publish` — requires explicit user confirmation before execution. An agent-initiated push or publish without confirmation is a defect, even when every check is green.

## Steps

1. **Verify the outgoing tree.** Run `check:refactor` and `pnpm run test`; both green is the completion criterion. Fix drift before any release talk (see [market-pre-push-checks](../market-pre-push-checks/SKILL.md) for the surface-to-check mapping).
2. **Classify the version.** Read `git log` since the latest `dsh-agent-plugins-market-v*` tag: any `feat:` → minor, only `fix:`/`perf:` → patch, `feat!`/`BREAKING CHANGE:` → major. State the expected next version to the user before pushing.
3. **Propose the push and wait for confirmation.** After the user confirms, push `main`; `docs/**`, `README*`, and CI-only paths are in `paths-ignore` and do not trigger release-please.
4. **Verify the Release PR.** `gh pr list` for the `chore(main): release` PR; check `package.json` version, CHANGELOG section, and `.release-please-manifest.json` agree with the classified version, and quality/CodeQL runs are green.
5. **Propose the merge and wait for confirmation.** Merging is the one mandatory manual step; after it, watch the npm-publish run on the merge commit — tag, GitHub Release, and npm publish are automatic.
6. **Report and close out.** Confirm tag + Release + `npm view @deepseek-ai/dsh-agent-plugins-market dist-tags`, then offer the post-release items from `docs/release/release-v<version>.md` (Highlights on the auto-generated Release body, announcements).
