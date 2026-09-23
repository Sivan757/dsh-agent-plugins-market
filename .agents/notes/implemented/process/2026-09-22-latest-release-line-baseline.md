# Agent Note: Resolve the alignment baseline from the latest release line

Status: implemented

## Problem

The gate resolved its baseline from the `next` dist-tag of every declared capability package, on the reasoning that the family publishes to `next` while `latest` lags. That tag moves the moment the harness cuts a prerelease, whether or not it is the line this plugin should track. On 2026-09-22 the family's `next` tag named `0.1.5-rc.3` — published to the registry, tarball resolvable — while the maintainers will not release that version, the `@deepseek-ai/dsh` `latest` tag still named `0.1.5-rc.2`, and the harness checkout and its tags stopped at `dsh-v0.1.5-rc.2`. The gate therefore failed every commit and would have failed a release, over a version nobody ships.

Switching the channel alone cannot fix it, because the capability packages do not carry a meaningful `latest`. Measured the same day: `0.0.1-rc.1` for thirteen packages including `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-llm`, `0.0.1-rc.3` for `@deepseek-ai/dsh-home-paths`, `0.0.1-rc.5` for `@deepseek-ai/dsh-hooks-claude-code`, and `0.1.2-alpha.2` for `@deepseek-ai/dsh-client-store`. Each was published to `latest` once and then moved to `next`, so the family disagrees across four placeholder versions, and the agreement rule that guarded the old resolution would have rejected the channel outright.

## Decision

`scripts/check-host-alignment.mjs` resolves the baseline from the `latest` dist-tag of `@deepseek-ai/dsh`, the CLI package a consumer installs, and requires every declared or referenced `@deepseek-ai/dsh-*` package to carry that one version. The default channel moved from `next` to `latest`; `--channel` still selects another tag and `--host-version` still pins a baseline explicitly and skips the registry.

The family-agreement rule is gone. The capability packages are still queried, so a declared name that the registry cannot answer for fails loudly, but they no longer vote on the baseline: their `latest` tags are first-publish placeholders rather than release facts, and only the anchor can name a released line.

## Alternatives considered

- **Keep `next` and accept `0.1.5-rc.3`.** Rejected by the owner: that prerelease will not be released, so the gate would demand a line nobody ships and block every commit until the tag moved again.
- **Per-package `latest`, one vote each.** Rejected: measured, the family disagrees across four placeholder versions, so the rule would turn each run into a failed resolution instead of a comparison.
- **Pin `--host-version 0.1.5-rc.2` at the three call sites.** Rejected: it stores the value the gate exists to keep current, and the next release would need a manual edit in three places. The reasoning that rejected a checked-in baseline file still applies.
- **Take the highest version across the family.** Rejected: it invents a release line from unrelated tags, and would align the plugin to an `alpha` publish.

## Consequences

- The baseline follows the version the maintainers publish as `latest`, so a `next` prerelease no longer blocks commits or releases on its own.
- A `latest` tag that stops moving freezes the baseline. The gate cannot tell a deliberate hold from an abandoned tag, so the pin advances only when the maintainers move `latest`.
- The gate no longer notices a partial `next` publish, because capability-package tags are no longer compared with each other. A package that ships without its siblings surfaces at install or run time instead.
- `--channel next` remains available for a deliberate check against the prerelease line, and `--host-version` covers the offline case.

## Related decisions

Partially supersedes [force the host dependency baseline to one release line before it can ship](2026-09-11-host-dependency-alignment-gate.md): the three gate points, the six rules, the two provisioning sections and the `--fix` behaviour remain in force; which tag defines the baseline, and whether the capability packages vote on it, change here.

The channel choice here is superseded in full by [resolve the alignment baseline from the prerelease candidate line](2026-09-23-next-channel-baseline.md): the anchor-package resolution, the provisioning rules and the `--fix` behaviour carry forward, while the default tag returns to `next` once the family's publish flow showed `latest` lagging behind the only line consumers install.
