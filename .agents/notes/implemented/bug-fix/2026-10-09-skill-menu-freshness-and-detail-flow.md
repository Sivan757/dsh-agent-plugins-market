# Agent Note: Refresh composer skills and preserve detail flow

Status: implemented

## Problem

Extension selection changes invalidate the server registry, but the published composer caches skill lists until a native preset event or connection reset. Reopening the menu can therefore show removed skills and omit new ones. Detail dialogs also apply a flex rule to every body child, which stretches unrelated sections and changes row orientation.

## Decision

Adapt the existing skill source. Read the published skills/list API for candidate requests and retain per-session snapshots for lexicons and previews. Keep host ranking and pick behavior. Explicitly refresh the public menu controller after the new list settles. A lexicon subscriber is not evidence that a menu subscriber exists.

Observe committed extension envelopes through the public SessionBinding event source. The window read joins the current selection writer before sampling readiness and revision. It never waits for the active user turn. Busy intent still grants nothing until its execution boundary.

Use one DetailModal content stack to own flex allocation and container queries. Do not apply column layout or flex growth to each caller block. The fixed settings frame, footer slots and shared detail components remain. Clear local validation before a valid save attempt so an old name error cannot hide the current server failure.

## Alternatives considered

Faster polling cannot clear the native skill cache. A connection reset or fake native preset event affects unrelated host state. The published skill client offers no public invalidation method, so a bounded source adapter replaces only its catalog-facing methods. It does not add a registry or menu.

The host owns skill RPC, ranking, input triggers, session event subscriptions and resource preview addresses. Reuse those APIs. The workspace-path utility has no browser module factory, so the client build includes its pure implementation instead of requesting it from the host module table.

Changing skill execution while a model turn is active violates the selected turn contract. Immediate discovery refresh follows committed state only. The current selection queue provides the required publication barrier without a new timer or waiter registry.

Per-feature height fixes preserve the broad selector that caused the layout defect. A shared content stack removes that cause while retaining each detail’s own row and section layout.

## Consequences

Candidate queries perform fresh local RPC reads. Cached snapshots support reference styling and previews, not authorization. Stale responses, disposed scopes and old service instances cannot publish a newer view. The compatibility adapter remains removable when the host exposes catalog invalidation.

This refines [shared resource surfaces and next-turn selection](../architecture/2026-10-08-shared-surfaces-and-next-turn-selection.md). It does not replace that decision’s authorization or durable transaction model. [The audit](../../../../docs/reference/skill-refresh-and-detail-audit-2026-10-09.md) distinguishes live backend evidence from controlled browser states.
