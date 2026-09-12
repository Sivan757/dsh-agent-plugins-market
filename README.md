<img src="docs-site/public/favicon.svg" alt="" width="48" height="48" />

# dsh-agent-plugins-market

**A plugin marketplace and agent capability workspace for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).**

Reuse supported content from Claude Code, Codex, Cursor, Kimi and other recognized layouts. Manage your own skills, commands, agent personas, MCP services and LSP servers in the DSH Web GUI. Supported layouts are read in place, without converting manifests or manually copying files into DSH. See the capability matrix for format-specific limits.

English | [简体中文](README.zh.md) | [Documentation](https://sivan757.github.io/dsh-agent-plugins-market/) | [npm](https://www.npmjs.com/package/dsh-agent-plugins-market)

[![npm version](https://img.shields.io/npm/v/dsh-agent-plugins-market)](https://www.npmjs.com/package/dsh-agent-plugins-market) [![License](https://img.shields.io/github/license/Sivan757/dsh-agent-plugins-market)](LICENSE)

[Quick start](#quick-start) · [Everyday use](#everyday-use) · [Compatibility](#compatibility-and-boundaries) · [FAQ](#faq)

![Current six-tab Agent Plugins workspace](docs/screenshot-workspace.png)

## What you can do

- **Read-in-place compatibility.** Ten recognized suite layouts — Claude Code, Codex, Cursor, Kimi Code, ZCode, Qoder CLI, GitHub Copilot CLI, Universal `.plugin/`, agent-plugins.org v1 and manifest-less skill collections — plus project-native directories. Manifests are not converted and files are not copied into DSH.
- **Sources.** Add a Git repository, a local directory or an archive (`.zip` / `.tar.gz` / `.tgz` / `.tar`); adopt a checkout you cloned yourself; refresh on demand; delete a managed checkout when you remove its source.
- **Network and mirrors.** A download-region setting — default `auto` follows the interface language, or pick global / China mainland — chooses the mirror prefix for `github.com` clones. The host config adds a proxy, `insteadOf` URL rewrites, a per-invocation timeout, an automatic clone retry and an optional GitHub tarball fallback.
- **Runtime surfaces.** Enabled suites inject into sessions: skills into the catalog and slash menu, commands as `/name`, agent personas into the subagent catalog, MCP tools with an `mcp__` prefix, hooks onto host lifecycle events, and language servers through the `lsp` tool. See [the runtime surface table](#compatibility-and-boundaries) for per-surface conditions.
- **MCP.** A built-in bridge runs stdio, Streamable HTTP with OAuth and legacy SSE without a host MCP client. `${VAR}` references resolve from the host credential store (or the launch environment); per-server overrides disable or patch a declaration without editing the source; an optional host-client compatibility mode is available without OAuth or legacy SSE. Tools register as `mcp__<suite>__<server>__<tool>`, and a namespace another MCP client already owns is skipped with a diagnostic instead of mounting twice.
- **LSP.** Self-provisioned: installing the plugin is the whole setup, and the `lsp` tool mounts only while a language server is wanted. The language-server executable itself must be on `PATH`.
- **Agent personas and delegation.** Role cards save an exact provider, model and reasoning effort; they appear in the session catalog and run through `subagent_run`, which starts a durable background child and returns its id immediately. The runtime reports the outcome when it settles, and `send_message` steers the child while it runs.
- **Project dimension.** Project-native skills, agents, commands, MCP servers and hooks are discovered in place with no install step; the project-scan switch controls the whole dimension.
- **Your own resources.** Author skills, commands and agent personas as Markdown under `~/.dsh/agent-plugins/user/`, then edit them or disable them without deleting the files.
- **Web workspace.** Six tabs — Market, Skills, Commands, Agent personas, MCP services and LSP servers — each with search, filters and a grid/list toggle, plus status panels with diagnostics, credential editing, and an install confirmation that warns before executable third-party content is enabled.
- **Bilingual interface and feedback.** Workspace strings and injected prompts follow the host language. With feedback enabled, the model can file a `report_market_issue` report to the plugin repository, or save it locally when no token is available.

## Quick start

You need Node.js 22+, Git for Git sources, and a DSH Web profile with the skill service enabled. This repository declares the DSH host packages it needs in the `^0.1.5-rc.2` range; individual capabilities also depend on the services in your profile. See [host requirements](docs/guides/usage.md#host-requirements).

Install into your profile, replacing `<name>` with its name:

```sh
dsh plugin --profile <name> add dsh-agent-plugins-market
```

1. Restart DSH and open **Settings → Agent Plugins Market**. Older shells may show a top-level page entry instead.
2. In **Market**, add a source, for example `https://github.com/anthropics/claude-plugins-official`. No sources are preconfigured.
3. Open a suite, review its contents, then install it and ensure it is enabled.
4. For a suite with skills, check the **Skills** tab and type `/` in chat to find its user-invocable skills. For an MCP suite, check **MCP services** and resolve any credential or connection notices before using its tools.

For GitHub installation and profile configuration, see the [usage guide](docs/guides/usage.md#installation-options).

## Everyday use

MCP details separate Retry connection (keeps credentials) from confirmed OAuth reauthorization. There is no enable switch in the detail dialog.

The workspace has six tabs:

| Tab            | Use it to                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Market         | Add sources, preview suites, install / uninstall, enable / disable and refresh.                                                              |
| Skills         | Browse skills and create or edit your own reusable instructions.                                                                             |
| Commands       | Manage prompt templates invoked as `/name`; `$ARGUMENTS` inserts the text supplied after the command.                                        |
| Agent personas | Manage role instructions and save an exact provider, model and reasoning effort per role; delegate in the background through `subagent_run`. |
| MCP services   | Add a service or configure an installed one, its credentials and authorization; inspect status and retry failures.                           |
| LSP servers    | Add and configure language servers and inspect their runtime status.                                                                         |

A **source** is where content comes from; a **suite** is an installable unit discovered there. Adding a source discovers its suites. Installing and enabling a suite controls its runtime capabilities. Suite details preview files; MCP credentials and overrides are edited in **MCP services**.

Your own skills, commands and personas are stored as Markdown under `~/.dsh/agent-plugins/user/`. Project-native resources stay in the project. See [storage and discovery](docs/guides/usage.md#storage-and-discovery) for paths and precedence.

All six tabs share a saved grid/list preference. Add and refresh actions sit at the top right; resource state rails are green when active.

Resource details share a wide dialog. Markdown resources open with rendered content and structured frontmatter; switch to Markdown to edit. MCP/LSP provide fixed forms and JSON editing over the same configuration.

Services you add yourself are validated before saving, persist under `~/.dsh/agent-plugins/data/`, and mount through the same lifecycle as suite services. Services observed from the host configuration stay read-only.

Asynchronous workspace actions show a blocking overlay on the active settings panel or detail dialog, with rotating waiting messages. The overlay is released on success or failure; background status polling stays silent.

## Compatibility and boundaries

Supported **layout dialects** describe how files are organized. The [shared priority table](#layout-detection-precedence) lists suite manifests and Marketplace catalogs together.

All ten active layout contracts in [`schemas/`](schemas/README.md) have independent reader tests. [The layout audit](docs/layout-coverage.md) maps them to commit-pinned README repository fixtures and distinguishes layout/component compatibility from full original-client runtime equivalence.

Supported **runtime surfaces** describe what DSH can use:

| Surface  | Runtime support and conditions                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skills   | Host skill catalog and user-invocable slash entries; supported root placeholders are expanded.                                                                |
| Commands | Slash commands through the host command service.                                                                                                              |
| Agents   | Dynamic subagent catalog and `subagent_run`; requires host agents, tools, LLM, subagent and session-persistence services.                                     |
| MCP      | Built-in bridge by default: stdio, Streamable HTTP with OAuth, and legacy SSE. Optional host-client compatibility mode is also available.                     |
| Hooks    | The command-hook subset mapped by `dsh-hooks-claude-code`.                                                                                                    |
| LSP      | Self-provisioned: installing the plugin is the whole setup, and `lsp` mounts only while a language server is wanted; the server executable must be on `PATH`. |

Agent roles appear in the session catalog and run through `subagent_run(agent, prompt)`, which starts a durable background child and returns its id immediately; the runtime reports the outcome when it settles and `send_message` steers it while it runs. A role may save an exact `provider` plus `model` pair and a `reasoning_effort`; every other declaration is ignored and the child inherits the parent route. `tools` and `disallowedTools` are preserved in the file but never applied. See [agent roles](docs/guides/agent-roles.md) for the frontmatter fields and limits.

### Layout detection precedence

When multiple manifests exist in the **same suite directory**, the first existing file in this order selects the layout:

| Priority | Layout | Suite manifest | Marketplace catalog |
| --- | --- | --- | --- |
| 1 | agent-plugins.org v1 / root compatibility | `plugin.json` | No dedicated catalog |
| 2 | Universal compatibility | `.plugin/plugin.json` | `.plugin/marketplace.json` |
| 3 | Claude Code | `.claude-plugin/plugin.json` | `.claude-plugin/marketplace.json` |
| 4 | Cursor | `.cursor-plugin/plugin.json` | `.cursor-plugin/marketplace.json` |
| 5 | Kimi Code | `kimi.plugin.json`, then `.kimi-plugin/plugin.json` | `.kimi-plugin/marketplace.json` |
| 6 | Codex | `.codex-plugin/plugin.json` | `.agents/plugins/marketplace.json`, then `.agents/plugins/api_marketplace.json` |
| 7 | ZCode | `.zcode-plugin/plugin.json` | No dedicated catalog |
| 8 | Qoder CLI | `.qoder-plugin/plugin.json` | `.qoder-plugin/marketplace.json` |
| 9 | GitHub Copilot CLI | `.github/plugin/plugin.json` | `.github/plugin/marketplace.json` |
| Fallback | Skill collection / shared catalog | Discover skills when no recognized manifest exists | Root `marketplace.json` |

- **Selection precedes parsing:** an invalid higher-priority manifest produces diagnostics; it does not trigger a retry with a lower-priority manifest.
- **Root manifest identity:** root `plugin.json` uses strict v1 validation only when it declares a recognized agent-plugins.org `$schema`. Otherwise it is read as a Claude-compatible manifest.
- **Component fallback:** manifests are not generally merged. For a non-v1 root `plugin.json`, missing component declarations can come from `.claude-plugin/plugin.json`. Explicit root declarations win; marketplace entry declarations fill remaining gaps.

**Both columns follow the same layout priority.** Catalog lookup skips layouts without a dedicated catalog; aliases are tried in the listed order. Root `marketplace.json` is a shared fallback, not a skill-collection manifest or an agent-plugins.org v1 catalog, and does not inherit the priority of root `plugin.json`.

All existing catalogs are read, but suite scanning selects the first catalog that produces suites, rather than merging every catalog. Invalid or empty catalogs allow the next candidate to be tried. This priority does not make native project directories mutually exclusive.

The order is defined in [`src/model/layouts.ts`](src/model/layouts.ts); selection and root-manifest fallback are implemented in [`src/catalog/manifests.ts`](src/catalog/manifests.ts).

### Layout capability matrix

Checked against official documentation, this plugin's source, and one real repository per schema on 2026-09-08. This table describes **integration by this plugin**. “Shared” means the plugin's common scanning conventions, not an upstream-defined capability. “Partial” requires the limitations below. The [compatibility report](docs/compat-report.md) records the sampled repositories, their commits, the schema verdicts and the scanner output.

| Layout | Skills | Agents | Commands | MCP | Hooks | LSP |
| --- | --- | --- | --- | --- | --- | --- |
| [Claude Code](https://code.claude.com/docs/en/plugins-reference) | Declared + default skills | Declared Markdown | Declared Markdown | Files / inline | Command-hook subset | Files / inline |
| [Codex](https://developers.openai.com/plugins/build/plugins) | Supported | Shared | Shared | Partial: `.mcp.json` | Compatible event subset | Shared inline |
| [Cursor](https://cursor.com/docs/reference/plugins) | Supported | Partial: `.md` only | Partial: `.md` only | Partial: see below | Native events unsupported | Shared inline |
| Kimi Code | Declared skills + startup | Declared Markdown | Declared commands | Inline | Inline command events | Shared extension, non-native |
| [ZCode](https://zcode.z.ai/en/docs/plugin) `.zcode-plugin/` | Shared | Shared | Shared | `.mcp.json` + inline overrides | Shared | Shared inline, non-native |
| [Qoder CLI](https://docs.qoder.com/cli/plugins-reference) `.qoder-plugin/` | Shared | Shared | Shared | Partial: prefers `.mcp.json` | Shared | Shared inline, non-native |
| [GitHub Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference) | Declared skills | `.md` / `.agent.md` | Declared Markdown | Files / inline | Mapped command events | Files / inline |
| Universal compatibility layout `.plugin/` | Shared | Shared | Shared | Shared | Claude-format subset | Shared inline |
| [agent-plugins.org v1](https://agent-plugins.org/specification) | Supported | Shared, nonstandard | Shared, nonstandard | Standard `mcp.json` | Shared, nonstandard | Directory preview only, nonstandard |
| Manifest-less skill collection | Supported | Shared | Shared | Shared files | Claude-format subset | Directory preview only |
| Project-native directories (see below) | Supported | Portable Markdown roles | Scoped commands | JSON / Codex TOML | Mapped command-hook subset | Diagnosed, not mounted |

- **Component paths:** declared files, directory trees and arrays resolve inside the suite by realpath. Commands, agents and detail panels use the same resources. Cursor also accepts `.mdc`, `.markdown` and `.txt` commands; Qoder maps support files and inline content. Claude/Codex skills supplement default discovery. Flat skill Markdown files work in manifest-less collections.
- **Agent roles:** roles are available through the session catalog and `subagent_run`; they are not registered as skills or slash commands.
- **MCP:** declared files, inline maps and arrays are resolved by dialect. Cursor's schema-less `mcp.json` is supported; agent-plugins v1 stays schema-strict. Claude/ZCode declarations add to defaults, Cursor declarations replace defaults, Copilot/Universal include `.github/mcp.json`, and Kimi Code uses inline declarations. Invalid explicit configs cannot revive defaults. Codex app connectors remain outside this adapter.
- **Hooks:** declared files/directories and inline configs are supported, including Kimi arrays and ZCode process hooks with quoted argv. Supported Copilot/Cursor lifecycle names map to the existing command-hook bridge. Events without a DSH equivalent, such as `afterFileEdit`, are diagnosed rather than simulated.
- **LSP:** user suites accept declared files, arrays and inline tables, plus `.lsp.json` and Copilot/Universal `lsp.json`, `.github/lsp.json`, `lsp-config/servers.json`. Reverse-domain directory definitions remain previews. Project LSP retains its host-scope limitation.
- **Specification boundaries:** agent-plugins.org v1 standardizes portable skills and MCP only; shared agents / commands / hooks scanning is not a standard capability. Universal is a compatibility-layout label used by this plugin; the [OpenHands SDK](https://docs.openhands.dev/sdk/guides/plugins) documents the same `.plugin/plugin.json` location and a [Vercel repository](https://github.com/vercel/vercel-plugin/blob/main/.plugin/plugin.json) uses it, but no cross-vendor specification exists.
- **Kimi Code:** the active schema covers both manifest spellings, startup skills, appended skill instructions, system prompts, inline hooks and catalog aliases. The historical `kimi-cli` root tools protocol is a different system; it must not be confused with the current Kimi Code schema.
- **ZCode boundary:** `.zcode-plugin/plugin.json` and root `marketplace.json` are recognized, including keyed plugin maps. Inline MCP servers override matching `.mcp.json` keys. The zip + `sha256` marketplace distribution contract is not implemented.
- **Qoder boundary:** `.qoder-plugin/plugin.json` and `.qoder-plugin/marketplace.json` are recognized. MCP prefers `.mcp.json`, with schema-less `mcp.json` as fallback.
- **GitHub Copilot CLI:** `.plugin/plugin.json` retains the Universal identity. Both spellings consume declared component paths and fallback MCP/LSP files. Isolated tests suppress competing manifests at nested suite roots, preventing a Claude fallback from masquerading as a passing Copilot test.
- **Project directories:** [Claude project skills](https://code.claude.com/docs/en/skills) and [Codex `.agents/skills`](https://developers.openai.com/codex/skills) are documented upstream; `.agents/agents` and `.agents/commands` are this plugin's shared discovery conventions.

### Project layout switch

The plugin settings card exposes **Scan project Agent layouts** (`dsh-agent-plugins-market.scanProjectLayouts`, default `true`). Turning it off removes this plugin's native project candidates immediately; configured sources and the harness's own skill providers remain independent. Files are read in place and are never installed, rewritten or deleted.

The registry reads skills under `.claude`, `.agents`, `.codex`, `.cursor`, `.kimi`, `.zcode`, `.qoder` and `.github`. Portable Markdown agents are enabled for all except `.codex` and `.kimi`; their TOML/YAML formats need separate adapters. Role execution resolves the calling session's project. Project commands, supported MCP servers and mapped command hooks register in each agent's scoped context and refresh on session startup or catalog changes; disabling the switch removes them.

MCP reads root `.mcp.json`, `.cursor/mcp.json`, and the `mcpServers` tables in `.qoder/settings.json` and `.qoder/settings.local.json` (local keys override project keys). ZCode reads `mcp.servers` from `zcode.json` and `.zcode/config.json`, with `.agents/mcp.json` as an empty-native-table fallback. Codex reads `[mcp_servers.*]` from `.codex/config.toml` through `smol-toml`, preserving stdio/HTTP configuration, environment/header references, enabled flags, tool filters and timeouts. Unsupported server options produce diagnostics; host-client mode rejects policies it cannot enforce. Relative executables resolve from the project root. Claude/Qoder settings hooks and enabled ZCode configuration hooks use the bridge's supported command-event subset. Validated hooks become private temporary runtime files removed on teardown; project files remain unchanged. Project LSP is diagnosed and not mounted: host changes are outside this plugin's scope. See the [architecture decision and supported boundaries](docs/adr/2026-09-09-layout-registry.md).

### Verified samples

The nine README repository samples have offline snapshots in [`tests/fixtures/real-layouts/`](tests/fixtures/real-layouts/), with commit IDs, hashes and licenses. Tests validate real schemas, scan original trees and isolate each dialect independently. The [compatibility report](docs/compat-report.md) records natural precedence; [the audit](docs/layout-coverage.md) records independent resource checks.

| Layout | Sample repository | Dialect manifest | Schema | Scanner |
| --- | --- | --- | --- | --- |
| Claude Code | [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana) | `.claude-plugin/plugin.json` | valid | integrated |
| Codex | [saadeghi/daisyui](https://github.com/saadeghi/daisyui) | `.codex-plugin/plugin.json` | valid | shadowed |
| Cursor | [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) | `.cursor-plugin/plugin.json` + marketplace | valid | shadowed |
| Kimi | [obra/superpowers](https://github.com/obra/superpowers) | `.kimi-plugin/plugin.json` | valid | shadowed |
| Universal | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | `.plugin/plugin.json` | valid | integrated |
| agent-plugins.org v1 | [saadeghi/daisyui](https://github.com/saadeghi/daisyui) | `plugin.json` | valid | integrated |
| ZCode | [zenstory-ai/oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode) | `.zcode-plugin/plugin.json` + `marketplace.json` | valid | shadowed |
| Qoder CLI | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | `.qoder-plugin/plugin.json` | valid | shadowed |
| GitHub Copilot CLI | [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) | `.github/plugin/marketplace.json` | valid | shadowed |

**Scanner** describes the unmodified repository: **integrated** means its own manifest won; **shadowed** means another won; **unread** means no suite. These verdicts are separate from passing isolated tests. Skill collection is tested with the real Universal repository's skills and no manifests, completing coverage of all ten layouts.

Source checks covered `src/catalog/manifests.ts`, `surfaces.ts`, `validate.ts`, `native-project.ts`, and `src/runtime/hooks-mounts.ts`. The [compatibility report](docs/compat-report.md) adds one real repository per schema, read by this plugin's own scanner. This is a documentation, source and sample audit, not end-to-end compatibility certification for every platform.

Reading a layout does not guarantee every behavior of its original platform. Invalid declarations are diagnosed and skipped. Project-native commands and supported MCP servers use agent-scoped host registration; project MCP server names include session identity to avoid app-wide namespace conflicts.

Review third-party suites before enabling them: enabled services and hooks can execute programs. See the [runtime and security details](docs/guides/usage.md#runtime-and-security).

## FAQ

**Why is an installed skill or tool missing?**

Check that the suite and the relevant capability are enabled. Skills may restrict manual invocation. MCP / LSP panels show user-service failures. Project resources additionally require the project-scan switch; unsupported native fields and project LSP declarations appear in scan diagnostics, while scoped mount failures are logged by the host.

**Where do I configure MCP tokens?**

Open the service in **MCP services**. Missing environment references show `needs-credentials`. Host-managed credentials are write-only; launch-environment credentials require changing the environment and restarting DSH.

**How do I add a service that no suite declares?**

Use **Add** in **MCP services** or **LSP servers**. The declaration is validated, stored under `~/.dsh/agent-plugins/data/`, and mounted through the same lifecycle as suite services. Host-observed services remain read-only.

**What if a source download fails?**

Use a local directory, adopt a manual checkout, or configure a proxy / mirror. See [source configuration](docs/guides/usage.md#configure-marketplace-sources).

**When do local edits become visible?**

There is no file watcher. Local-source discovery caches results for up to 30 seconds; refresh the source to invalidate them immediately. Project discovery has a separate five-second cache. A refresh does not happen automatically on an already-open page.

**Does removing a source delete its files?**

Only when you tick **also delete the managed market directory** in the confirmation. That removes the source's checkout under `~/.dsh/agent-plugins/.sources/<id>` — including one you cloned yourself and adopted. A local-directory source pointing outside `.sources/` is never deleted.

## More documentation

- [Usage guide](docs/guides/usage.md): installation, source configuration, storage, host requirements, MCP / LSP and feedback settings.
- [Plugin specifications](schemas/README.md): per-dialect reference schemas and evidence, plus the vendored agent-plugins.org v1.0.0 contracts.
- [Compatibility report](docs/compat-report.md): one real repository per schema, with commits, schema verdicts and scanner output.
- [Contributing](CONTRIBUTING.md): development setup, checks and PR workflow.
- [Security policy](SECURITY.md) · [Release history](CHANGELOG.md) · [MIT license](LICENSE).
- [Domain glossary](CONTEXT.md) · [Architecture](docs/adr/0001-catalog-centered-modular-refactor.md).

See [agent roles and storage](docs/guides/agent-roles.md) for installed-resource editing, model routing and migration.
