# Agent Note: Declare a host support window, not a caret anchor

Status: implemented

## Problem

Every consumer-facing host pin carried `^<baseline>`, where the baseline is the version the `next` dist-tag names at that moment. A caret on a prerelease is an anchor, not a contract: `^0.2.1-rc.2` admits `0.2.1-rc.2` and later, and rejects `0.2.1-rc.1`, the candidate the host had published the day before.

The host enforces the declaration. On startup it evaluates a plugin's `engines.dsh` when present, otherwise every `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` peer, with prereleases admitted (harness `packages/boot/app-boot/src/plugin-compatibility.ts`). An unmet range marks the plugin row 异常 in the plugin manager and warns that running it may crash or lose data. Measured on 2026-10-17: the installed Desktop host is `0.2.1-rc.1`, the pinned peer range was `^0.2.1-rc.2`, and that pair is incompatible. The same tree also had to keep working on `0.2.0-rc.2`, which a caret on a later patch can never admit.

## Decision

`scripts/check-host-alignment.mjs` declares one support window, `>=0.2.0-rc.2 <0.3.0-0`, and every peer and provisioned dependency carries it verbatim.

- The floor is the oldest host release this code runs on. It moves only when the plugin drops a line on purpose.
- The ceiling excludes the next major line, including its prereleases: `<0.3.0-0` rather than `<0.3.0`.
- `devDependencies` keep the exact baseline from the `next` channel, because that mirror is what this repository builds and tests against.
- The gate fails when the resolved baseline falls outside the window, so a channel that moves past the ceiling stops the release instead of silently pinning a version the shipped range refuses.

## Alternatives considered

- **Keep the caret and re-release for every host candidate.** Rejected: it makes each host candidate a plugin release, and it still cannot keep two lines working at once.
- **Declare `*` or `>=0`.** Rejected: it claims support for host lines the plugin never ran against, which is the failure mode the gate exists to prevent.
- **Rely on `engines.dsh` alone.** Rejected: the host treats a declared `engines.dsh` as the only requirement and ignores peers, and this gate reads peers. Adding it would create a second source of truth the gate cannot check. Peers stay the declared contract.
- **Widen the range without teaching the gate.** Rejected: the next `--fix` run would rewrite the window back to a caret, so the policy lives in the gate, not in a comment.

## Consequences

- A host candidate between the floor and the ceiling works without a release here, which is the point of a range.
- Dropping a host line is now a deliberate edit of `HOST_SUPPORT_FLOOR`, visible in review.
- Crossing `0.3` requires moving `HOST_SUPPORT_CEILING`; the gate refuses to align until then.
- The claimed window is wider than any single verified host: the floor is verified by the published `0.2.0-rc.2` suite run, the ceiling by the current baseline. Versions in between are claims, not test results.

## Related decisions

Partially supersedes the pin rule in [force the host dependency baseline to one release line before it can ship](../process/2026-09-11-host-dependency-alignment-gate.md); its detection surface, fix machinery, and three gate sites still stand. Keeps the channel default from [resolve the alignment baseline from the prerelease candidate line](../process/2026-09-23-next-channel-baseline.md), which now decides only the dev mirror.
