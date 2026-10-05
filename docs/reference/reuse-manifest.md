# Host reuse manifest

The standing rule is maximize host reuse (see the decision note [settings-and-card-ride-the-host](../../.agents/notes/implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md)): before building a capability, check whether the host's published packages already provide it, and record every deliberate deviation. This page is that record in machine-checkable form. `pnpm run check:reuse` (`scripts/check-reuse.mjs`) reads this table and fails the tree when it and the source disagree. The npm-published `@deepseek-ai/dsh-*` packages are the authority: what the harness monorepo contains but has not published is a lookahead, never a use.

## Parsing conventions

- Rows are the Markdown table lines whose first cell is a backticked file path. Every other line is commentary.
- Columns: `self-built surface` | `host counterpart (package/export)` | `status` | `decision record`.
- `status` is one of `use-host`, `self-built`, `wait-host`.
- The `decision record` cell holds relative repo links (ADR or Agent Note), optionally a trailing `|| note text` segment after the links. Cells are split on `||`.
- `host counterpart` is free text, except the scanner must be able to read the two patterns `@deepseek-ai/<pkg>/<subpath>.<Names>` (a subpath export) and `@deepseek-ai/<pkg>.<Names>` (the root entry, including the `:type` suffix for type-only exports). Rows without either pattern are ignored by rules R2/R3.
- Names in the counterpart cell are dot-separated exactly as the package exports them (`plugins.item` is one name with a dot in it). Type-only names keep the `:type` suffix.

## What the gate checks

- **R1 unregistered collision** — a file under the scanned self-built surfaces whose normalized name equals a published export of the scanned host packages, with no manifest row naming that file.
- **R2 vanished export** — a manifest row citing `@deepseek-ai/<pkg>(/<subpath>)?.<Name>` where the installed package's `.d.ts` no longer exports `Name`.
- **R3 published while waiting** — a `wait-host` row whose cited export now exists in the installed package (the deviation can be retired).

A row with the same file path as an existing `src/` file is an update, not a duplicate.

## use-host — the host's capability is the implementation

| self-built surface | host counterpart (package/export) | status | decision record |
| --- | --- | --- | --- |
| `src/application/state/state-store.ts` | File-backed persistence is the deliberate host-alternative; the platform store is browser-only. See [ADR 2026-09-13](../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md). | self-built | ../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md |
| `src/application/json-file.ts` | File-backed persistence. See [ADR 2026-09-13](../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md). | self-built | ../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md |
| `src/application/source-store.ts` | File-backed persistence. See [ADR 2026-09-13](../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md). | self-built | ../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md |
| `src/application/install-store.ts` | File-backed persistence. See [ADR 2026-09-13](../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md). | self-built | ../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md |
| `src/application/panels/user-store.ts` | File-backed persistence. See [ADR 2026-09-13](../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md). | self-built | ../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md |
| `src/application/mcp/mcp-overrides.ts` | File-backed persistence. See [ADR 2026-09-13](../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md). | self-built | ../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md |
| `src/application/mcp/mcp-credentials.ts` | Host credential vocabulary arrives through `host-seams`; the store itself is plugin file state per [ADR 2026-09-13](../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md). | self-built | ../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md |  | note: @deepseek-ai/dsh-credentials.credentialKey is the shared vocabulary |
| `src/runtime/agents/agent-teams-seat.ts` | Observes the host `agentTeams` service to withdraw standalone role delegation when Team owns member management. | use-host | ../../.agents/notes/implemented/architecture/2026-10-02-role-aware-team-entry.md |
| `src/runtime/agents/teammate-role-runtime.ts` | Uses public Team creation, awaited Agent initialization, scoped system-prompt sections, installModelSelection and Session query/inbox persistence; no host patch or second roster. | use-host | ../../.agents/notes/implemented/architecture/2026-10-02-role-aware-team-entry.md |
| `src/runtime/agents/teammate-role-tool.ts` | Enhanced creation through TeamService with the existing role resolver and durable discovery catalog; native Team tools retain member management. | use-host | ../../.agents/notes/implemented/architecture/2026-10-02-role-aware-team-entry.md |
| `src/runtime/core/timer-seat.ts` | Reads the host `timer` service (`@deepseek-ai/cordis-plugin-timer`); the local fallback seat exists for compositions that never mount that plugin and is the only path that unrefs. | use-host | ../../.agents/notes/implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md |  | note: host service read through ctx.get('timer') |
| `src/client/features/settings-card/McpPluginCard.tsx` | Renders on the plugin-manager `plugins.item` slot key (typed by the client `PluginsSubject` contract) | use-host | ../../.agents/notes/implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md |
| ~~`src/client/features/settings-card/plugin-card-controller.ts`~~ (deleted 2026-09-27) | Retired onto the host model: the card binds @deepseek-ai/dsh-client-ui-primitives.SettingsFormModel through custom boolean/enum specs and renders the SettingsForm frame. | use-host | ../../.agents/notes/implemented/architecture/2026-09-27-plugin-card-controller-onto-host-form.md |  | note: the card's fields are four booleans plus the downloadRegion enum, so the market binding carries its own SettingsFieldSpec values instead of the published settingsNumberField/settingsTextField factories |
| `src/client/ui/workspace-view.ts` | @deepseek-ai/dsh-client-store.createSnapshotStore | use-host | ../../.agents/notes/implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md |
| `src/client/ui/json-tree-labels.ts` | Label factory feeding @deepseek-ai/dsh-client-ui-primitives.JsonTreeLabels:type | use-host | ../../.agents/notes/implemented/architecture/2026-09-12-shared-primitives-and-declared-seams.md |
| `src/client/ui/last-change.ts` | @deepseek-ai/dsh-client-ui-primitives.relativeTime | use-host | ../../.agents/notes/implemented/architecture/2026-09-12-shared-primitives-and-declared-seams.md |
| `src/client/ui/hover-hint.ts` | @deepseek-ai/dsh-client-ui-primitives.Tooltip | use-host | ../../.agents/notes/implemented/architecture/2026-09-12-shared-primitives-and-declared-seams.md |
| `src/client/ui/MarkdownDocument.tsx` | @deepseek-ai/dsh-client-ui-primitives.MarkdownText | use-host | ../../.agents/notes/implemented/architecture/2026-09-12-shared-primitives-and-declared-seams.md |
| `src/client/ui/DocumentTranslation.tsx` | @deepseek-ai/dsh-client-ui-primitives.MarkdownText renders the translated body; the published set has no bilingual pair or original-beside-translation atom — the nearest, DiffBlock, compares two texts line by line. | use-host | ../../.agents/notes/implemented/feature/2026-10-05-document-translation-chunked-and-lazy.md |  | note: the row's own chrome is the shared local DetailRow disclosure; no new primitive was built |
| `src/client/ui/DetailModal.tsx` | @deepseek-ai/dsh-client-ui-primitives.Modal | use-host | ../../.agents/notes/implemented/architecture/2026-09-12-shared-primitives-and-declared-seams.md |
| `src/client/index.ts` | Registers through the host slots service (`ctx.slots.inject('settings.section', ...)`), declared against the slots package's `SlotMap` type | use-host | ../../docs/developer/decisions/0003-agent-plugins-v1-conformance-and-namespace.md |
| `src/runtime/host/host-locale.ts` | Host locale preference read through the settings service projection. | use-host | ../../.agents/notes/implemented/bug-fix/2026-09-24-host-locale-source-read-and-lifetime.md |
| `src/runtime/host/tool-observation.ts` | Listing API is the host's own; no internal layer structure is read. | self-built | ../../.agents/notes/implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md |
| `src/runtime/core/reconcile-scheduler.ts` | Host `deadline` primitive owns the timer; the scheduler races it. | use-host | ../../.agents/notes/implemented/architecture/2026-09-08-runtime-reconciliation-scheduling.md |  | note: @deepseek-ai/dsh-timeout.deadline |
| `src/runtime/host/host-seams.ts` | @deepseek-ai/dsh-subprocess.scrubbedParentEnv @deepseek-ai/dsh-credentials.credentialKey @deepseek-ai/dsh-timeout.MAX_TIMER_DELAY_MS @deepseek-ai/dsh-attachment.admitEncodedImages | use-host | ../../.agents/notes/implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md |
| `src/runtime/mcp/mcp-mounts.ts` | Mounts the host MCP client when the server profile fits it; the local bridge exists only for what the host client cannot serve. | use-host | ../../.agents/notes/implemented/architecture/2026-09-12-shared-primitives-and-declared-seams.md |

## self-built — registered deviations, each with its stated reason

| self-built surface | host counterpart (package/export) | status | decision record |
| --- | --- | --- | --- |
| `src/runtime/mcp/bridge/bridge.ts` | Host MCP client has no OAuth and no SSE; the bridge is the deliberate local client. | self-built | ../../docs/developer/upstream-proposal/mcp-oauth-relocation-plan.md |  | note: @deepseek-ai/dsh-mcp-client evaluated, lacks OAuth/SSE |
| `src/runtime/mcp/bridge/connection.ts` | Same bridge rationale. | self-built | ../../docs/developer/upstream-proposal/mcp-oauth-relocation-plan.md |
| `src/runtime/mcp/bridge/oauth.ts` | Same bridge rationale. | self-built | ../../docs/developer/upstream-proposal/mcp-oauth-relocation-plan.md |
| `src/runtime/mcp/bridge/transport.ts` | Same bridge rationale. | self-built | ../../docs/developer/upstream-proposal/mcp-oauth-relocation-plan.md |
| `src/runtime/mcp/bridge/tools.ts` | Same bridge rationale. | self-built | ../../docs/developer/upstream-proposal/mcp-oauth-relocation-plan.md |
| `src/runtime/mcp/bridge/projection.ts` | Same bridge rationale. | self-built | ../../docs/developer/upstream-proposal/mcp-oauth-relocation-plan.md |
| ~~`src/runtime/mcp/bridge/json-schema-subset.ts`~~ (deleted 2026-09-27) | Local port retired: @deepseek-ai/dsh-tools.assertSupportedJsonSchema, JsonSchemaError and the JsonSchema* types are published from the package root since rc.2 (the host client itself calls them); host-contract.ts and tools.ts now import the package directly. | use-host | ../../docs/developer/upstream-proposal/mcp-oauth-relocation-plan.md |  | note: replaced by the 2026-09-27 follow-up to the 2026-09-26 reuse audit; dsh-tools entered dependencies at rc.1, so the swap added no dependency |
| `src/runtime/mcp/bridge/host-contract.ts` | Same bridge rationale. | self-built | ../../docs/developer/upstream-proposal/mcp-oauth-relocation-plan.md |
| `src/runtime/mcp/bridge/host-seams.ts` | Same bridge rationale. | self-built | ../../docs/developer/upstream-proposal/mcp-oauth-relocation-plan.md |
| `src/runtime/mcp/bridge/plugin-identity.ts` | Same bridge rationale. | self-built | ../../docs/developer/upstream-proposal/mcp-oauth-relocation-plan.md |
| `src/runtime/mcp/mcp-auth-record.ts` | Same bridge rationale. | self-built | ../../docs/developer/upstream-proposal/mcp-oauth-relocation-plan.md |
| `src/application/mcp/mcp-redaction.ts` | Host redaction is schema-driven; a third party's `mcp.json` carries no schema to declare. | self-built | ../../.agents/notes/implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md |
| `src/runtime/core/reconciler.ts` | `ctx.jobs` and the schedule package have different semantics (delta reconciling with settle windows); recorded decision. | self-built | ../../.agents/notes/implemented/architecture/2026-09-08-runtime-reconciliation-scheduling.md |
| `src/runtime/core/source-auto-update.ts` | Same scheduling rationale. | self-built | ../../.agents/notes/implemented/feature/2026-09-12-background-source-updates.md |
| `src/application/snapshot-cache.ts` | Same scheduling rationale. | self-built | ../../.agents/notes/implemented/architecture/2026-09-08-runtime-reconciliation-scheduling.md |
| `src/runtime/lsp/lsp-mounts.ts` | LSP trio is self-provisioned on purpose; the plugin never probes the host for it. | self-built | ../../.agents/notes/implemented/architecture/2026-09-11-self-provisioned-lsp-capability.md |
| `src/client/ui/ResourceCard.tsx` | No published card container primitive; `Pill`/`Tag`/`StateDot` are inline atoms. | self-built | ../../.agents/notes/implemented/architecture/2026-09-12-shared-primitives-and-declared-seams.md |
| `src/client/ui/DetailRows.tsx` | @deepseek-ai/dsh-client-ui-primitives.DisclosureRow is a 24px single-line flow row; the three-column band shape cannot be reconciled from outside. | self-built | ../../.agents/notes/implemented/feature/2026-09-16-detail-row-and-document-body.md |
| `src/client/ui/panel.tsx` | Composite over @deepseek-ai/dsh-client-ui-primitives.Button and the Modal contract (PanelActions/PanelHeader/BusyIndicator/EntryEditorModal/ConfirmModal); the name coincides with the plugin-manager `PANEL` slot id, which is vocabulary rather than an importable name. | self-built | ../../.agents/notes/implemented/architecture/2026-09-12-shared-primitives-and-declared-seams.md |
| `src/client/ui/BusyOverlay.tsx` | No published target-overlay or operation-lease primitive (Toast/Modal/TextShimmer do not cover it). | self-built | ../../.agents/notes/implemented/feature/2026-09-02-market-card-platform-affordances.md |
| `src/client/ui/busy-operation.ts` | Lease counter for the overlay above. | self-built | ../../.agents/notes/implemented/feature/2026-09-02-market-card-platform-affordances.md |
| `src/client/ui/CodeEditor.tsx` | Published code blocks (ReadBlock/CodeBlock/TerminalBlock) are read-only; an editor does not exist upstream. | self-built | ../../.agents/notes/implemented/feature/2026-09-16-workspace-document-editor.md |
| `src/client/ui/SearchFilterToolbar.tsx` | @deepseek-ai/dsh-client-ui-primitives.SegmentedControl carries the filters, @deepseek-ai/dsh-client-ui-primitives.Input the search box, and @deepseek-ai/dsh-client-ui-primitives.Pill the view switch; only the flex track and the container query stay local. | use-host | ../../.agents/notes/implemented/architecture/2026-09-12-shared-primitives-and-declared-seams.md |  | note: the SegmentedControl adoption landed; the caller owns the tablist id (`filterId`) and the panels the tabs name |
| `src/client/ui/SourceTabsRow.tsx` | No published primitive carries a collapsible pill grid with trailing edit/delete actions. | self-built | ../../.agents/notes/implemented/feature/2026-09-02-market-card-platform-affordances.md |
| `src/client/ui/StatusBand.tsx` | Composes published atoms (StateDot/DisclosureRow); the failure taxonomy is domain language. | self-built | ../../.agents/notes/implemented/architecture/2026-09-12-shared-primitives-and-declared-seams.md |
| `src/client/ui/server-form.ts` | `mcpServers`/harness namespace document model, paste parsing and timeout policy are wire-contract domain. | self-built | ../../.agents/notes/implemented/feature/2026-09-22-self-service-mcp-configuration.md |
| `src/client/ui/failure-guidance.ts` | Twenty-class failure classifier over mount/MCP/LSP/host vocabulary. | self-built | ../../.agents/notes/implemented/feature/2026-09-24-failure-report-with-cause-chain.md |
| `src/client/ui/frontmatter.ts` | Frontmatter parse keeps comments and dual argument-hint spellings. | self-built | ../../.agents/notes/implemented/bug-fix/2026-09-22-declared-skill-directory-is-one-skill.md |
| `src/runtime/panels/user-panels.ts` | The panel is the authoring and control surface for the `~/.agents/skills` root (Web CRUD, diagnostics, switch); @deepseek-ai/dsh-skill-filesystem is the discovery implementation for every root this plugin does not present. The one shared directory is arbitrated by registry rank (panel 440 below the host user root 500). | self-built | ../../docs/developer/decisions/2026-09-27-user-skill-scanning-boundary.md |
| `src/client/features/market/market-resource.ts` | Overview cache and progress polling; `ctx.jobs` semantics differ (recorded decision). | self-built | ../../.agents/notes/implemented/architecture/2026-09-02-catalog-scan-cache.md |
| `src/client/features/market/InstallConfirmModal.tsx` | @deepseek-ai/dsh-client-ui-primitives.RiskConfirmation evaluated and declined: its `description` is a plain string and cannot carry the per-surface install counts, and the acknowledgement gate over-weights a reversible install (the same component already guards irreversible uninstall). | self-built | ../../.agents/notes/implemented/architecture/2026-09-27-plugin-card-controller-onto-host-form.md |
| `src/client/ui/McpCredentialFields.tsx` | Write-only credential controls are @deepseek-ai/dsh-client-ui-primitives.SettingsSecretField; the write-once guarantee rides the settings-form model's SettingsSecretSpec.write. | use-host | ../../.agents/notes/implemented/architecture/2026-09-27-plugin-card-controller-onto-host-form.md |  | note: replaced McpCredentialEditor.tsx (deleted 2026-09-27); shared by the detail dialog and the service editor |

## wait-host — nothing is queued here today

| self-built surface                                                                                      | host counterpart (package/export) | status    | decision record |
| ------------------------------------------------------------------------------------------------------- | --------------------------------- | --------- | --------------- |
| _none_ — every deviation above is decided, and the P1/P2 backlogs live on `self-built` rows with notes. | -                                 | wait-host | -               |

## Lookahead (host monorepo has it, npm does not publish it — not actionable)

`ConfigField` (ui-primitives, present in the rc.2 tarball but absent from the public index) and `CodeCard` (CSS shipped, no component types). When a future release exports either, re-evaluate the P1 form-field layer and the CodeEditor preview half. The gate ignores these on purpose: rule R2 checks published packages only, and a lookahead name is not an importable contract.
