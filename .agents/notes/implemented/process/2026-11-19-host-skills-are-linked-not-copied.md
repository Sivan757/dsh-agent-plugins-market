# Agent Note: Link the host's skills instead of copying them

Status: implemented

## Problem

This repository carried two copies of host skills under `.agents/skills/`: `market-pre-push-checks`, a rewrite of the host's `dsh-pre-push-checks` taken from the host state of 2026-09-12, and `market-release`, a wrapper over this repository's own release runbook. A copy is a snapshot, and nothing in the repository noticed when the snapshot aged out. It aged out in both directions at once:

1. **The host moved.** Between 2026-09-12 and 2026-11-17 the host's `dsh-pre-push-checks` gained a user-visible UI review rule, a repository-script type rule, and the Vitest filter guidance, and the host's skill set grew from 12 skills to 22. The copy carried none of it.
2. **The repository moved.** The copy's surface table still routed `src/**`, `tests/**`, and `tests/<area>.test.ts`, paths this repository stopped having on 2026-10-11 when the suites moved beside their packages. A skill that names files which no longer exist reads exactly like a skill that names files which do.

Nothing detected either drift. `check:refactor` reads the tree, and the tree was internally consistent — a stale skill file is indistinguishable from a current one.

## Decision

The repository carries no skill of its own. `.agents/skills` is a link to the host's skills directory, and no host skill text is copied here.

**The link.** `scripts/host-skills.mjs link` resolves the host directory — `--source`, then `DSH_HOST_SKILLS_DIR`, then the harness checkout at `~/workspace/deepseek-harness/.agents/skills`, then the `dsh-workflow` plugin bundle at `~/workspace/agent-plugins/plugins/dsh-workflow/skills`, then an installed copy of that bundle under `~/.dsh/agent-plugins/.sources/` for a machine that never cloned the host repositories — and points `.agents/skills` at it. `prepare` runs the link on every install, the same way it registers the git hooks, so a fresh clone and an existing checkout reach the same state. The link is gitignored: it names a path on this machine, not a fact about this repository.

**The facts stay here.** A host skill carries the method; it cannot carry this repository's surfaces. The pre-push evidence map moved into [AGENTS.md](../../../../AGENTS.md), where the commands and paths it names sit one edit away from the commands and paths the repository actually has, and the release flow was already carried by the `Releases are workflow-owned` convention and [the runbook](../../../../docs/developer/release/release-process.md).

**The gate.** `check:host-skills` fails when `.agents/skills` holds files again — the one drift that is a fact about the repository rather than about a machine — and reports which routed skill the host no longer publishes. A missing or broken link is a warning, because the next install repairs it. The check joins `check:refactor`, so CI fails closed on a copy that came back.

## Alternatives considered

- **Keep the copies and refresh them by hand.** This is what the repository did, and it is what produced both drifts: nothing said when the host moved, and nothing said when the repository's own paths moved under the copy.
- **Vendor the host's text and regenerate it from a manifest.** The host's skill is written for the harness repository — `pnpm run change-scope`, `pnpm run doc-sync`, `gh stack sync`, `apps/cli/tests/profiles/` — so a verbatim copy imports commands this repository does not have, and a manifest of replacements replaces the porting chore with a second file to keep in step.
- **Rely on the host's plugin alone, with no link.** The `dsh-workflow` plugin is the delivery channel for these skills, but it is not installed in every profile — the default profile mounts only the base bundle — so a repository that depends on it loses its workflow skills on a machine that never installed the plugin. The link keeps the skills reachable from the project root, and the plugin's set stays one `DSH_HOST_SKILLS_DIR` away.
- **Copy the host's whole skills directory into the repository.** That is a vendored snapshot with a larger surface to drift, and it still needs a refresh procedure.

## Consequences

- A session in this repository now sees the host's current skills — 22 of them from the harness checkout by default — instead of two rewrites frozen in September.
- A skill added upstream appears on the next `pnpm install`, with no change in this repository.
- The repository's own workflow facts live in AGENTS.md, so the evidence map and the code it names cannot drift apart unnoticed.
- The link is machine-local: a contributor with no host copy on disk gets no skills and a warning, not a failed gate. A machine that installed the workflow bundle from a marketplace gets one from the marketplace state instead.
- The routing table still names `dsh-doc`, the plugin bundle's name for the documentation skill, while the harness checkout publishes `dsh-doc-writing`. That block belongs to the plugin's `init-routing` command, so the check reports the mismatch instead of editing a block another owner generates.
