# Internal boundary refinement

## Result

Two bundle-local modules improve ownership without changing the public package or frozen behavior. The starting checkpoint is 1c401e4.

[Session assembly](../../packages/market-bundle/src/session-extension.ts) owns per-agent gates, cached project readers, selection application, role queries and nested host registration. Its constructor registers nothing. The product entry mounts it once after catalog initialization.

[Suite queries](../../packages/market-bundle/src/application/suite-queries.ts) own source-qualified lookup, detail composition, authored document reads and document translation identity. The application facade retains its caller methods and supplies live read callbacks.

The product entry falls from 748 to 513 lines. The facade falls from 639 to 604 lines. The new modules add 304 and 112 lines. This change improves locality rather than total line count.

## Preserved semantics

Session initialization retains the same injected host scope. Publication precedes gate attachment and detached startup. Cleanup clears published guards, then awaits the selection runtime, awaits contributors, and releases gates. Parent and per-agent detached teardown remain unchanged.

Catalog invalidation still revokes selections, invalidates default skills, invalidates scoped contributors, requests shared mounts, then refreshes session contributors. The existing deadline behavior stays unchanged.

Suite reads retain the same user/project snapshot selection, missing-suite error, live diagnostics, locale reads, translation key, frontmatter handling and pending-field rules. No extra cache or persistence owner is introduced.

## Validation

| Evidence                                                                            | Observed result                                                            |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Full regression](internal-boundaries-2026-10-08-evidence/tests.txt)                | 197 files, 1,868 tests pass.                                               |
| [Identity comparison](internal-boundaries-2026-10-08-evidence/test-comparison.json) | All 1,863 previous test identities remain; five module tests added.        |
| [Standing gate](internal-boundaries-2026-10-08-evidence/gates.txt)                  | Type, lint, format, routes, architecture and host reuse pass.              |
| [Packed runtime](internal-boundaries-2026-10-08-evidence/artifact.txt)              | Build succeeds; isolated DSH completes selected and deselected Hook flows. |

[The session-module test](../../tests/session-extension-composition.test.ts) exercises inert construction and absent-host-service behavior. [The suite-query tests](../../tests/suite-queries.test.ts) exercise the read port directly. Existing root-entry and lifecycle assertions are unchanged.

Independent source review found no ordering or error-policy regression. Source inspection and executed tests are separate evidence. Live acceptance uses the extracted artifact with reused external dependencies, not a fresh registry installation.

## Deliberate limits

The package graph, public exports, dependency manifest, routes, UI behavior and persistent formats are unchanged. Overview/menu composition, legacy filter ownership and stronger shutdown guarantees remain outside this bounded change.

No Windows execution or live external-provider reliability test is claimed. The test log retains existing source-map and CodeMirror warnings.

## Dev Note

The packed test uses a private profile and loopback port. No host source or live profile is edited. No remote push or publication occurs. The test instance is stopped after evidence collection.
