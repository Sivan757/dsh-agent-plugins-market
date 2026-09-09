# Agent Note: One workspace page, user panel CRUD, and read-only suite detail MCP

Status: implemented

## Problem

Eleven experience-feedback items landed at once; four of them carry decisions worth recording:

1. **The suite detail modal mixed preview with configuration.** The MCP section embedded a credential editor and a per-server override form inside what is otherwise a read-ahead preview of the suite's files. Credential and override state are per-suite _runtime_ facts — they belong to the MCP services panel, next to mount diagnostics, not inside a catalog preview.
2. **Removing a source left the checkout on disk, and the UI then nagged about it.** `removeSource` always kept the checkout; the next overview listed it under "unregistered local checkouts", inviting an adopt that resurrects the very source the user just deleted. The confusing hint was a symptom of the removal dialog not offering physical deletion.
3. **Six panels rendered as three sibling settings sections** (market, MCP, LSP), while skills / commands / personas had no management surface at all. There was nowhere to see user-authored skills/commands/agent personas, disable one without deleting it, or create one.
4. **Every panel reimplemented its own list/scroll/actions**, and scrollbar show/hide between tabs jittered the layout (the whole settings column scrolled).

## Decision

Overlay presentation is independent of operation leases: an immediate invisible interaction guard precedes a 200 ms display delay, with a 400 ms minimum visible duration and 100 ms settling grace. A new request cancels dismissal without remounting the overlay, preventing repeated entrance animations. These timings affect presentation only, not request execution or returned promises.

Busy feedback is one body-level blocking overlay, scoped to the current dialog or workspace. Reference-counted operation leases span requests and follow-up reads, preserve errors with `finally` cleanup, and prevent concurrent requests from dismissing each other. A layout-free legacy BusyIndicator lease covers local workflow state. Interaction blocking uses inert plus capture guards for dialog backdrops and Escape, restoring the previous focus and inert state. Dialog transforms are tracked while active; the spinner and rotating messages never change list geometry.

`DetailModal` owns the viewport-bounded wide geometry for market, Markdown, MCP and LSP details. `MarkdownDocument` separates structured frontmatter and rendered Markdown; raw source remains authoritative. `ServerConfigEditor` keeps one JSON draft across fixed-form and raw modes, blocking invalid conversions. Per-service full replacement is validated before persistence; redacted values roundtrip through the original secret, and LSP configuration fingerprints force live remounts after edits. This replaces narrow raw-only editors without changing the read-only suite preview boundary.

All six tabs use `ResourceCard` and `ResourceCollection` for state rails and grid/list layout, `PanelHeader`/`PanelActions` for top-right add/refresh commands, and `SearchFilterToolbar` for search and filters. `useWorkspaceView` stores one preference in `dsh-agent-plugins-market:view` and synchronizes mounted panels and browser tabs. Search and filter values stay independent because the resource types differ. The source badge describes ownership; card rails describe state (green active, gray disabled, amber warning, red error).

- **One workspace page, six top tabs** (`PluginWorkspace`): the `settings.section` slots collapse from three registrations to one carrying a tab row (Market / Skills / Commands / Agent personas / MCP / LSP). Tab state is component-local; deep links ride `#/agent-plugins/<tab>`. Each tab scrolls inside its own region (`overflow-y: auto; scrollbar-gutter: stable` from the workspace chain down through market/mcp CSS), so the host `.options` container stops being the scroller and scrollbar visibility changes can no longer shift the layout.
- **Suite detail MCP region is read-only.** The credential editor and override form moved out of `SuiteDetailModal`; the expansion shows the validated config JSON and a disabled badge only. `McpStatusPanel`'s detail dialog remains the one place that edits credentials/overrides.
- **Physical deletion is opt-in, per dialog.** `removeSource(id, deleteCheckout)` deletes the checkout only when the confirmation dialog's "also delete the managed market directory" checkbox is set (default: checked). A directory under `.sources/<id>` is manager-owned storage and is removed even when it was adopted; only a `local` source whose URL points outside `.sources/` is registration-only and never deleted. Deleting the checkout is what stops the unmanaged-checkout banner from reappearing for a genuinely deleted market.
- **User panels persist as Markdown, not state JSON.** Skills / commands / agent personas live under `userRoot/user/{skills,commands,agents}/*.md` with the same frontmatter grammar as suites (`description`, `argument-hint`, invocation controls) plus a `disabled: true` panel key. One `UserPanelStore` CRUD class serves all three; a second skill provider (`UserPanelSkillProvider`, rank 600, source `user-panel`) feeds only skills into the registry; roles use the [durable subagent catalog](../architecture/2026-09-09-subagent-catalog.md), and a `UserCommandMountRegistry` reconciles user commands as slash commands on the same change pipeline. Disabled entries are skipped at discovery, so disabling is an unmount, not a state toggle.
- **User storage has one canonical root.** `userRoot` resolves to `$DSH_HOME/agent-plugins` (default `~/.dsh/agent-plugins`), with mutable data beneath `data/`. Former root overrides are migration inputs only. Activation waits for migration of old roots, the sibling `agent-plugins-data`, and `data/user` entries. Conflicting files remain at their original paths and block activation; symbolic-link roots are rejected, and malformed legacy state is detected before its checkouts move. Project-dimension and explicitly registered external local sources retain their in-place semantics.
- **Agent roles execute with their saved policy.** `subagents_run` reads `model`, `provider`, `reasoning_effort`, `tools`, and `disallowedTools` from role Markdown frontmatter at runtime and starts a real subagent through `subagents.start`, passing model selection as `agentOptions`, the role body as `persona`, and tool restrictions as `toolFilter`. The detail editor places this configuration above the body and preserves it in the same frontmatter. Missing model or `inherit` uses the parent selection; bare model ids must resolve to one provider, while explicit provider/model selection supports provider-specific ids. Invalid or ambiguous routing fails before launching a subagent.
- **Shared building blocks over per-panel copies** (`client/ui/panel.tsx`): `PanelShell` (title/actions/scroll body), `BusyIndicator` (the global in-flight spinner, overlay variant included), `EntryEditorModal`, `ConfirmModal`, `SourceBadge`, plus a shared `panel.module.css`. The three user panels are literally one component (`UserPanelSurface`) parameterized by kind; the market and MCP panels embed the same busy indicator, and `SearchFilterToolbar` gains the unified `＋ add` seat.
- **Feedback tool is a tool, not a command.** `report_market_issue` registers through `ctx.tools` behind a `feedbackEnabled` settings field (default true) in the existing `dsh-agent-plugins-market` namespace; the watcher mounts/unmounts it live. It posts to GitHub Issues when `GITHUB_TOKEN`/`GH_TOKEN` exists and otherwise appends a JSONL spool under `data/feedback/`; a 60 s stamp file bounds bursts. `@deepseek-ai/dsh-tools` joins the peer/dev dependencies as optional — the tool simply does not mount where the package is absent.

Provider and model controls use linked dropdowns backed by the live DSH LLM registry. The `model-catalog` read route returns only public identities, loads models for one selected provider, and bounds waits to ten seconds. Requests are canceled or ignored when the selected provider changes. Unknown saved model ids remain visible and unchanged until the user selects another value. No provider catalogs are fetched during plugin startup.

The plugin-owned MCP bridge already owns suite server lifecycle, so its persisted per-server `enabled` override is exposed as a live switch in the service detail dialog. LSP remains mounted through the plugin's own `dsh-lsp-stdio` registry; host-missing and conflict states are surfaced without pretending the host package supports a native toggle.

The legacy page adapter mounts its workspace only when opened and does not compete with other extensions for the sibling immediately after New Session. Its MutationObserver ignores workspace-internal mutations. This prevents competing sidebar extensions from starving the browser with endless reorder notifications. Closing the workspace releases its component tree and unsaved drafts.

## Alternatives considered

- Rendering six `settings.section` entries was rejected: the sidebar grows to six plugin-owned rows for one plugin, and the requested outcome was one page with tabs.
- Storing user entries in `state.json` was rejected: skills/commands/personas are multi-line Markdown edited as documents; files keep them diffable, hand-editable, and symmetrical with suite surfaces.
- Enabling/disabling user skills by flipping invocation frontmatter was rejected: it would conflate the author's routing intent with the panel's runtime control; a separate `disabled` key keeps both reversible.
- Auto-deleting checkouts on every source removal was rejected: silent `rm -rf` of a directory tree from a dialog default is the wrong side of the tradeoff; the checkbox makes the destructive path explicit while keeping it one click.
- Keeping the override editor in the suite detail (but disabled when uninstalled) was rejected: two editors for one record invite divergent UX; the MCP panel already owns credentials, retries, and re-authorization.

## Risks

- `SuiteDetailModal` no longer takes `credentials`; external embedders passing it are unaffected (optional prop), but credential editing from the suite context is now a redirect to the MCP panel.
- The user-panel routes mount only when the HTTP layer receives the panel stores (`mountSuiteRoutes` third argument); a host that never passes them sees the old route table exactly.
- `scrollbar-gutter: stable` reserves a gutter in every panel; browsers without support degrade to auto-gutter (jitter returns there, no breakage).
- User skills rank at 600, below every shipped root: a user skill never shadows a suite skill of the same name; renaming is the escape hatch.

## Verification

- `pnpm run check:refactor` (typecheck, lint, format, routes+contracts tests, dependency-cruiser) green.
- New tests: `tests/user-panels.test.ts` (store CRUD, disable round-trip, provider discovery, frontmatter helpers), `tests/feedback-tool.test.ts` (local spool, cooldown, body rendering), route tests for conditional panel routes and `deleteCheckout` pass-through, and a source-acquisition case proving an adopted `.sources` checkout is removed under `deleteCheckout: true` while an external `local` directory survives.
- Full `pnpm run test`: 46 files, 300+ tests green.
