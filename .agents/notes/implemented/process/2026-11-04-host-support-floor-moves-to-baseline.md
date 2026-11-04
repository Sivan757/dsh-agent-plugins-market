# Agent Note: The host support floor tracks the tested baseline

Status: implemented

## Problem

The support window every host pin carries was `>=0.2.0-rc.2 <0.3.0-0`. It was written on 2026-10-17, when `0.2.0-rc.2` was the candidate the host shipped, and it had not moved since.

That window states two facts: the oldest host release this code runs on, and the major line it never crosses. The first fact had stopped being true in any useful sense — this repository builds and tests against `0.2.1-rc.5`, and nothing in the pipeline ever ran against `0.2.0-rc.2`. A floor older than everything CI verifies is a promise with no evidence behind it, and it widens the matrix a consumer may believe is supported.

The host's candidate line has also settled: `@deepseek-ai/dsh` carries `latest` and `next` on the same `0.2.1-rc.5`, and no newer candidate has appeared.

## Decision

- **The floor becomes the tested baseline: `>=0.2.1-rc.5 <0.3.0-0`.** Every consumer-facing pin (25 peers and 6 self-provisioned dependencies) now starts at the version this repository builds against, so the claim matches the evidence.
- **The ceiling stays `<0.3.0-0`.** A host minor moves seams — `ctx.get` shapes, tool contracts, the surfaces this plugin mounts. "Feels stable" is not a compatibility guarantee across a minor, and the reuse ledger and seam probes are calibrated per minor.
- **The baseline channel stays `next`.** The recorded trigger for moving back to `latest` is the host's first stable release. It has not happened: `0.2.1-rc.5` is still a candidate, and the capability packages' `latest` tags are the `0.0.1-rc.1` first-publish placeholders, so a gate resolving `latest` would compare against a version nobody installs.

## What the narrower window removes

The old floor carried a workaround. The dev-only bridge declares the hook protocol as an exact peer, and semver resolved the old window to its floor `0.2.0-rc.2` — a different tuple from the bridge's `0.2.1-rc.5` — so a root `.pnpmfile.cjs` rewrote that one peer edge into a dependency edge and kept a nested copy alive. The old note recorded the exit condition: delete the hook when the floor reaches the bridge's line.

The new floor is that line. Both edges now name `0.2.1-rc.5`, `pnpm install` resolves one copy, and the hook, its own test, and the `pnpmfileChecksum` in the lockfile are gone. The lockfile test guards the end state instead: one protocol version, at the declared floor, with no hook that could hide a second one reappearing.

## Alternatives considered

- **Keep `0.2.0-rc.2` as a compatibility statement.** Rejected: nothing verifies it. A support range that no pipeline exercises cannot be defended when a consumer on that release reports a defect.
- **Widen the ceiling to `<0.4.0-0`.** Rejected: the plugin's host seams are resolved per minor (`ctx.get` shapes, tool contracts), and one minor is exactly where those change.
- **Switch the gate to `latest` now, since `latest` and `next` agree on the anchor.** Rejected: the agreement is specific to `@deepseek-ai/dsh`; the capability packages still carry `latest = 0.0.1-rc.1`, which is the failure the `next` decision recorded on 2026-09-23 exists to prevent.
- **Leave the floor alone and document the gap.** Rejected: the range is machine-readable and consumers act on it; a footnote does not narrow it.

## Consequences

- A consumer still on `0.2.0-rc.x` has to take one candidate step forward. Those are prereleases of the same `0.2` line, and the plugin's own release notes carry the change.
- Every future host candidate inside the window still works without a release here; the floor moves only when the plugin deliberately drops a release line.
- When the host cuts a stable release, the same change must repoint the gate's default channel to `latest` and raise the floor to that stable.

## Verification

- `pnpm run fix:host-alignment` rewrote the 31 declarations and the `minimumReleaseAgeExclude` entries; `pnpm install` refreshed `pnpm-lock.yaml`.
- `pnpm run check:host-alignment`: baseline `0.2.1-rc.5` on `next`, 37 packages, green.
- `pnpm run check:refactor`, the full test suite, and `pnpm run build` pass with the narrow window.
