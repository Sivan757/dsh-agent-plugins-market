---
title: Compatible plugin marketplaces and formats
description: Which Claude Code, Codex, Cursor, Kimi, ZCode, Qoder CLI and GitHub Copilot CLI plugin marketplaces and formats work inside DeepSeek Harness via dsh-agent-plugins-market.
layout: doc
---

# Compatible plugin marketplaces {#compatible-plugin-marketplaces}

Any git repository carrying one of the supported manifests can be added as a source. One repo may carry several dialects at once; identity follows manifest precedence while declared component paths resolve into resources shared by discovery, runtime and detail views.

## Repositories and format references

- [anthropics/claude-code (official ecosystem)](https://github.com/anthropics/claude-code) — reference project for the Claude Code ecosystem; this list includes format references as well as suite repositories.
- [vercel/vercel-plugin](https://github.com/vercel/vercel-plugin) — multi-client repo that ships agent-plugins, .claude-plugin, .cursor-plugin and .kimi-plugin manifests at once — a good stress test for dialect precedence.
- [agentplugins/agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec) — the portable agent-plugins.org v1.0.0 suite spec. Suites with plugin.json are validated against the vendored 1.0.0 JSON Schema.

_This list is community-maintained — [open a PR](https://github.com/Sivan757/dsh-agent-plugins-market) to add a marketplace you tested._

Layout support does not imply full compatibility with the original platform. Project commands, supported JSON/Codex TOML MCP configurations and mapped command hooks mount in the calling agent's scope. The `scanProjectLayouts` setting controls native project discovery. Project LSP is diagnosed and not mounted; host API changes are outside this plugin's scope.

## What gets injected

- Supported skills enter the host skill catalog; root placeholders such as `${CLAUDE_PLUGIN_ROOT}` are substituted and invocation settings are respected.
- A repository with no manifest still works when skill discovery finds at least one skill: a flat `skills/<name>/SKILL.md` collection becomes one suite. Qualification follows discovery, not directory shape, so an unrelated repository is not scanned as a suite.
- Valid MCP declarations use the built-in bridge by default; optional host-client compatibility mode is available. The bridge enables OAuth 2.1 by default and activates it only on a server's `401` challenge, so a suite needs no OAuth declaration.
- `hooks/hooks.json` bridges to DSH interception points: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart, SubagentStop.
- Commands use the host slash registry. Roles enter a dynamic subagent catalog and run through `subagent_run` with their saved provider, model, reasoning effort and tool restrictions; this requires host agents, tools, LLM and subagents.
- LSP declarations mount through the LSP packages the plugin installs itself; only the language-server executable has to be on PATH.

## Runtime surfaces

Supported runtime surfaces describe what DSH can use from a suite.

| Surface | Runtime support and conditions |
| --- | --- |
| Skills | Host skill catalog and user-invocable slash entries. Supported root placeholders are expanded. |
| Commands | Slash commands through the host command service. |
| Agents | Dynamic role catalog. Use `subagent_role` without Agent Teams and `spawn_teammate_role` with it. Team mode also requires the session query and system-prompt services. |
| MCP | Built-in bridge by default, with stdio, Streamable HTTP with OAuth and legacy SSE. The optional host-client compatibility mode enforces the tool-call timeout but not tool filters or a startup timeout. |
| Hooks | The command-hook subset mapped by dsh-hooks-claude-code. |
| LSP | Self-provisioned. Installing the plugin is the whole setup, and lsp mounts only while a language server is wanted. The server executable must be on PATH. |

## Shared layout precedence {#shared-layout-precedence}

Suite manifests and Marketplace catalogs follow the same layout order. Catalog lookup skips layouts without a dedicated catalog; aliases follow the order shown.

| Layout (highest priority first) | Suite manifest | Marketplace catalog |
| --- | --- | --- |
| [agent-plugins](https://agent-plugins.org) / root compatibility | `plugin.json` | No dedicated catalog |
| Universal | `.plugin/plugin.json` | `.plugin/marketplace.json` |
| Claude Code | `.claude-plugin/plugin.json` | `.claude-plugin/marketplace.json` |
| Cursor | `.cursor-plugin/plugin.json` | `.cursor-plugin/marketplace.json` |
| Kimi Code | `kimi.plugin.json`, then `.kimi-plugin/plugin.json` | `.kimi-plugin/marketplace.json` |
| Codex | `.codex-plugin/plugin.json` | `.agents/plugins/marketplace.json`, then `.agents/plugins/api_marketplace.json` |
| ZCode | `.zcode-plugin/plugin.json` | No dedicated catalog |
| Qoder CLI | `.qoder-plugin/plugin.json` | `.qoder-plugin/marketplace.json` |
| GitHub Copilot CLI | `.github/plugin/plugin.json` | `.github/plugin/marketplace.json` |
| Fallback: skill collection / shared catalog | Discover skills when no recognized manifest exists | Root `marketplace.json` |

Manifest selection uses the first existing file and fails closed if it is invalid. A manifest that cannot be read or validated is reported and the next one is tried, down to the fallback. If every candidate fails, the suite is diagnosed instead of loading half of it. Root `plugin.json` uses strict v1 validation only with a recognized agent-plugins.org schema; otherwise it is Claude-compatible. For such a root manifest, missing component declarations can come from `.claude-plugin/plugin.json`: explicit root declarations win, and marketplace entry declarations fill the remaining gaps. Catalog scanning selects the first catalog that produces suites. Invalid or empty catalogs allow later candidates. Root `marketplace.json` is a shared fallback, not a v1 or skill-collection catalog, and does not inherit root manifest priority.

The order is defined in [`packages/market-contracts/src/model/layouts.ts`](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/packages/market-contracts/src/model/layouts.ts). Selection and root-manifest fallback are implemented in [`packages/market-catalog/src/scanning/manifests.ts`](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/packages/market-catalog/src/scanning/manifests.ts).

## Layout support matrix

The table says per layout whether this plugin reads a given surface at all. **Yes** means the layout's own files are read and injected. **Partial** means only part of the formats is understood, or the upstream layout has no such definition; the notes below say which.

| Layout                                  | Skills | Agents  | Commands | MCP     | Hooks   | LSP     |
| --------------------------------------- | ------ | ------- | -------- | ------- | ------- | ------- |
| Claude Code                             | Yes    | Yes     | Yes      | Yes     | Partial | Yes     |
| Codex                                   | Yes    | Yes     | Yes      | Partial | Partial | Yes     |
| Cursor                                  | Yes    | Partial | Partial  | Partial | No      | Yes     |
| Kimi Code                               | Yes    | Yes     | Yes      | Yes     | Partial | Partial |
| ZCode                                   | Yes    | Yes     | Yes      | Yes     | Partial | Partial |
| Qoder CLI                               | Yes    | Yes     | Yes      | Partial | Partial | Partial |
| GitHub Copilot CLI                      | Yes    | Yes     | Yes      | Yes     | Partial | Yes     |
| Universal compatibility layout .plugin/ | Yes    | Yes     | Yes      | Yes     | Partial | Yes     |
| agent-plugins                           | Yes    | Yes     | Yes      | Yes     | Yes     | Yes     |
| Manifest-less skill collection          | Yes    | Yes     | Yes      | Yes     | Partial | Partial |
| Project-native directories              | Yes    | Yes     | Yes      | Yes     | Partial | No      |

- Skills are read from the paths a manifest declares and from the conventional `skills/` directory, including flat `<name>.md` files. A path that carries its own `SKILL.md` is one skill: the documents beside it belong to that skill and are not read as skills. A conformant agent-plugins package is the exception: skills come from one level of `skills/` subdirectories, exactly as its specification requires.
- Agents and commands are read as Markdown (`agents/*.md`, `commands/*.md`). Cursor plugin commands accept `.md`, `.mdc`, `.markdown` and `.txt`. Codex and Kimi native agent and command formats (TOML, YAML) have no adapter yet.
- MCP covers declared files, inline tables and arrays. Cursor's schema-less `mcp.json` and the strict agent-plugins `mcp.json` both work; Kimi Code is inline-only. Codex app connectors stay outside this adapter.
- Hooks map the command-style events DSH has an equivalent for. Events without one, for example `afterFileEdit`, are reported instead of simulated. Cursor native events are not read.
- LSP accepts declared files, arrays and inline tables plus the conventional `.lsp.json` and `lsp.json` locations. Declarations inside a project are reported but not mounted, because the host LSP registry is global. Some layouts only expose LSP directories for preview.
- agent-plugins suites read the portable core (`skills/`, `mcp.json`) per the specification, plus the [`com.deepseek.harness`](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/schemas/com.deepseek.harness/spec.md) extension namespace for commands, agents, hooks, LSP and per-server MCP policy. Root-level `commands/`, `agents/`, `hooks/` and `.mcp.json` files belong to other layouts and are reported as unread for this dialect. Inline manifest component keys are reported and ignored per section 5.2. Both recognized releases (1.0.0 and 1.1.0) validate against their own vendored schemas.
- Universal is a compatibility-layout label used by this plugin. The [OpenHands SDK](https://docs.openhands.dev/sdk/guides/plugins) documents the same `.plugin/plugin.json` location and a [Vercel repository](https://github.com/vercel/vercel-plugin/blob/main/.plugin/plugin.json) uses it, but no cross-vendor specification exists.

Sources such as [jeecgboot/skills](https://github.com/jeecgboot/skills) group undeclared, skill-only directories into one plugin card. Marketplace entries and roots with plugin manifests or other runtime surfaces retain their separate identities. The aggregate requires its own installation and does not inherit individual skill installs. See the [skill collection rules](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/schemas/skill-collection/spec.md).

Reading a layout does not guarantee every behavior of its original platform. Invalid declarations are diagnosed and skipped.

## Project layout switch

The plugin settings card has **Scan project Agent layouts** (`dsh-agent-plugins-market.scanProjectLayouts`, default off). It controls one thing: whether the project you are working in contributes skills, commands, agent roles, MCP servers and hooks from its own directories (`.claude`, `.agents`, `.codex`, `.cursor`, `.kimi`, `.zcode`, `.qoder`, `.github`). Turning it on adds those candidates; turning it off removes them on the next discovery pass. The card applies the switch when you save it, and each setting offers Use default while it carries your own value. Configured sources and installed suites are unaffected.

[Project layouts](/docs/resources#project-layouts) lists the directories and files read per layout and how they are mounted.

## Verified samples

The README repositories have offline snapshots in [`tests/fixtures/real-layouts/`](https://github.com/Sivan757/dsh-agent-plugins-market/tree/main/tests/fixtures/real-layouts) with commit IDs, hashes and licenses, and each layout has an isolated reader test. All ten active schema layouts have offline README-repository tests, including isolated variants that suppress competing manifests at nested suite roots. Cursor, Kimi, Qoder, Copilot, Universal and root marketplace files are recognized alongside Claude Code and Codex catalogs. The [compatibility report](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/docs/reference/compat-report.md) exercises every schema against one real repository and records the commit, the schema verdict and what the scanner did with it. The [layout audit](/docs/layout-coverage) records independent resource checks.

These are documentation, source and sample checks — not end-to-end certification for every platform. Review third-party suites before enabling them: enabled services and hooks can execute programs.
