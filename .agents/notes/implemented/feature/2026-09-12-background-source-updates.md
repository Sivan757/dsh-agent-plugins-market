# Agent Note: Optional background source updates

Status: implemented

## Problem

A configured source refreshed only when the user pressed refresh. A marketplace could therefore sit at an old commit indefinitely, and users who wanted current upstream content had to remember to refresh by hand.

## Decision

A new settings field `autoUpdateSources` (default off) joins the existing `dsh-agent-plugins-market` namespace, with a switch on the plugin configuration card. When on, `SourceAutoUpdater` arms one interval of six hours and calls `catalog.refreshSource()` — every configured source — per tick. The first tick runs a full interval after enabling, so flipping the switch never starts network traffic immediately. A tick that finds the previous pass still in flight is skipped with a log line; a failed pass is logged and does not disarm the timer; the timer is `unref`'d so it never keeps the DSH process alive. Disabling clears the timer, and the plugin lifecycle clears it on teardown.

Off by default because a pass fetches from the network and re-downloads archive sources, and refreshing a source invalidates discovery and reconciles mounts.

## Alternatives considered

**Refresh once at startup.** Rejected: startup is already the busiest moment, and the requested feature is a background updater.

**Expose the interval as a second setting.** Rejected for this change: one switch is the requested control, and six hours is stated in the card and the usage guide.

**Skip archive and local sources.** Rejected: the updater must mean the same thing the refresh button means; local sources already refresh for free, and archives are re-downloaded by design.

## Consequences

With the switch on, checkout contents can change without any user action, which is why the default is off. `refresh` is enqueued on the catalog mutation queue, so a background pass never interleaves with a user mutation. Logging names the feature so a network trace is attributable.

## Verification

`tests/source-auto-update.test.ts` covers off-by-default, the interval, idempotent enable/disable, the in-flight skip and the logged failure using fake timers; `tests/plugin-apply.test.ts` and `tests/mcp-backend.test.ts` cover the namespace wiring.
