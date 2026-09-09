# Layout declarations and project discovery

Status: implemented

## Context

The scan strategy chain already separates marketplace, rooted and flat collection discovery. Replacing that chain would add migration cost without improving layout extensibility. Its inputs were scattered: manifest kinds, path precedence and project conventions were maintained independently. Project candidates also reached the skill provider without an equivalent project-aware agent execution path.

## Decision

`src/model/layouts.ts` owns pure layout declarations. `manifests.ts` consumes the ordered plugin declarations; `native-project.ts` consumes explicit project directory and portable surface declarations. `SuiteLayoutKind` derives its manifest variants from the registry. Source identity, layout dialect and runtime surface remain separate concepts.

Marketplace paths derive directly from the same ordered plugin declarations: Universal, Claude Code, Cursor, Kimi Code, Codex (standard then API alias), Qoder CLI and Copilot. Layouts without dedicated catalogs contribute no path; shared root `marketplace.json` remains last. The first productive catalog wins, with invalid or empty catalogs allowing later candidates. This replaces the separate Claude/Codex-first marketplace order; suite manifest precedence stays unchanged. See the [precedence decision](../../.agents/notes/implemented/architecture/2026-09-09-unified-layout-precedence.md).

The host namespace `dsh-agent-plugins-market` exposes `scanProjectLayouts: boolean`, default `true` to preserve existing project discovery. The setting controls native project directory discovery only. Configured sources and `.dsh/agent-plugins` install state retain their meaning. Changes invalidate discovery and project snapshots, then notify providers and reconciliation. The value participates in the discovery fingerprint so an older scan cannot supply a differently configured snapshot.

Project files remain read-only synthetic suites. Each suite declares allowed surfaces explicitly; the catalog must preserve that mask. A skill-only layout must not accidentally expose arbitrary Markdown under `agents/`. Project agent execution derives the root from the calling session's `session.header.cwd` and rechecks the current catalog on every invocation. It never accepts a project root from model arguments.

## Current implementation

- ZCode `.zcode-plugin/plugin.json`, Qoder `.qoder-plugin/plugin.json`, Copilot `.github/plugin/plugin.json`; suite manifest precedence remains stable.
- Qoder, Copilot, universal and root marketplace discovery, including ZCode keyed plugin maps. Malformed entries produce scan notes.
- Remote entries with a subdirectory stay remote; source self-references resolve the declared subdirectory.
- Explicit project declarations for `.claude`, `.agents`, `.codex`, `.cursor`, `.kimi`, `.zcode`, `.qoder` and `.github`.
- Qoder dot-prefixed MCP precedence, Copilot `.github/mcp.json`, and ZCode inline-over-file MCP merging.
- Bilingual settings control and project-aware role execution.
- Project commands register under command-injected children of `agent.ctx`, following the host's `CommandRuntime` scoped layer contract. Existing/new agents attach independently; session startup and catalog mutations refresh commands; agent disposal and plugin teardown unwind registrations. Tests cover same-named commands in two projects, switch changes and disposal during discovery.
- Invalid declared manifests cannot fall back to skill collections; rejection reasons reach source scan notes. Local marketplace paths, including remote self-reference subdirectories, must resolve inside the checkout by realpath.
- `project-runtime.ts` shares agent attachment, serialized refresh and disposal across independent command and MCP children. MCP reads project `.mcp.json`, Cursor `.cursor/mcp.json`, and Qoder's project/local settings MCP tables. It ignores unrelated settings, resolves relative commands from the project root, and rejects malformed overriding layers. Each layout remains a separate DSH suite; shared `.mcp.json` is read once, not once per client. Cross-layout names are namespaced rather than reproducing one client's cross-source priority.
- MCP tools mount in the agent's injected tools scope. Since bridge server names are reserved app-wide, project namespaces additionally include the session identity (hashed/truncated by the existing naming function). Two agents, including two agents in one project, can mount the same server key independently. The backend setting applies to project mounts as well.

## Runtime coverage

Native Claude/Qoder settings hooks and enabled ZCode configuration hooks now use the existing execution bridge under each agent. Normalization rejects malformed groups, reports unsupported events/types, deduplicates identical hooks and preserves disable flags. The bridge receives a private runtime-generated JSON snapshot containing hooks only; project files are never rewritten. Fingerprint changes remount hooks, and teardown removes the snapshot. This is a derived runtime artifact, not a copied plugin installation.

ZCode MCP now reads `mcp.servers` from `zcode.json` followed by `.zcode/config.json`; `.agents/mcp.json` is a fallback only when the native files contain no server entries. Disabled entries do not run. The compatibility report has been regenerated from a freshly compiled scanner and uses the shared marketplace registry.

1. The registry and table-driven tests cover `.claude`, `.agents`, `.codex`, `.cursor`, `.kimi`, `.zcode`, `.qoder` and `.github`. Portable and Universal content shares `.agents`; the adapter does not invent a native directory for every manifest dialect. These are supported DSH surfaces, not a reimplementation of each original client's rule/trust/model engine.
2. Codex `.codex/config.toml` MCP tables use the user-approved `smol-toml` dependency. Transport, environment/header references, enabled flags, tool allow/deny lists and timeouts reach the existing mount pipeline. Unknown or malformed server options reject that server with diagnostics. Empty allowlists expose no tools; filtering applies on every synchronization. Host-client compatibility mode rejects policies it cannot enforce rather than dropping them. Startup timeouts apply to initialization and tool-list requests; DSH owns retry/failure containment.
3. Copilot compound suffixes and root variables are covered through runtime consumers. Declared component files/directories/arrays and inline configurations are now consumed through a shared resource model, as recorded in the [schema component decision](../../.agents/notes/implemented/architecture/2026-09-09-schema-components.md). Nonportable native agent types and hook semantics remain explicit boundaries, not simulated implementations.
4. Declared-manifest fallback, realpath containment, malformed settings/TOML and mount policy preservation are covered by focused regression tests. Unsupported project LSP files/inline tables produce diagnostics and stay inactive.
5. The real-repository report recompiles the scanner and reads its marketplace registry. Six samples remain shadowed by higher-priority manifests; isolated fixtures separately exercise the new identities. The report is a dated measurement, not full upstream-client certification.
6. Provider/snapshot and scoped runtime tests cover toggles, two projects, teardown and in-flight discovery. The settings switch was also checked in the real UI across browser reload and an isolated host-process restart. The host mobile dialog issue described below is outside this plugin's scope.

## Alternatives

Keeping another independent kind union and switch per new dialect makes omissions likely. Replacing the strategy chain is unnecessary because its extension interface is already adequate. Globally mounting every discovered project suite would leak commands and services between sessions. Native instruction files and rule-merging semantics belong to the harness, not the plugin market.

## Evidence

Local reference contracts: `schemas/zcode/spec.md`, `schemas/qoder/spec.md`, `schemas/github-copilot/spec.md`. Official authoring pages were re-fetched on 2026-09-09: [ZCode](https://zcode.z.ai/en/docs/plugin), [Qoder](https://docs.qoder.com/cli/plugins-reference), [Copilot](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference). Project-specific assertions still require the checks above.

Qoder project paths verified directly on 2026-09-09: [Skills](https://docs.qoder.com/cli/Skills.md) declares `.qoder/skills/<name>/SKILL.md`; [Subagent](https://docs.qoder.com/cli/subagent.md) declares `.qoder/agents/*.md`; [Commands](https://docs.qoder.com/cli/commands.md) declares `.qoder/commands/*.md`. Its [MCP reference](https://docs.qoder.com/cli/mcp-reference.md) distinguishes project `settings.json`, root `.mcp.json`, and machine-local `settings.local.json`, with explicit approval semantics. These configurations cannot be collapsed into the plugin-file reader without handling their precedence and authorization model.

Host command scope was verified from `deepseek-harness/packages/interaction/commands/src/index.ts`: command-injected children of `agent.ctx` create scoped layers which shadow global commands for that agent. `packages/context/file-reference-local/src/index.ts` demonstrates existing-agent attachment, creation/disposal events and owned fiber teardown. The market adds no new dependency for this integration.

ZCode 3.11.2 was verified from the installed application's `Info.plist`, `Resources/glm/zcode.cjs`, and first-party `zcode-guide-plugin/skills/{diagnosing-skills,diagnosing-commands,diagnosing-mcp,diagnosing-hooks,zcode-configuration-guide}/SKILL.md`. These establish `.zcode/skills`, `.zcode/commands`, the nested MCP table/fallback, and hooks with `enabled: true` plus an `events` map. The runtime's agent loader explicitly reads `<workingDirectory>/.zcode/agents`.

## Verification status

`check:refactor`, the plugin build, the Astro docs build and regeneration of all nine real-repository report samples pass. The live DSH Web settings page displays the project-scan switch at 1280x900 without overlap. A card-local container query fixes the new label's narrow-column wrapping at 390x844 (72px wide, two lines), but the host's mobile settings dialog is occluded by its main interface; that host-level visual issue remains unresolved.

An isolated DSH profile using the installed base/web bundles and this linked plugin verifies persistence through the real settings UI: default true, false after clicking the switch, false after a browser reload, and false in a new browser after terminating and restarting the host process. The value is stored under the isolated `DSH_HOME/settings.yaml`; the existing user instance is untouched. Both validation host processes were stopped after the check.

Copilot `.agent.md` invocation names now omit the compound suffix while role IDs retain the exact source stem. Plain `.md` files win normalized alias collisions consistently in the command and skill providers. Ordinary skills beginning with `agent-` remain ordinary skills; provider kind is explicit rather than inferred from the name.

## Scope decision

The user approved the `smol-toml` dependency and explicitly prohibited modifying `deepseek-harness`. The dependency uses the already-resolved 1.8 series; a hand-written partial parser was rejected. No sibling repository is modified.

New layouts and project scanning do not require host changes. Only the separately proposed per-project LSP runtime would have needed them: the host owns a global extension-to-provider map and its query carries no calling-agent scope. That extension was declined and is not a prerequisite for layout support. This plugin diagnoses project LSP declarations and keeps that surface inactive, while retaining existing user-level LSP behavior. Future scoped LSP work would require a separate host change and approval.

Codex MCP field mapping was checked against `openai/codex`'s `codex-rs/core/src/config/types.rs` in the local source checkout. The tests exercise TOML parsing through mount requests and bridge tool filtering, including invalid controls and missing-credential handling.
