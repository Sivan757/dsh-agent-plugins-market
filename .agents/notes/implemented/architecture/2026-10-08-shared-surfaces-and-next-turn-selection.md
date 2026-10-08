# Agent Note: Shared resource surfaces and next-turn selection

Status: implemented

## Problem

Settings and preset management expose the same resources. Different tab containers and card markup let their presentation drift. Busy rejection also forced users to wait before changing a selection.

## Decision

The settings page defines the shared presentation. ResourceTabs composes the host SegmentedTabs with one non-scrolling policy. Card helpers and HookResourceCard share identity, counts, warnings and detail actions. Both surfaces open the same detail components. The manager adds only its selection controls and preset operations.

Accept running-session changes as durable intent through known inbox envelopes. Record insertion and removal synchronously, then flush. Intent remains replayable but cannot block the natural turn boundary as pending input. Keep the committed selection active through the current user turn, including tool continuations and steering. Promote at a safe boundary. If the next request races promotion, preserve its message identities, finish its empty admission and retry after idle promotion.

The public selectionRevision token counts accepted requests. Sequential binding revisions still count transactions. Optional requestRevision on both transaction envelopes preserves the public token without changing replay numbering. Forks reset ownership and tokens.

## Alternatives considered

A second tab stylesheet keeps the drift mechanism. The host already owns tab focus, keyboard navigation and the indicator. Local code owns only the shared width policy. The host has no resource-card or Hook-detail domain model, so those compose existing card, Modal and DetailRows components.

A busy error contradicts the requested workflow. Immediate registration changes alter tools inside the current turn. The published pre-step and system-prompt assembly listeners receive tools that were already collected. Neither can safely replace registrations for that request.

Custom session events need an ignorable marker that the published append method does not expose. Known inbox envelopes preserve compatibility. A third binding phase complicates incomplete-transaction recovery, so intent uses a separate source kind.

A memory-only intent loses acknowledged edits on restart. Reusing the binding revision as the request token lets repeated deferred edits regress after promotion. Separate counters retain strict concurrency checks and old replay rules.

## Consequences

A raced admission can leave a zero-step completed turn in the journal. It creates no model request or explanatory banner. Persistence or application failures remain visible through existing error and recovery controls.

This partially supersedes the edit-isolation rule in [extension presets](../../proposed/feature/2026-10-05-agent-extension-presets.md). Only an edit initiated for the selected session follows that session. Other sessions remain detached. The [policy and recovery decision](2026-10-08-policy-and-recovery-stability.md) retains state ownership and explicit failure recovery.

## Verification

See [the acceptance ledger](../../../../docs/reference/acceptance-fixes-2026-10-08.md). Regressions cover exact input identity, current-turn stability, request tokens, replay, forks, shared tabs and individual Hook details.
