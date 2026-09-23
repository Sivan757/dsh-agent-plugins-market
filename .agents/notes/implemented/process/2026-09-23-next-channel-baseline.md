# Agent Note: Resolve the alignment baseline from the prerelease candidate line

Status: implemented

## Problem

The alignment gate resolved its baseline from the `latest` dist-tag of `@deepseek-ai/dsh`. That assumption now describes the opposite of the family's actual flow: the release scripts tag every prerelease — rc included — to `next` (`distTagForVersion` in `scripts/release/families.ts`), and only a stable release repoints `latest`. While the host runs a prerelease line, `latest` names an old line nobody installs.

Measured on 2026-09-23: `latest` named `0.1.5-rc.3` while `next` named `0.1.7-rc.1` — the version the harness checkout (`dsh-v0.1.7-rc.1`), the locally installed CLI, and every capability package in the local profile (`$DSH_HOME/profiles/node_modules`) actually run. Aligning the plugin's peer contract to `latest` would ship a peer range excluding the only host version in use, the exact failure the gate exists to prevent, and would have blocked the 0.8.0 release.

The superseded 2026-09-22 decision judged `next` by the evidence of that day: `next` named `0.1.5-rc.3`, a prerelease the maintainers would not release. The family's publish flow now shows that judgment described a transient state, a rule of the flow.

## Decision

`scripts/check-host-alignment.mjs` resolves the baseline from the `next` dist-tag of `@deepseek-ai/dsh` by default; `--channel` selects another tag and `--host-version` still pins a baseline explicitly and skips the registry. The anchor stays `@deepseek-ai/dsh` — the package a consumer installs, and the only family member whose tags track the release line; the capability packages are queried for liveness and still do not vote, since their `latest` tags remain first-publish placeholders.

When the host ships its first stable release, `latest` becomes correct again; the default channel moves back in the change that adopts it.

## Alternatives considered

- **Stay on `latest` and ship peers against `0.1.5-rc.3`.** Rejected: the peer range would exclude every host the plugin actually runs on, which is the defect the gate exists to catch, and it would have blocked the 0.8.0 release outright.
- **Pin `--host-version 0.1.7-rc.1` at the call sites.** Rejected: it stores the value the gate exists to keep current, the same reason the 2026-09-22 note rejected a checked-in baseline file.
- **Move to the `alpha` tag.** Rejected: `alpha` names the experimental channel (`0.1.7-alpha.2`), a line ahead of what the owner installs; the plugin tracks the candidate line, not experiments.

## Consequences

- The baseline follows the version consumers actually install while the host runs a prerelease line, so commits and releases test against the host they target.
- When the host cuts a stable release, `next` freezes on the last prerelease and `latest` moves ahead; a default left on `next` would then lag the shipped line, so the channel default must move back to `latest` in the same change that adopts the stable host.
- The gate still cannot tell a deliberate hold from an abandoned tag on either channel; the registry answers only with what is published.

## Related decisions

Supersedes [resolve the alignment baseline from the latest release line](2026-09-22-latest-release-line-baseline.md) in full on the channel question: the anchor-package resolution, the two provisioning sections, the `--fix` behaviour, and the three gate sites carry forward. It in turn partially supersedes [force the host dependency baseline to one release line before it can ship](2026-09-11-host-dependency-alignment-gate.md), whose remaining rules stay in force.
