---
kind: reference
title: Version scope and readiness audit
date: 2026-10-07
status: audit-complete-not-release-ready
---

# Version scope and readiness audit

## Summary

Follow-up: [the repair and isolated acceptance report](version-repair-2026-10-07.md) records fixes and new evidence after this audit. The findings below preserve the pre-repair state.

This version contains substantial implementation and test work, but it is not ready for release. An individual Hook switch does not control execution.

The existing regression suite passes all 1,845 tests. An additional audit reproduction fails through the real plugin entry and preset routes. These results coexist because the existing Hook tests enforce suite-level selection, not the new individual-Hook contract. See [full-tests.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/full-tests.txt) and [hook-reproduction.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/hook-reproduction.txt).

The evidence supports an integrated development version with unfinished acceptance, not an empty prototype. It does not support a numerical completion percentage.

## Contents

- [Scope and evidence](#scope-and-evidence)
- [Capability map](#capability-map)
- [Requirements and boundaries](#requirements-and-boundaries)
- [Confirmed findings](#confirmed-findings)
- [Standards review](#standards-review)
- [Specification review](#specification-review)
- [Validation results](#validation-results)
- [Acceptance sequence](#acceptance-sequence)
- [Dev Note](#dev-note)

## Scope and evidence

The user selected every change since v0.9.0, including uncommitted work. The audit compares three distinct states. [metadata.txt:3-12](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/metadata.txt#L3-L12) records their identities.

| State                  | Identity               | Meaning                                                           |
| ---------------------- | ---------------------- | ----------------------------------------------------------------- |
| Released baseline      | v0.9.0, 88643af        | Remote main and the release tag point here.                       |
| Committed development  | dev, 20a83e0           | 79 commits after the baseline, one commit ahead of remote dev.    |
| Current implementation | HEAD plus working tree | 112 modified tracked paths and 91 untracked paths at audit start. |

The committed delta touches 257 paths. The current tracked delta touches 272 paths, with 28,899 insertions and 2,249 deletions. These counts exclude untracked content. Untracked text adds 18,160 split-line records, including 4,404 under source and 9,562 under tests. Counts measure scope, not quality. [metadata.txt:8-12](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/metadata.txt#L8-L12) and [commits.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/commits.txt) preserve the accounting.

Session extension presets and their runtime are uncommitted. Translation, Team entry, interface refinements, and catalog changes span committed work and further local changes. The package still declares version 0.9.0. The implementation plan explicitly says “Not released.” See [package.json:5](/Users/sivan/workspace/dsh-agent-plugins-market/package.json#L5) and [agent-extension-presets-implementation.md:3](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/design/agent-extension-presets-implementation.md#L3).

Evidence labels in this report mean:

- Source inspection: the reviewer read the current implementation. This does not establish behavior in the live GUI.
- Tested today: the Lead executed the named automated test or command against this source or its isolated copy.
- Historical record: a previous acceptance note or remote run describes another execution, not today's current-version acceptance.
- Not established: this audit lacks the environment or evidence needed for the claim.

Three independent reviewers covered scope, runtime correctness, and translation/standards. The Lead reviewed their findings and ran validation. No product source, host source, profile, dependency installation, commit, or remote repository changed. Audit reports and evidence are the only repository additions. [metadata.txt:22-24](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/metadata.txt#L22-L24).

## Capability map

The table separates existing foundations from new scope. “Implemented” means current-tree code exists with the stated evidence, not that a release shipped.

| Capability | User outcome and version scope | Current state | Evidence |
| --- | --- | --- | --- |
| Marketplace foundations | Sources, installation, ten layout dialects, skills, commands, roles, MCP, and LSP remain the foundation. They are not all new features in this delta. | Existing product, broadly regression-tested today. External service connections are not comprehensively retested. | [README.zh.md:56-68](/Users/sivan/workspace/dsh-agent-plugins-market/README.zh.md#L56-L68); [CHANGELOG.md:12-31](/Users/sivan/workspace/dsh-agent-plugins-market/CHANGELOG.md#L12-L31); [full-tests.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/full-tests.txt) |
| Role-aware Agent Teams | A role can create a native Team member with its instructions and model route. Team tools retain membership, messaging, and task ownership. | Implemented. Automated tests cover restoration, cancellation, concurrent creation, and Lead-only access. No new paid-model acceptance today. | [teammate-role.test.ts:202-230](/Users/sivan/workspace/dsh-agent-plugins-market/tests/teammate-role.test.ts#L202-L230); [teammate-role.test.ts:305-343](/Users/sivan/workspace/dsh-agent-plugins-market/tests/teammate-role.test.ts#L305-L343); [teammate-role.test.ts:633](/Users/sivan/workspace/dsh-agent-plugins-market/tests/teammate-role.test.ts#L633); [full-tests.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/full-tests.txt) |
| Separate Team guidance | Lead and member instructions do not depend on the specialty-role list. Guidance does not grant permission to create a Team. | Implemented in uncommitted work. Scope, disposal, and duplicate-section tests pass. | [team-coordination.ts:28-54](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/agents/team-coordination.ts#L28-L54); [team-coordination.test.ts:226-280](/Users/sivan/workspace/dsh-agent-plugins-market/tests/team-coordination.test.ts#L226-L280) |
| Workspace preset library | Save reusable extension choices, choose a new-session default, and copy choices between workspaces without credentials. | Implemented, uncommitted. Revision conflicts, corrupt state, independent libraries, and transfer validation have passing tests. | [extension-presets.ts:18-31](/Users/sivan/workspace/dsh-agent-plugins-market/src/contracts/extension-presets.ts#L18-L31); [extension-presets.ts:94-110](/Users/sivan/workspace/dsh-agent-plugins-market/src/contracts/extension-presets.ts#L94-L110); [extension-preset-store.test.ts:19-70](/Users/sivan/workspace/dsh-agent-plugins-market/tests/extension-preset-store.test.ts#L19-L70) |
| Detached session selection | Existing sessions retain their choices when a preset changes. Explicit selection occurs while idle. | Implemented, uncommitted. Tests cover initial-send ordering, detached snapshots, durable recovery, and failed commits. | [extension-acceptance.test.ts:95-172](/Users/sivan/workspace/dsh-agent-plugins-market/tests/extension-acceptance.test.ts#L95-L172); [extension-session-transaction.test.ts:96-138](/Users/sivan/workspace/dsh-agent-plugins-market/tests/extension-session-transaction.test.ts#L96-L138); [extension-session-recovery.test.ts:120-137](/Users/sivan/workspace/dsh-agent-plugins-market/tests/extension-session-recovery.test.ts#L120-L137) |
| Runtime capability isolation | Selected skills, commands, roles, MCP, and LSP affect the relevant session. One session does not stop another session's shared server. | Substantial implementation and passing integration tests. Individual Hooks are an exception and fail the audit reproduction. | [scoped-contributors.ts:60-117](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/host/scoped-contributors.ts#L60-L117); [extension-shared-demand.test.ts:74-100](/Users/sivan/workspace/dsh-agent-plugins-market/tests/extension-shared-demand.test.ts#L74-L100); [hook-reproduction.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/hook-reproduction.txt) |
| Preset manager | One composer entry opens the preset menu and manager. Resource details stay separate from global credentials and configuration. | Implemented with component tests. Earlier isolated browser notes exist. Current authenticated GUI delivery is not established today. | [index.ts:69-85](/Users/sivan/workspace/dsh-agent-plugins-market/src/client/index.ts#L69-L85); [client-extension-preset-v5.test.ts:123-266](/Users/sivan/workspace/dsh-agent-plugins-market/tests/client-extension-preset-v5.test.ts#L123-L266); [agent-extension-presets-implementation.md:52-66](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/design/agent-extension-presets-implementation.md#L52-L66) |
| Description and document translation | Translate prose into Chinese or English. Preserve names. Offer original, translated, and bilingual document views. | Implemented with extensive tests. Partial output can retire a provider for the process, as reproduced below. | [README.zh.md:69](/Users/sivan/workspace/dsh-agent-plugins-market/README.zh.md#L69); [document-chunks.test.ts:104-226](/Users/sivan/workspace/dsh-agent-plugins-market/tests/document-chunks.test.ts#L104-L226); [translation-reproduction.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/translation-reproduction.txt) |
| Translation lifecycle | Translate on demand, bound provider calls, retain local cache, cancel disabled work, and reset failures explicitly. | Implemented. Existing cancellation, reset, cache, and lazy-read tests pass. Live translation quality and network reliability are not measured today. | [chain.ts:37-40](/Users/sivan/workspace/dsh-agent-plugins-market/src/application/translation/chain.ts#L37-L40); [localizer.ts:256-305](/Users/sivan/workspace/dsh-agent-plugins-market/src/application/translation/localizer.ts#L256-L305); [full-tests.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/full-tests.txt) |
| Command identity and menus | Avoid command-name collisions and translate menu descriptions without renaming invocation identifiers. | Implemented in committed and local changes. Regression tests pass. | [commits.txt:4-6](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/commits.txt#L4-L6); [menu-row-faces.ts](/Users/sivan/workspace/dsh-agent-plugins-market/src/client/menu-row-faces.ts); [full-tests.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/full-tests.txt) |
| Hooks panels | Show hook declarations, group preset rows by event, and explain unsupported events. Settings gain a seventh top-level tab. | Partially complete. Presentation exists, individual enablement is not enforced, and full Claude Code behavior is not supported. | [PluginWorkspace.tsx:23-26](/Users/sivan/workspace/dsh-agent-plugins-market/src/client/workspace/PluginWorkspace.tsx#L23-L26); [extension-inventory.ts:194-243](/Users/sivan/workspace/dsh-agent-plugins-market/src/application/extension-inventory.ts#L194-L243); [extension-hooks.ts:37-44](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/surfaces/extension-hooks.ts#L37-L44) |
| Manifest-free skill aggregation | Present eligible nested skill collections as one installable suite, without merging explicitly declared plugins. | Implemented in local commit 20a83e0. Eight focused regression cases pass in the full run. | [scan-resolvers.ts:298-321](/Users/sivan/workspace/dsh-agent-plugins-market/src/catalog/scan-resolvers.ts#L298-L321); [skill-source-aggregation.test.ts:53-153](/Users/sivan/workspace/dsh-agent-plugins-market/tests/skill-source-aggregation.test.ts#L53-L153) |
| Interface and read-path refinement | Reduce duplicate headings and overlays, reuse service forms and card anatomy, and read documents when expanded. | Implemented across many small commits. Build and component tests pass. Current GUI geometry is not retested today. | [commits.txt:7-55](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/commits.txt#L7-L55); [market-detail-document-lazy.test.ts](/Users/sivan/workspace/dsh-agent-plugins-market/tests/market-detail-document-lazy.test.ts); [build.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/build.txt) |
| Settings consolidation | Consolidate settings ownership without changing host code. | Proposed only. The plan says implementation did not start. Exclude it from delivered scope. | [settings-consolidation.md:3-7](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/design/settings-consolidation.md#L3-L7) |
| Full hooks compatibility and cross-session research | Research possible additions beyond the supported lifecycle subset. | Research or future scope, not shipped functionality. | [hooks-support-gap-analysis.md:3-14](/Users/sivan/workspace/dsh-agent-plugins-market/docs/scratch/hooks-support-gap-analysis.md#L3-L14); [cross-session-messaging-design.md](/Users/sivan/workspace/dsh-agent-plugins-market/docs/scratch/cross-session-messaging-design.md) |

## Requirements and boundaries

The current product model uses a workspace-private library and a detached choice per session. A default seeds new sessions, not existing ones. A valid resource disabled globally can be explicitly selected by a preset. Uninstalled, invalid, or unsupported resources remain unavailable. Host-managed or foreign MCP stays globally managed. These distinctions matter more than a generic “enabled” label. [usage.md:18-28](/Users/sivan/workspace/dsh-agent-plugins-market/docs/user/usage.md#L18-L28).

A preset is not the host's base Agent preset. Transfer contains names and resource identifiers, not credentials or server configuration. [usage.md:20-27](/Users/sivan/workspace/dsh-agent-plugins-market/docs/user/usage.md#L20-L27) and [extension-presets.ts:94-110](/Users/sivan/workspace/dsh-agent-plugins-market/src/contracts/extension-presets.ts#L94-L110).

The legacy workspace filter is a one-time migration input for existing sessions without a snapshot. New sessions capture global defaults. Old resource-window routes and storage still exist, but the composer registers the new entry. This is migration debt, not evidence that a current six-switch UI regressed. [agent-extension-presets-implementation.md:104](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/design/agent-extension-presets-implementation.md#L104); [extension-runtime.ts:272-292](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/host/extension-runtime.ts#L272-L292); [index.ts:690-720](/Users/sivan/workspace/dsh-agent-plugins-market/src/index.ts#L690-L720); [index.ts:79-82](/Users/sivan/workspace/dsh-agent-plugins-market/src/client/index.ts#L79-L82).

Hook registration does not mean full event compatibility. The runtime implements seven interception points. It omits input rewriting, systemMessage application, and run-level halt. SubagentStop is observation-only. Notification is labeled partial in the UI, but the current runtime has no Notification point. SessionEnd and PreCompact are also non-executing declarations. [extension-hooks.ts:27-44](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/surfaces/extension-hooks.ts#L27-L44); [extension-presets.ts:35-58](/Users/sivan/workspace/dsh-agent-plugins-market/src/contracts/extension-presets.ts#L35-L58).

Project LSP remains unsupported. The audit does not propose host changes to bypass that boundary. [extension-suite-selection.ts:40-43](/Users/sivan/workspace/dsh-agent-plugins-market/src/application/extension-suite-selection.ts#L40-L43).

## Confirmed findings

### Individual Hook switches do not stop execution

Priority: release blocker. Evidence: source inspection and two isolated reproductions, including the real plugin entry and public preset routes.

The reproduction creates a user Hook and two sessions in one workspace. A selected Hook dispatches once. The empty sibling dispatches nothing. A new preset then retains the parent suite but omits the Hook identifier. The route reports ready, and the session selection excludes the Hook. The next tool event still dispatches the command. [hook-reproduction.test.ts.txt:236-255](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/hook-reproduction.test.ts.txt#L236-L255) and [hook-reproduction.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/hook-reproduction.txt).

The reproduction uses a recording shell. It records the dispatch request without executing the command in the operating system. It uses the actual plugin composition, selection routes, projection, and hook lifecycle.

The client removes only the child identifier. The projection never filters hooks by that identifier. Runtime authorization tests only the parent suite. [resource.ts:22-33](/Users/sivan/workspace/dsh-agent-plugins-market/src/client/features/extension-presets/resource.ts#L22-L33); [extension-suite-selection.ts:24-54](/Users/sivan/workspace/dsh-agent-plugins-market/src/application/extension-suite-selection.ts#L24-L54); [scoped-contributors.ts:116-118](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/host/scoped-contributors.ts#L116-L118); [extension-hooks.ts:255-271](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/surfaces/extension-hooks.ts#L255-L271).

The existing acceptance test explicitly says that hooks follow the suite grant. The new manager contract promises individual selectable command hooks. Both tests and UI can pass while this connection remains missing. [extension-acceptance-scoped-effects.test.ts:236-256](/Users/sivan/workspace/dsh-agent-plugins-market/tests/extension-acceptance-scoped-effects.test.ts#L236-L256); [agent-extension-presets-implementation.md:98](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/design/agent-extension-presets-implementation.md#L98).

Required outcome: a deselected Hook never dispatches, even when its parent or sibling remains selected. Add per-Hook projection and execution authorization, then retain the reproduction as a regression test. Until that outcome passes, disable the entire parent suite or exclude the individual-Hook control from release scope.

### One invalid translation can disable an otherwise healthy provider

Priority: resolve before claiming reliable fallback. Evidence: source inspection and a deterministic audit test with synthetic provider answers.

One description returns a valid translation. Another drops a protected URL placeholder. The masking wrapper rejects the entire batch. The chain marks that provider failed for the process. A later healthy batch never calls it. [translation-providers.ts:58-70](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/host/translation-providers.ts#L58-L70); [chain.ts:90-125](/Users/sivan/workspace/dsh-agent-plugins-market/src/application/translation/chain.ts#L90-L125); [translation-reproduction.test.ts.txt:6-14](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/translation-reproduction.test.ts.txt#L6-L14); [translation-reproduction.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/translation-reproduction.txt).

This does not demonstrate that a live provider frequently damages placeholders. It demonstrates the consequence when one does. A subsequent provider can translate the batch, or the application can retain authored text. Resetting failures or clearing the cache restores eligibility. [localizer.ts:256-305](/Users/sivan/workspace/dsh-agent-plugins-market/src/application/translation/localizer.ts#L256-L305).

Required outcome: one invalid slot cannot discard valid sibling translations or indefinitely suppress healthy future batches without an explicit, visible policy. Preserve placeholder validation while separating malformed text from an unreachable provider.

### Current-version cross-platform acceptance is missing

Priority: release gate. Evidence: remote Windows failure, not a current Windows execution.

The latest remote dev run at c19f08a fails two tests. One compares a slash-built favorites path against Windows path.join output. The current implementation retains that construction. This establishes a portability failure in the path contract, not a demonstrated loss of saved data. [resource-favorites.ts:18-19](/Users/sivan/workspace/dsh-agent-plugins-market/src/application/state/resource-favorites.ts#L18-L19); [resource-window-state.test.ts:90](/Users/sivan/workspace/dsh-agent-plugins-market/tests/resource-window-state.test.ts#L90); [windows-failure-excerpt.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/windows-failure-excerpt.txt).

The other failure concerns catalog behavior when a role directory becomes a regular file. Its current implementation changed after that run. Do not declare it fixed or classify it as a production defect without a current Windows run. The original run is [Windows CI](https://github.com/Sivan757/dsh-agent-plugins-market/actions/runs/37288684706).

### Documentation does not describe one coherent current version

Priority: acceptance documentation.

Both READMEs still promise six workspace tabs, while source declares seven. The usage guide describes a Local configuration tab that the implementation plan removes. [README.md:67-97](/Users/sivan/workspace/dsh-agent-plugins-market/README.md#L67-L97); [README.zh.md:67-97](/Users/sivan/workspace/dsh-agent-plugins-market/README.zh.md#L67-L97); [PluginWorkspace.tsx:23-26](/Users/sivan/workspace/dsh-agent-plugins-market/src/client/workspace/PluginWorkspace.tsx#L23-L26); [usage.md:22](/Users/sivan/workspace/dsh-agent-plugins-market/docs/user/usage.md#L22); [agent-extension-presets-implementation.md:96-98](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/design/agent-extension-presets-implementation.md#L96-L98).

The preset proposal retains an earlier authority statement while the implementation plan records one-time legacy capture. Keep one current requirement owner and mark superseded details. This inconsistency explains why a reader cannot reliably infer completion from the document labels. [2026-10-05-agent-extension-presets.md:21](/Users/sivan/workspace/dsh-agent-plugins-market/.agents/notes/proposed/feature/2026-10-05-agent-extension-presets.md#L21); [agent-extension-presets-implementation.md:104](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/design/agent-extension-presets-implementation.md#L104).

### Secondary risks and decisions

These items do not replace the confirmed Hook blocker.

| Item | Evidence and limit | Required disposition |
| --- | --- | --- |
| Recovery leaves queued input parked | The passing recovery test sends another user message after recovery before asserting model activity. [extension-session-recovery.test.ts:125-137](/Users/sivan/workspace/dsh-agent-plugins-market/tests/extension-session-recovery.test.ts#L125-L137). The guard preserves input intentionally. [extension-session-state.ts:125-142](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/host/extension-session-state.ts#L125-L142). | Decide whether recovery resumes queued input or asks for an explicit Continue action. Do not call this data loss or promise automatic progress. |
| Disposed Agent retained in a map | appliedEpochs records an Agent key but the disposal listener omits its deletion. [extension-runtime.ts:76-105](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/host/extension-runtime.ts#L76-L105). Source inspection only. | Remove the key on disposal and add lifecycle evidence. Retained memory size is not measured. |
| Repeated session-log scans | The window scans snapshotEvents on each read, and the client schedules another read after 2,500 ms. [extension-runtime.ts:294-305](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/host/extension-runtime.ts#L294-L305); [use-window.ts:23-38](/Users/sivan/workspace/dsh-agent-plugins-market/src/client/features/extension-presets/use-window.ts#L23-L38). | Measure long sessions before making performance claims. This is roughly one poll per 2.5 seconds, not twice per second. |
| Provider identity duplicated | The composition root fixes the chain key while another module builds the chain. [index.ts:385](/Users/sivan/workspace/dsh-agent-plugins-market/src/index.ts#L385); [translation-providers.ts:137-151](/Users/sivan/workspace/dsh-agent-plugins-market/src/runtime/host/translation-providers.ts#L137-L151). | Derive the identity or document a versioned cache policy. This is a future-change hazard, not a demonstrated current cache collision. |
| Retained legacy APIs | Old routes and favorite writes remain beside the new session model. [index.ts:690-720](/Users/sivan/workspace/dsh-agent-plugins-market/src/index.ts#L690-L720). | Define migration compatibility and removal scope. Do not present retained code as a second active user model. |

## Standards review

The architecture and host-reuse gates pass. Dependency versions align with the published next baseline. The code contains explicit workspace ownership, revisioned persistence, and scoped capability checks. These are concrete engineering safeguards. [static-gates.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/static-gates.txt) and [extension-presets.ts:94-110](/Users/sivan/workspace/dsh-agent-plugins-market/src/contracts/extension-presets.ts#L94-L110).

The hard standards failures are the formatting gate and stale behavior documentation. The repo requires bilingual changes and documentation with code. [AGENTS.md:60-64](/Users/sivan/workspace/dsh-agent-plugins-market/AGENTS.md#L60-L64). The two formatting failures are [routes-extension-presets.ts](/Users/sivan/workspace/dsh-agent-plugins-market/src/routes-extension-presets.ts) and [client-hooks-status-panel.test.ts](/Users/sivan/workspace/dsh-agent-plugins-market/tests/client-hooks-status-panel.test.ts). [static-gates.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/static-gates.txt) records the exact output.

The reviewer also identified duplicate translation identity ownership and retained legacy abstractions. Treat these as maintenance judgments, not proof that the whole design is over-engineered. Host reuse and explicit isolation provide reasons for much of the runtime structure.

Standards summary: five measured static gates pass, one measured formatting gate fails, and user-facing documentation has two concrete current-state contradictions.

## Specification review

The user request did not supply one originating specification. The audit reconstructed scope from the current usage guide, decisions, implementation plan, and commit history. It does not infer approval for every implemented feature.

The session library, detached snapshots, portable transfer, scoped registration, and translation workflow have implementations and passing tests. Individual-Hook enablement fails its stated contract. Full Claude Code hook compatibility and settings consolidation remain outside delivered scope. [usage.md:18-28](/Users/sivan/workspace/dsh-agent-plugins-market/docs/user/usage.md#L18-L28); [agent-extension-presets-implementation.md:98](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/design/agent-extension-presets-implementation.md#L98); [settings-consolidation.md:3](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/design/settings-consolidation.md#L3).

Specification summary: one confirmed execution-control violation blocks release. Recovery interaction and migration cleanup need explicit acceptance decisions. Current authenticated-GUI delivery remains unverified.

## Validation results

All local commands use bundled Node v24.21.0. CI declares Node 22. The build uses an isolated source copy and the existing dependency installation. [metadata.txt:13-18](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/metadata.txt#L13-L18).

| Validation | Result today | Scope and limitation |
| --- | --- | --- |
| Full Vitest run | 192 files, 1,845 tests pass | Existing regression suite, not universal feature completeness. [full-tests.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/full-tests.txt). |
| Type checks | Pass | Source, client, and both test projects. [static-gates.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/static-gates.txt). |
| ESLint | Pass | Source and tests. [static-gates.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/static-gates.txt). |
| Formatting | Fail | Two existing files. No automatic formatting applied. [static-gates.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/static-gates.txt). |
| Architecture | Pass | 236 modules and 911 dependencies. [static-gates.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/static-gates.txt). |
| Host reuse | Pass | 60 ledger rows and 344 published export names. [static-gates.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/static-gates.txt). |
| Host alignment | Pass | 36 packages against next baseline 0.2.0-rc.2. [static-gates.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/static-gates.txt). |
| Build | Pass | Exact build script in isolated copy. Live artifacts unchanged. [build.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/build.txt). |
| Whitespace diff | Pass | git diff --check, recorded in audit execution. |
| Individual Hook acceptance | Fail | Two audit reproductions. The preserved root-entry case records unintended dispatch. [hook-reproduction.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/hook-reproduction.txt). |
| Translation failure behavior | Reproduced | Synthetic answers establish batch rejection and later provider skipping. This test passes because it asserts the problematic behavior. [translation-reproduction.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/translation-reproduction.txt). |
| Actual GUI | Not accepted | HTTP 401 and authentication screen at port 19387. No authentication bypass or replacement server. [metadata.txt:17-19](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/metadata.txt#L17-L19). |
| Windows | Current state not tested | Latest remote run fails on an older SHA. [windows-failure-excerpt.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/windows-failure-excerpt.txt). |
| Fresh dependency installation | Not performed | No frozen-lockfile installation in a clean environment today. |
| Live network providers and language servers | Not comprehensively exercised | Unit/integration doubles do not establish real OAuth, service, or translation availability. |

The passing suite emits a missing source-map warning from the published UI package and CodeMirror getClientRects errors in DOM tests. It exits successfully. Preserve those warnings as test-environment debt rather than describing the run as warning-free. [full-tests.txt](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/full-tests.txt).

Earlier isolated-browser acceptance records remain useful historical evidence. They explicitly exclude delivery to the authenticated GUI at port 19387. [agent-extension-presets-implementation.md:52-66](/Users/sivan/workspace/dsh-agent-plugins-market/docs/developer/design/agent-extension-presets-implementation.md#L52-L66).

## Acceptance sequence

Freeze the feature list before adding more controls. Use observable outcomes rather than an overall percentage.

| Order | Outcome | Acceptance evidence |
| --- | --- | --- |
| First | An individual deselected Hook never dispatches. | Real entry, preset routes, parent-on/child-off, sibling-on/child-off, and stale-call negative tests. |
| Second | Translation preserves valid siblings and recovers from provider failures. | Partial-invalid batches, later healthy batches, fallback, cancellation, and reset tests. |
| Third | The current source passes release gates on supported systems. | Formatting, clean frozen-lockfile installation, current Linux/Windows CI, and built-artifact validation. |
| Fourth | One current requirement document matches the UI and runtime. | Seven tabs, actual Hook subset, detached session selection, global-only resources, and migration scope. |
| Fifth | The exact build passes user-facing acceptance. | Authorized browser on the actual installation, two same-workspace sessions with opposite choices, defaults, recovery, and restart. |

A release acceptance record must identify the source revision and build. Test counts alone cannot identify a deployed artifact.

## Dev Note

This is a bounded release-delta audit, not a proof of all paths or an exhaustive security review. It does not authorize fixes or release actions.

The three reviewers used read-only scopes. The Lead corrected preliminary reviewer overstatements about legacy-switch regression, change counts, and polling frequency. The Lead independently reproduced the Hook defect and the translation failure policy. Historical acceptance remains separate from tests performed today.

Raw evidence preserves original tool output, including quoted warnings. Reproduction source is stored as text so ordinary test discovery does not run audit-only fixtures. The temporary executable copies remain under the directory recorded in [metadata.txt:24](/Users/sivan/workspace/dsh-agent-plugins-market/docs/reference/version-audit-2026-10-07-evidence/metadata.txt#L24).
