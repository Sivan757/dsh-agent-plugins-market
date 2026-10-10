# Behavior freeze before domain packaging

## Scope

This checkpoint records the settled feature behavior before the domain-workspace refactor. It is a local development baseline, not a release.

The public installation name remains `dsh-agent-plugins-market`. The root export, client entry, bundle patch, settings namespace and storage formats remain compatible.

## Frozen behavior

- Sources, dialect precedence, suite identities and install state retain their existing semantics.
- Session choices remain detached from preset edits. Only explicit reselection changes an existing session.
- The experimental Agent preset entry defaults to off. Its switch controls visibility only, not session authorization or routes.
- User and project Hooks require their individual selected identifiers. Installed suite Hooks retain parent selection.
- Shared MCP and LSP demand remains per owner. Releasing one session does not stop another owner’s server.
- Translation changes descriptions and document prose, never names or model-facing prompts. Preserve current cancellation, cache, retry and original-text fallback behavior.
- An invalid translation slot does not discard valid siblings. A wholly invalid batch still rejects.
- Preserve the seven workspace tabs, current labels, service editors and default presentation.
- Preserve current recovery and legacy migration behavior. Architecture work does not silently redesign either.

## Verification

The standing `check:refactor` gate passes after baseline integration repairs. Type checks cover source, browser code and both test projects. Architecture and host-reuse gates pass.

The full suite reports 194 files and 1,860 passing tests after fixture alignment. An isolated build succeeds. Frozen-lockfile metadata validation succeeds without executing installation scripts.

The test inventory captured before migration is the comparison baseline. Structural changes must preserve every existing test identity and assertion, apart from path and import updates.

The earlier [isolated acceptance](version-repair-2026-10-07.md) proves individual-Hook execution and session isolation. It predates the experimental entry switch. Current gate tests cover that switch; final packed-artifact acceptance must exercise it again.

## Baseline integration repairs

The shared Hook event grouping module moves out of a sibling feature into shared UI. Its behavior and two consumer call shapes stay unchanged.

Test fixtures include the new setting reference. Subscription tests expect one subscription for each of the translation and preset bindings. Disposal still requires zero subscriptions.

The README pair and usage pair state the experimental entry default. A duplicate test-environment annotation and formatting artifacts are removed.

## Refactor contract

Use private domain workspace packages in one repository. Keep one public installation artifact and one release workflow. Do not publish private packages independently.

Separate behavior changes from structural commits. Keep host code and the live profile unchanged. A passing source test is not evidence that a packed installation works.
