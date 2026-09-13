# Agent Note: Manifests fall back down the layout priority

Status: implemented

## Problem

Layout selection read the first existing manifest file and stopped there. A checkout whose highest-priority manifest was unparsable, or failed v1 validation, loaded nothing at all — even when a complete lower-priority manifest sat one directory over. One broken file made the whole source unusable.

## Decision

`readManifest` walks every manifest the directory carries (`detectManifests`), highest priority first, and returns the first candidate that parses and validates. A rejected candidate is diagnosed, and when a lower-priority manifest wins, those diagnostics are reported as fallback notes on the suite instead of failing it. A suite whose every candidate fails is still rejected.

Two earlier behaviours are unchanged: a root `plugin.json` without a recognized agent-plugins `$schema` is read leniently as Claude-compatible with `.claude-plugin/plugin.json` supplying missing component declarations, and marketplace catalogs already took the first catalog that produced suites.

## Alternatives considered

**Keep the highest-priority manifest even when invalid.** Rejected: it leaves the source unusable while a complete declaration exists one directory over.

**Merge declarations from every manifest.** Rejected: dialect identity would become ambiguous, and the existing root/plugin component fallback already covers the gap that motivated merging.

## Consequences

A repository can scan as a layout other than the one its most prominent manifest declares; the reason is visible in `SourceOverview.scanNotes`. Sample verdicts in the compatibility report are unchanged because every sampled repository's winning manifest is valid. `detectManifest` still returns the highest-priority candidate for identity callers such as `repoName`.

## Verification

`tests/layouts.test.ts` covers a v1 manifest rejected by schema validation with a Claude manifest winning underneath, the fallback note, and the all-candidates-invalid rejection; `tests/real-layouts.test.ts` and `tests/compat-report.test.ts` confirm the sampled repositories keep their recorded verdicts.
