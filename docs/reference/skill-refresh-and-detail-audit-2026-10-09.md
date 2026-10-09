# Skill refresh and detail audit, 2026-10-09

## Summary

The composer skill menu refreshes after a committed extension selection without another keystroke. Active turns retain their committed resources. This reference separates source analysis, executed regression tests, and browser evidence. The published host baseline is `0.2.0-rc.2`.

## Contents

- [Server and model](#server-and-model)
- [Composer menu](#composer-menu)
- [Executed evidence](#executed-evidence)
- [Detail audit](#detail-audit)
- [Evidence limits](#evidence-limits)

## Server and model

Preset selection enters the session transaction through [extension-runtime.ts:338–385](../../packages/market-runtime/src/runtime/host/extension-runtime.ts#L338-L385). A busy session records intent without replacing active grants. The next request uses the selection promoted at the safe turn boundary. [The held-turn regression](../../tests/extension-next-turn.test.ts#L141-L170) asserts that ordering.

The committed callback calls [scoped-contributors.ts:307–313](../../packages/market-runtime/src/runtime/host/scoped-contributors.ts#L307-L313), which invalidates its registered skill providers. The published [registry:376–411](../../node_modules/@deepseek-ai/dsh-skill/lib/index.js#L376-L411) increments its revision, clears catalogs, and emits `skills/change`. The registry cache has no time-based expiry. `refreshInventory` updates resource availability, not the browser skill cache.

The model catalog follows a separate request boundary. At eligible `agent/pre-step`, `dsh-tool-skill` reads the scoped snapshot and compares its content digest. A changed digest adds a replacement catalog message. Incomplete discovery preserves the previous catalog. The audit inspected the [published tool package](https://registry.npmjs.org/@deepseek-ai/dsh-tool-skill/-/dsh-tool-skill-0.2.0-rc.2.tgz), `lib/index.js:203–234`.

## Composer menu

The published [skill client](https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-skill/-/dsh-client-ui-skill-0.2.0-rc.2.tgz), `lib/client.js:332–370,429–430`, caches results by session. Its private cache listens to native preset selection and connection reset, not extension preset commits or server `skills/change`. A menu requery alone therefore returns stale cached candidates.

The [plugin adapter](../../packages/market-ui/src/ui/skill-catalog-refresh.ts#L81-L179) reads the published `remote.skills.list` API for each candidate request. It keeps session-scoped snapshots for lexicons and previews, preserves host ranking and picks, and rejects obsolete responses. After refresh, it explicitly calls the public `refreshOpenMenu()`. A lexicon subscriber can belong to an editor rather than the menu. Existing controllers replace subscriptions only while the menu is closed. A late installation or disposal defers chip-lexicon transfer until close. Candidates and previews still read current data. The adapter never changes the public menu snapshot to force a hidden close.

[The commit observer](../../packages/market-ui/src/ui/selection-skill-notifications.ts#L35-L67) reads the existing session event stream and deduplicates committed revisions. [The window endpoint](../../packages/market-runtime/src/runtime/host/extension-runtime.ts#L299-L307) joins [the current selection writer](../../packages/market-runtime/src/runtime/host/extension-session-state.ts#L604-L607) before sampling effective state. This prevents the event-triggered read from returning a transient pre-commit snapshot. It does not wait for an active user turn. [The client hook](../../packages/market-ui/src/features/extension-presets/use-window.ts#L21-L67) publishes only its latest read and keeps one inventory fallback timer.

[Client composition](../../packages/market-ui/src/index.ts#L129-L149) connects native preset/reset notifications and uses the host sidebar for previews. [The browser build](../../tsdown.config.ts#L19-L21) bundles the pure workspace-path helper because that package provides no client module factory.

## Executed evidence

The Lead recorded one live save with the query `/fresh` unchanged. The save completed in 44.9 ms. The stationary menu replaced `fresh-one` with `fresh-two` at 54.1 ms from the measurement start. [The final measurement](skill-detail-2026-10-09-evidence/menu-latency.json#L3-L14) records the rows, times, and revision. This single observation is not a latency percentile or service-level guarantee.

Executed adapter regression runs cover editor-only subscribers, closed menus, reversed responses, scope replacement, source ordering, and disposal. See [client-skill-refresh.test.ts](../../tests/client-skill-refresh.test.ts) and [commit notification tests](../../tests/client-selection-skill-notifications.test.ts). The actual published input controller also passed in-memory tests with the adapter installed before and after controller creation. The [React hook regression](../../tests/client-extension-presets.test.ts#L92-L132) confirms that reversed reads retain the newest revision and leave no polling timer after unmount. No full-suite result is asserted by this reference.

## Detail audit

[The retained matrix](skill-detail-2026-10-09-evidence/detail-states.json) contains 37 primary detail observations, 35 secondary observations, and seven translation states. Cases overlap. All seven resource types were opened through the settings UI.

The audit exercised user, plugin, disabled, invalid, loading, error, document, service, recovery, editor, and save-failure states. Details measured 800×800 on desktop and 552×800 in the 600px viewport. No dialog horizontal overflow appeared in those cases. Light Chinese and English checks covered representative details.

Two defects were reproduced and repaired. A broad flex rule changed a skill hero to a 184.5px column. [The before measurement](skill-detail-2026-10-09-evidence/detail-before.json) records that shape. The shared content stack restores a 68px row and compact sections. A stale name-validation error also masked the next server save rejection. The rebuilt browser confirms the current error and retained draft.

These cases render real DSH pages with controlled response data. They do not establish live MCP, LSP, credential, or remote-source behavior.

## Evidence limits

The event watcher lives with the enabled preset entry. Candidate requests fetch fresh data independently of that entry. Busy-turn execution remains deferred. Discovery refresh grants no pending resources to an active turn.

[The affected tests](skill-detail-2026-10-09-evidence/tests.txt) pass 49 files and 414 tests. The entire repository suite was not repeated. The standing gate is recorded alongside this evidence.

The live timing test used the reviewed candidate and notification logic. A final scope-disposal cleanup was added afterward and covered by regression tests. Rebuild and restart the isolated host after client artifact changes because its module responses can retain an earlier bundle.

Cold translation failure and every theme/language combination were not separately exercised. These are coverage limits, not passed cells.
