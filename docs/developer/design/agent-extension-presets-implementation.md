# Agent extension presets: implementation and acceptance

Status: v5 interface implemented and tested in an isolated profile. Not released.

## Product contract

Extension presets are independent of host base modes. A workspace owns presets and a default for new sessions. Each session captures an independent complete selection. Preset edits, deletion and default changes do not update existing sessions. Ordinary global disablement supplies defaults; an explicit saved preset may override it for valid, controllable resources. Missing, invalid, or unsupported resources remain unavailable. Explicit empty selection differs from absent legacy state.

Both blank and ongoing materialized sessions use a 28px Agent extension icon button in `conversation.input.left`, to the right of Permissions. The tooltip names the current preset; no name-only or top-of-conversation entry is registered. The host has no additive top slot. No host edit, base-mode replacement or DOM mutation is allowed. Genuine no-session screens have no supported additive seat.

The prototype defines interaction and approximate layout. The current settings page defines component styling, typography, spacing, cards, source chips and resource counts. The manager reuses those local components and style modules. It retains default markers, deletion, plus/save, clipboard actions, six surface tabs, filters and the fixed 800×800 viewport-capped frame. Default-selection edits create a named-preset draft before use. Saved-preset edits autosave. Cards toggle on click or keyboard, and details remain independent.

Selection changes use acknowledged maintenance before reporting effective state. Busy sessions reject/defer explicitly, never race an active request. Sessions select saved presets; the manager edits the workspace library. There is no temporary session editor or adjustment endpoint. Full details remain reusable; session selection never mutates global credentials or configuration.

Local project groups and user Hooks are configuration, not market offerings. They publish no market card: their parent id never enters a preset, a session selection, or a preset transfer. The runtime derives each configuration parent's grant from its selected children instead, and a child of a configuration parent is selected by its own id alone. Legacy records that still carry an explicit parent id keep working; the id drops out at the next save or copy. Child resources remain in their respective surface tabs.

## Baseline and ownership

The implementation is integrated in the workspace working tree. Concurrent changes remain independently owned; each task declares its write scope. No staging, commits, tags, push or publishing without explicit user instruction.

The composed implementation includes portable selections, a revisioned workspace library, durable pending/committed session records, scoped contributors, and a saved-preset manager. Visual refinements and workspace enablement overrides require fresh acceptance evidence.

## Architecture decisions

- ExtensionSessionState is the single session selection owner. Await agent/created, use runMaintenance for changes. No mutable header, required custom event, or sidecar. Unknown/not-ready state must deny owned capabilities.
- Existing selectionAllows(undefined) is a legacy helper, never a readiness gate. Pending transaction failure is fail-closed; recovery needs explicit diagnostics.
- Move market-owned skills and commands from global to agent scopes; preserve existing command allocations and invocation guards. Do not leave old root contributions to bypass selection.
- MCP uses explicit tool ownership, scoped inherited restrictions and execution guards. Same-scope project MCP requires scoped mount filtering. Dynamic tool lists must not create restriction recursion.
- LSP remains workspace-pooled. Session disable must not stop another session. Preserve extension ownership conflicts and unsupported project-LSP diagnostics.
- The completed ExtensionHooks adapter owns per-agent hooks. Reconcile before start(startup/resume), drain disposal, and do not replay SessionStart for clear/compact. Remove old overlapping root/project hook bridges.
- Preset autosave uses revision checks. Endpoint workspace comes from real agent cwd, not a client path or process.cwd fallback.
- Reuse SuiteDetailModal, UserEntryDetailModal, McpDetailModal and exported LspDetailModal. Add MCP readOnly so session detail cannot change global tool filters or authentication.

## Team work

Shared tasks are authoritative. Runtime owns composition/routes/session/inventory/contributor assembly. Tool-gate owner owns helper and MCP/LSP ownership seams. Client owns entry registration, locale merge, details and client test split. QA owns final build/dependencies/acceptance after writers settle. Review is read-only and independent. Lead owns architecture and acceptance, not routine implementation.

Announce cross-owner APIs before use. Do not fix another task file for a temporary type error. Full build after writers settle; targeted tests may run meanwhile. Invoke installed CLI tools through Node directly; pnpm exec can relink dependencies and rewrite lock state. QA serializes package-manager operations. Build uses pnpm_config_verify_deps_before_run=false and needs no confirmation.

Implementation and testing now use verified local/deepseek-flash teammates. Earlier GPT members are checkpointed inactive. Actual request/header config proves the route; Team listing can retain creation-time model options. Limit concurrent GPT tasks to avoid provider request limits.

## Acceptance

- Same-workspace opposite session choices plus second workspace; preset/default edits leave prior snapshots unchanged.
- Immediate Send cannot outrun selection initialization. Restart/resume/fork/clear/compact and plugin reload are covered.
- Denied skill load, command shell, role spawn, MCP dispatch and LSP query do not execute effects. Dynamic/stale/native/PTC tool paths agree.
- Shared MCP/LSP services survive session-only disable. Hook startup/subagent ownership and disposal have real counters.
- Source-qualified identities agree across UI/storage/runtime. Invalid input, corruption and conflicts fail closed with diagnostics.
- Both inputs and details are accessible/bilingual; autosave and async reads do not lose state.
- Real isolated profile+port/browser verification with current build artifact; no production configuration mutation.

## V5 interface acceptance, 2026-10-06

The built plugin ran in an isolated profile at `http://127.0.0.1:19581/`. The test session used the mock provider. The live profile remained unchanged.

- Blank and ongoing sessions showed one 28×28 four-square button after Permissions. The ongoing menu opened above the button.
- The manager and full resource details measured 800×800 at a 1280×1000 viewport. Surface changes retained that size.
- At 390×844, the manager measured 342×796. Cards used one column. The page had no horizontal overflow.
- The real global-off suite changed from disabled to enabled in a draft. Saving created a preset without changing the session selection.
- Card clicks and keyboard activation saved resource choices. The real skill detail opened its complete document and exposed a preset-only switch.
- Selecting the saved preset made `greet` loadable. Editing that preset to disable `greet` did not change the active session. Explicit reselection then made `greet` unavailable.
- Clipboard export contained only the portable name, format, version and resource identifiers. Clipboard import and permission-failure behavior have client regression coverage.
- The plugin build passed. All 271 client tests passed across 32 files. Full source/test lint, client type checks, scoped formatting, reuse and whitespace checks passed.
- The isolated browser reported no console errors or warnings. Vitest reported a missing source map in the published UI package.

The current GUI at `http://127.0.0.1:19387/` required authentication in the test browser. This acceptance does not claim that the live GUI loaded the new bundle. No host source, live profile, commit or remote repository changed during this interface task.

## Settings-style alignment, 2026-10-06

The entry and preset menu use a monochrome Agent head with a capability connector. The SVG uses the published medium stroke weight.

The manager and current settings page share the same ResourceCard classes. Browser measurements matched their name font, description font and card class. The name uses 13px system text at weight 600. The description uses 12px system text with 17px line height. Source chips, counts, tabs and actions use the existing local style modules. Surface labels reuse the settings locale keys.

The final build passed. All 276 client tests passed across 33 files. Scoped lint, reuse and whitespace checks passed. The manager retained its 800×800 desktop frame and stayed within a 390px viewport. The isolated browser reported no errors or warnings.

The settings sidebar still uses host-selected icons. Published rc.2 maps section identifiers to built-in icons and does not accept a custom section icon. The plugin does not patch that host navigation.

## Draft toggle repair, 2026-10-06

Native project suites reached the inventory through both validated candidates and legacy project discovery. The legacy loop appended a second row with the same resource identifier. After filtering removed an earlier row, React retained a stale card. Its card and switch no longer reflected the editor state. A client regression reproduced a card that stayed active after a disable click.

The inventory now retains one row per project suite and keeps the candidate validation result. The client also coalesces repeated identifiers before rendering an older inventory response. The manager footer omits the workspace name and retains Help.

The repaired build passed with 77 focused tests and scoped lint. Browser pointer clicks on a real suite enabled, disabled and re-enabled an unnamed preset draft. The footer had no workspace label, and the browser reported no errors or warnings. Native candidate overlap and filtered duplicate nodes have regression coverage. The temporary native fixture did not appear in that isolated catalog, so native-card browser coverage is not claimed.

## Hooks detail, tab readability and localized names, 2026-10-07

The local configuration row for user hooks opened a 404 detail. The project detail reader searched the project suites and the enabled user set, and the enabled set carries the hooks suite only while it declares events, so an empty or malformed configuration missed. The reader now resolves the hooks identity through the always-built loader and passes an explicit empty command and agent resource list, so the shared Agent layout root cannot contribute surfaces. Diagnostics flow into the detail errors, and the dialog shows a localized explanation row when no valid hook exists.

Seven tabs wrapped their Chinese labels vertically at a 390 px viewport because the host sizes tab columns equal-width by inline style. A wrapper-scoped rule now lays the host track at natural label width inside the existing horizontal scroll row, keeps equal columns so the host indicator stays aligned, and keeps the host font and pill height. The rule cannot reach surfaces that put the row class on the host tablist itself.

Accessible names spoke the raw wire name "User Hooks". The list switch, both detail buttons, the detail footer switch and the fallback title now speak the localized display name. Regression suites cover the route-level 200 with diagnostics, the read-only detail, the tab scroll policy and the localized labels: 7 plus 18 tests. Independent review reported no findings at or above its threshold, and adjacent suites stayed green. Browser acceptance on the isolated host confirmed the 800x800 detail dialog with a localized empty explanation and no console errors, tabs one line tall with no vertical clipping at 390x844 and horizontal scroll available, and the dialog bounded to the viewport with no page overflow.

## Hooks tab, icon redesign and surface classification, 2026-10-07

The Local configuration tab is gone. Project-suite parents render as suite cards in the market tab, project-scan children ride their own face tabs, and the user-hooks row left the manager UI while its backend classification and detail route stayed intact. Locale keys for the removed tab went with it, paired zh and en.

The manager gained a seventh face tab for hooks. Secondary tabs group rows by event, each carrying a status dot: green for a supported event with a hook enabled, gray for supported and idle, warning for partial or registered-only. Each command hook of a supported event becomes one selectable row; Notification is read-only partial, SessionEnd and PreCompact read-only registered. Declarations the catalog validator rejects surface as read-only declared rows parsed from the suite diagnostics, so an unsupported declaration stays visible instead of hiding in the detail error list. One exported map holds the event support truth for the later runtime bridges. The entry icon became a ring with a filled and a hollow node on it, one color, 1.5 stroke, replacing the robot head. Browser acceptance on the isolated host confirmed the eight-tab row stays one line and the hooks tab answers with the fixture's empty configuration.

Regression coverage grew to 66 focused tests across seven files, including five inventory rows tests and four client hooks-tab tests. The hooks full-support gap analysis lives in docs/scratch/hooks-support-gap-analysis.md and names what plugin bridges can add without host changes.

## Settings-page detail frames, 2026-10-07

Detail dialogs opened from the settings workspace (skills, commands, personas, MCP, LSP, market panels) rendered at their natural height with per-feature chrome, while the preset manager's details used the fixed settings-sized frame. The workspace now wraps its active panel in the same settings-frame provider, so every detail dialog on the settings page inherits the identical 800x800 chrome: fixed size, internal scrolling, and the shared footer slot. Browser acceptance confirmed a persona detail at 800x800 with normalized title and hero; 36 focused tests stayed green.

## Confirmed boundaries

- New sessions without a named default capture global choices. Only pre-existing unsnapshotted sessions capture effective legacy workspace filters once. Legacy files remain unchanged.
- Host/foreign MCP remains visible with actual availability, complete details, and a read-only global-managed label. Native user skills use scoped same-name candidates and load-time authorization. Market builtin managed-direct MCP remains session-controllable.
- Recovery selects the last committed snapshot, or the original initial attempt if none committed. It never resets to current workspace defaults. Rejected steps preserve original claimed input identities without waking a retry loop.
- Orderly host disposal cancels pending input; crash durability tests copy a flushed checkpoint before teardown. These are different lifecycle guarantees.
- Skill providers register in agent scopes. Registry lookups explicitly supply the agent as scope. Both suite and individual entry ids must be selected; provider controls invalidate cached summaries on selection and catalog changes.
- Global catalog changes and session changes use separate pipelines. Session changes never reconcile shared global services or invalidate other sessions. Catalog refresh must not reject an entire agent step or requeue user input: the host owns automatic queue progress. Resource-level authorization rejects revoked capabilities while registrations are refreshed.
- Final acceptance requires the real plugin root, positive and negative execution paths, and a built isolated browser instance. Helper-only tests do not establish production isolation.
