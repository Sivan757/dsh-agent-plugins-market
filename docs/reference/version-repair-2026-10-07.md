# Version repair and isolated acceptance

## Summary

The confirmed individual-Hook defect is repaired and passes a real isolated DSH test. Translation batch isolation and disposed-Agent cleanup also pass regression tests.

The shared working tree is not release-ready. Concurrent Hooks-panel changes still fail type and architecture checks. One concurrent test file still fails formatting.

The isolated build includes one documented label adjustment that does not exist in the shared tree. Do not describe that build as an exact shared-tree artifact. [live-acceptance.txt:8-10](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/live-acceptance.txt#L8-L10).

## Scope

The user authorized testing and repair through an independent profile and port. The test runs installed DSH 0.2.0-rc.2 on loopback port 54754.

A fresh DSH_HOME owns its profiles and session data. A separate Agent layout contains two harmless Hooks. Each Hook appends one marker to a temporary file. The local audit-mock/test adapter returns deterministic text through the published LlmAdapter. No external model request is needed. [live-acceptance.txt:1-7](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/live-acceptance.txt#L1-L7).

The installed CLI prints a tokenized URL. Opening it authenticates the isolated browser. The token and cookie remain outside repository evidence. No host code, live profile, live GUI on port 19387, commit, or remote repository changes. [live-acceptance.txt:6-7](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/live-acceptance.txt#L6-L7); [live-acceptance.txt:21-22](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/live-acceptance.txt#L21-L22).

## Repairs

| Repair | Implementation | Evidence |
| --- | --- | --- |
| Individual Hook authorization | Inventory and runtime share event-and-position identifiers. Dispatch requires parent and individual selection for user and project Hooks. | [extension-hook-selection.ts:29-56](/Users/sivan/workspace/dsh-agent-plugins-market/src/application/extension-hook-selection.ts#L29-L56); [scoped-contributors.ts:117-127](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/host/scoped-contributors.ts#L117-L127); [extension-hooks.ts:264-277](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/surfaces/extension-hooks.ts#L264-L277) |
| Stable Hook numbering | Projection does not compact command arrays. Non-matching groups still advance positions. | [extension-suite-selection.ts:45-48](/Users/sivan/workspace/dsh-agent-plugins-market/src/application/extension-suite-selection.ts#L45-L48); [extension-hooks.test.ts:478-516](/Users/sivan/workspace/dsh-agent-plugins-market/tests/extension-hooks.test.ts#L478-L516) |
| Partial translation isolation | An invalid slot stays empty. Valid siblings return normally. A wholly invalid batch still rejects. | [translation-providers.ts:77-84](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/host/translation-providers.ts#L77-L84); [translation-provider-partial.test.ts:30-93](/Users/sivan/workspace/dsh-agent-plugins-market/tests/translation-provider-partial.test.ts#L30-L93) |
| Resource path normalization | Standard node:path joining replaces manual separators. No dependency or state-format change. | [resource-favorites.ts:18-20](/Users/sivan/workspace/dsh-agent-plugins-market/src/application/state/resource-favorites.ts#L18-L20); [surface-toggles.ts:23-31](/Users/sivan/workspace/dsh-agent-plugins-market/src/application/state/surface-toggles.ts#L23-L31); [path-red.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/path-red.txt); [path-green.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/path-green.txt) |
| Disposed-Agent retention | The applied-epoch map deletes disposed Agents and clears on runtime disposal. Recovery behavior stays unchanged. | [extension-runtime.ts:98-106](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/host/extension-runtime.ts#L98-L106); [extension-runtime-maintenance.test.ts:88-102](/Users/sivan/workspace/dsh-agent-plugins-market/tests/extension-runtime-maintenance.test.ts#L88-L102); [lifetime-red.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/lifetime-red.txt); [lifetime-green.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/lifetime-green.txt) |
| Documentation alignment | Both READMEs describe seven tabs. The usage pair removes the obsolete local tab and names the Hook control boundary. | [README.md:67-104](/Users/sivan/workspace/dsh-agent-plugins-market/README.md#L67-L104); [README.zh.md:67-104](/Users/sivan/workspace/dsh-agent-plugins-market/README.zh.md#L67-L104); [usage.md:22](/Users/sivan/workspace/dsh-agent-plugins-market/docs/user/usage.md#L22) |

Installed market-suite Hooks retain their parent-suite contract because the session inventory publishes no individual rows for them. This repair does not silently invalidate existing presets. Full Hook compatibility remains out of scope. [2026-10-07-hook-selection-enforcement.md:11-31](/Users/sivan/workspace/dsh-agent-plugins-market/.agents/notes/implemented/bug-fix/2026-10-07-hook-selection-enforcement.md#L11-L31).

The path repair uses [Node path.join](https://nodejs.org/api/path.html#pathjoinpaths), which joins and normalizes platform-owned separators. This local regression does not replace a current Windows CI run.

## Real DSH acceptance

The same private profile first loads the defective baseline, then the repaired build. This preserves the session and its saved selection across a process restart.

| Scenario                                       | Observed result                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Baseline selects only Hook B                   | Both A and B append markers. The defect reproduces with real shell execution.            |
| Repaired build restores that session           | The saved selection remains unchanged. Only B appends a marker.                          |
| Browser disables B in the preset manager       | The UI reports saved and zero enabled Hooks. Existing session selection still retains B. |
| Browser explicitly reselects the edited preset | The session contains the parent only. A completed prompt appends no Hook marker.         |
| Second session selects only A at the same cwd  | Only A appends a marker. The first session remains parent-only.                          |
| Browser console inspection                     | No warning or error messages are reported by the query.                                  |

The ordered shell output is exactly A, B, B, A. The first two markers are baseline output. The third belongs to the repaired main session. The fourth belongs to the repaired sibling. [hook-calls.txt:1-4](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/hook-calls.txt#L1-L4).

The full setup, session identities, selection revisions, and observations are recorded in [live-acceptance.txt:11-20](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/live-acceptance.txt#L11-L20). This is performed acceptance, not a historical note or a source-only inference.

The tested server artifact SHA-256 is 06b1e6c1bcf81cd68d27d093b1e8e1e80f9f88ebbf5802bf70dc731ca460e3a4. The tested client artifact SHA-256 is 2f268b4f4f3a7d121f44c0974e69d57965272de412e7f179f36c0cffdda825fc. These fingerprints identify the isolated artifacts, not a released version.

## Validation

| Validation | Result | Limit |
| --- | --- | --- |
| Full regression suite | 193 files, 1,858 tests pass | [full-tests.txt:266-269](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/full-tests.txt#L266-L269). The source includes concurrent UI edits. |
| Translation-focused tests | New six-case regression and existing translation cases pass | New tests cover partial failures, protected placeholders, all-invalid rejection, and later healthy batches. [translation-provider-partial.test.ts:30-93](/Users/sivan/workspace/dsh-agent-plugins-market/tests/translation-provider-partial.test.ts#L30-L93). |
| Lifecycle and recovery | 16 tests pass | [lifetime-green.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/lifetime-green.txt). Cleanup tests fail before the repair. |
| Paths and surface storage | 17 tests pass | [path-green.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/path-green.txt). The added separator test fails before the repair. |
| Isolated plugin build | Pass | [build.txt:1-5](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/build.txt#L1-L5); [build.txt:37-42](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/build.txt#L37-L42). Includes the label-only adjustment described below. |
| Documentation site | Four pages build successfully | Astro output goes to a temporary directory. |
| Lint | Pass | [static-gates.txt:1-2](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/static-gates.txt#L1-L2). |
| Host reuse and alignment | Pass | [static-gates.txt:11-18](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/static-gates.txt#L11-L18). Baseline remains 0.2.0-rc.2. |
| Shared-tree typecheck | Fail | Concurrent Hooks panel calls a key outside its declared translation type. [typecheck.txt:1-4](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/typecheck.txt#L1-L4). |
| Shared-tree architecture | Fail | Preset ResourceList imports a sibling feature module. [static-gates.txt:3-9](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/static-gates.txt#L3-L9). |
| Shared-tree formatting | One remaining failure after owned files are formatted | [client-hooks-status-panel.test.ts](/Users/sivan/workspace/dsh-agent-plugins-market/tests/client-hooks-status-panel.test.ts). The file belongs to concurrent work and is left unchanged. |
| Current Windows run | Not performed | The prior remote failure is not a current-version result. |

Existing test output still contains the published UI source-map warning and CodeMirror DOM-test warnings. The passing suite is not warning-free. [full-tests.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-repair-2026-10-07-evidence/full-tests.txt).

## Remaining integration work

The shared tree contains a separate Hooks-panel refactor that appeared during this repair. Its type error occurs at [StatusPanel.tsx:104](/Users/sivan/workspace/dsh-agent-plugins-market/src/client/features/hooks/StatusPanel.tsx#L104). Its sibling-feature import occurs at [ResourceList.tsx:8](/Users/sivan/workspace/dsh-agent-plugins-market/src/client/features/extension-presets/ResourceList.tsx#L8).

A request for permission to edit the concurrent panel timed out. The shared file remains unchanged by this repair. For isolated runtime acceptance only, its label uses the existing workspaceTabHooks key. The runtime fixes are identical in the tested copy and shared source, apart from formatting.

The concurrent owner must resolve the translation type and place shared event grouping in an allowed shared module. Then run typecheck, architecture, formatting, and the exact shared-tree build. Keep current Windows acceptance separate.

Late concurrent edits also add agentPresetsEnabled to [settings.ts:45-46](../../../src/contracts/settings.ts#L45-L46) and [index.ts:117-118](../../../src/index.ts#L117-L118). They appeared after the tested snapshot. The 1,858-test result and isolated browser evidence do not cover these later edits. [Final typecheck output](version-repair-2026-10-07-evidence/final-typecheck.txt) records the last observed shared-tree state.

Recovery interaction, provider-chain identity, old resource-window removal, and long-session polling remain the decisions identified by the initial audit. This change does not redesign them.

## Decision records

The Hook decision is [2026-10-07-hook-selection-enforcement.md](/Users/sivan/workspace/dsh-agent-plugins-market/.agents/notes/implemented/bug-fix/2026-10-07-hook-selection-enforcement.md). It cross-links the active preset proposal rather than claiming the entire preset migration is complete.

The existing translation decision describes partial invalid answers in [2026-10-04-universal-translation-layer.md:48-54](/Users/sivan/workspace/dsh-agent-plugins-market/.agents/notes/implemented/feature/2026-10-04-universal-translation-layer.md#L48-L54). The bilingual counterpart changes in the same pass. No duplicate translation decision is created.

## Dev Note

This report closes the bounded repair and real isolated acceptance loop. It does not certify the entire version for release.

No source edits weaken tests or suppress the remaining shared-tree gates. No remote write occurs. The private test instance is stopped after evidence collection, and temporary data remains available for reproduction.
