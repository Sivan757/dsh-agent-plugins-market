# Refactor completion contract

## Final objective

Deliver one stable, maintainable plugin with enforced domain ownership, consistent persisted state, controlled resource lifetimes and reviewable defect repairs. Preserve intended product capabilities and public installation compatibility, not accidental defects.

Starting checkpoint: 92936ff. The earlier behavior-freeze and private-workspace decisions remain context. This phase explicitly permits confirmed logic repairs and evidence-backed simplification.

## Completion checklist

- [x] Workspace policy has one mutation owner. Mixed surface and entry changes cannot overwrite each other, failures do not publish unsaved state, and complete replacements are atomic.
- [x] Shutdown and reload prevent stale work from publishing or restarting owned resources. Resource teardown is bounded or explicitly reports failure, rather than silently leaking.
- [x] Recovery preserves queued input and makes the next action explicit. No silent duplicate requests or retry loop is introduced.
- [x] Proven redundant paths are removed or consolidated. Required legacy reads and compatibility remain documented and tested.
- [x] Long-session read work is measured. Material repeated work is reduced without introducing stale authorization or unnecessary caches.
- [x] Full gates, retained contract tests, added regressions and isolated packed-DSH acceptance pass. Every confirmed high-priority finding is closed with evidence.

The closed [review ledger](../../reference/refactor-review-ledger.md) links each outcome to tests, review findings and isolated runtime acceptance. All 1,868 prior tests remain and 40 regressions are added.

Completion covers verified plugin-owned work, not forced termination of arbitrary external processes. Suspected remount races refuted by downstream guards are recorded as disproved, not fixed. Compatibility routes and bounded refresh back-pressure remain intentional.

## Execution

Use the DSH task board for implementation ownership and [the review ledger](../../reference/refactor-review-ledger.md) for durable findings. Start with workspace policy. Investigate lifecycle and redundant paths in parallel, but apply overlapping changes serially.

For each finding, record the trigger, source evidence, reproduction, impact, selected repair, alternatives, regression result and checkpoint. Fix confirmed in-scope defects during this work. Keep structure-only and behavior-fix commits separate.

A valid cleanup reduces duplicated ownership or required knowledge. Do not create generic registries, factories or timers when existing host or local primitives suffice.

## Guardrails

Keep the public package, configuration namespace, user data and intentional UI behavior compatible. Do not modify the host or the live profile. Use isolated profiles and ports for runtime acceptance.

Do not push, publish or perform destructive migration without separate user confirmation. Ask only when a repair requires an unresolved user-facing policy or broader access. Record a concrete blocker rather than claiming completion.

Keep existing test identities unless a recorded correction replaces an assertion that pinned a confirmed defect. Never weaken quality gates to obtain a passing result.
