# Agent Note: the plugin's settings, card form, and browser state ride the host

Status: implemented

## Problem

Changing one default value took five source edits plus its documentation. The setting's meaning was written independently in the namespace schema, in the composition `base` the registration declared, in the catalog's initial field value, in the discovery function's parameter default, and in the browser card's own fallback — and the browser side did not even agree with itself, reading one switch as `!== false` and another as `=== true`.

The same shape repeated everywhere the plugin faced a host-owned surface. The browser card hand-rolled what the host has a contract for: six getter closures, a `setTick` re-render, no "not served yet" gate, no way back to a default, and per-row busy/error boilerplate that had already drifted into two different promise chains. The grid/list preference hand-rolled its own observable plus `localStorage`. The tool registry was read through host-private internal structure. Four host seams were copied verbatim into this repository under a comment claiming the packages were unpublished, which had stopped being true.

## Decision

**One owner per fact, and the host owns what the host already owns.**

Settings. `src/contracts/settings.ts` is the single place a default, a field name, or a "what does absent mean" rule is written. `MarketSettingsSchema` declares those defaults to the host; it does not hold them. Every reader — the node half's four switches, the catalog's initial value, the browser card — goes through `resolveMarketSettings`. The registration declares no `base` layer: with every field carrying a schema default, a `base` was a second copy of the same values that changed nothing about the resolved result.

Card form. `src/client/plugin-card-controller.ts` stages edits and commits them on save, matching the contract every card in the `settings.plugin.item` slot follows. The controller projects into a `@deepseek-ai/dsh-client-store` snapshot published through the slot's `hooks` seat, so the host renderer synthesizes the card's selector hook and `src/client/McpPluginCard.tsx` becomes a renderer. The card renders nothing while the namespace is not served, marks a field as overridden only when the user layer carries it, and resets a field with `scope.unset` so it follows the plugin again instead of pinning today's value.

Browser state. The grid/list preference uses the platform snapshot store with `persist`, which is the host's own browser-local persistence.

Host seams. `src/runtime/mcp-client/host-seams.ts` re-exports `MAX_TIMER_DELAY_MS`, `scrubbedParentEnv`, `credentialKey`, and the image-admission vocabulary from `@deepseek-ai/dsh-timeout`, `dsh-subprocess`, `dsh-credentials`, and `dsh-attachment`. The tool observation reads `ctx.tools.schemas()`. The host locale preference reads the settings service's projection of the `locale` entry (`describe()` → `ns === 'locale'` → `value.preference`), the surface the harness's own desktop shell reads it through; the `settings.get(ns)` getter and the `settings.yaml` parse that followed it are gone, recorded in [the host locale source note](../bug-fix/2026-09-24-host-locale-source-read-and-lifetime.md).

## Alternatives considered

**A shared mutable settings store the plugin owns.** Rejected: the browser half cannot import `src/runtime`, the node half reads settings asynchronously, and a process-global would erase which layer knows the value. The host settings document already is that store, with a declared base/default/user layering and a revision fence on writes.

**Keep `base` and read defaults from it.** Rejected: `view.base` has no consumer in this repository or in the host's own card code, so it would be a third copy serving nothing.

**Keep the browser card's immediate-commit switches.** Rejected: a settings write is a durable, revision-fenced document mutation that the node half reacts to by remounting MCP servers. Committing per keystroke turns one choice into writes the user did not ask for and cannot preview, and the resulting per-row busy/error code is what drifted.

**Read the tool registry through its internal layer structure.** Rejected: `schemas()` is the public listing API; the internal shape is not a contract, and depends on a structure the host never promised to keep.

## Consequences

Changing a default, adding a field, or flipping a polarity is now one edit in the contract module plus its documentation. The browser card stops restating defaults at all: a field it has no answer for is not rendered, and one it does not override follows the document.

Three deliberate deviations remain, each with a reason that is not "we did not look":

- **The MCP bridge, the redaction heuristic, and the `/api/agent-plugins/*` HTTP surface stay.** The host MCP client has no OAuth and no SSE; host secret redaction is schema-driven and a third party's `mcp.json` has no schema to declare; and moving the HTTP surface onto the host's Remote seam is a rewrite of every route and client call, not a reuse.

Timers are **not** in that list. `src/runtime/timer-seat.ts` reads the host's `timer` service, so repetition, deferral and coalescing die with the plugin's fiber in every composition that mounts `@deepseek-ai/cordis-plugin-timer` — which the base bundle does on every standard profile. The service also mixes `interval` / `timeout` / `debounce` into the context, but Cordis resolves one of those accessors through its service, so `ctx.interval` fails with `cannot get property "timer" without inject` in a fiber that does not inject `timer`; reading the service is what keeps the seat optional. A plain-handle fallback covers the minimal contexts tests build and compositions without that plugin; it is the only path that unrefs. The earlier claim that this plugin _depends_ on unref to let a DSH process exit was wrong: `ctx.appExit` is defined as exiting once the tree has been disposed, and disposal already ran this plugin's cleanup, so the fallback's unref is hygiene rather than a load-bearing guarantee.

`settlesWithin` is likewise not a deviation any more: it is a thin race over the host's own `deadline`, which owns the timer and stamps the `TimeoutReason`. Only the fold — "did the work settle at all" — is local, because the host primitive deliberately only notifies. One trap is worth remembering: the host reads a non-positive timeout as "arm no timer", while these callers read it as "do not wait", so the helper floors the wait instead of forwarding the zero.

Every connection attempt is now bounded by `DEFAULT_STARTUP_TIMEOUT_MS` (10 seconds) when the server declares no `startupTimeoutMs` of its own. Before this, an undeclared server fell through to the MCP SDK's own 60-second request default, so one unreachable server held its process, transport and browser leg for a full minute before failing. A server that genuinely needs longer declares `startupTimeoutMs` (`startup_timeout_sec`/`startup_timeout_ms` in Codex's TOML), and that declaration stays a _policy_: host compatibility mode still refuses a server carrying one, because that backend cannot enforce it. The default is resolved at connect time — inside the built-in bridge, the only backend it applies to — precisely so an undeclared server remains mountable in compat mode.

The card's switch control moves to the platform `Switch`, which also gives it a visible focus ring. The list/grid preference no longer syncs across browser tabs: the platform store persists one value per document, and following the platform here was the point.

One behavior change on the node half: `discoverSourceListWithNotes` now requires its `scanProjectLayouts` argument. It had one real caller that always passed it, so the default was an unread second copy of the setting.

## Testing

`tests/client-plugin-card.test.ts` covers the card form's contract: nothing before the namespace is served, a stored section resolved through the contract defaults, a staged edit held out of the document until the save, discard, reset handing a field back, a refused write reported as unsaved, compat mode blocked when the host MCP client is missing, and a read-only document refusing edits. `tests/timer-seat.test.ts` covers both scheduling paths — the host seat is preferred when present, and the fallback repeats, defers, coalesces and stops on dispose — plus a fiber that mounts the timer plugin without injecting it, where the mixed-in accessors throw and the service read still serves. `tests/deadline.test.ts` pins the settle/timeout race, the non-positive wait, and that a rejection counts as settled. `tests/mcp-backend.test.ts` pins the schema defaults, `tests/regions.test.ts` the region narrowing, `tests/mcp-status.test.ts` the tool observation including its failure modes, `tests/host-locale.test.ts` the locale-entry projection, the unwired answer and the wiring's identity guard, and `tests/client-workspace-view.test.ts` the persisted preference and its invalid-value fallback.
