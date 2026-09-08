<img src="docs-site/public/favicon.svg" alt="" width="48" height="48" />

# dsh-agent-plugins-market

**A plugin marketplace and agent capability workspace for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).**

Reuse supported content from Claude Code, Codex and Cursor suites, plus community compatibility layouts. Manage your own skills, commands, agent personas, MCP services and LSP servers in the DSH Web GUI. Supported layouts are read in place, without converting manifests or manually copying files into DSH. See the capability matrix for format-specific limits.

English | [简体中文](README.zh.md) | [Documentation](https://sivan757.github.io/dsh-agent-plugins-market/) | [npm](https://www.npmjs.com/package/dsh-agent-plugins-market)

[![npm version](https://img.shields.io/npm/v/dsh-agent-plugins-market)](https://www.npmjs.com/package/dsh-agent-plugins-market) [![License](https://img.shields.io/github/license/Sivan757/dsh-agent-plugins-market)](LICENSE)

[Quick start](#quick-start) · [Everyday use](#everyday-use) · [Compatibility](#compatibility-and-boundaries) · [FAQ](#faq)

![Current six-tab Agent Plugins workspace](docs/screenshot-workspace.png)

## What you can do

- **Reuse ecosystem suites.** Add a Git repository, local directory or archive as a source; browse, preview, install and enable its suites. Supported capabilities become available to DSH at runtime.
- **Build your own toolkit.** Create skills, reusable slash commands and agent personas. Edit or disable your own entries without deleting them.
- **Keep project resources in place.** Project `.claude/` and `.agents/` skills and agents are discovered without an installation step or file copying.
- **Manage services where you use them.** Configure MCP credentials and authorization, inspect MCP / LSP status, and diagnose unavailable services from one workspace.

## Quick start

You need Node.js 22+, Git for Git sources, and a DSH Web profile with the skill service enabled. This repository declares DSH peer packages in the `^0.1.2-rc.1` range; individual capabilities also depend on the services in your profile. See [host requirements](docs/guides/usage.md#host-requirements).

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

The workspace has six tabs:

| Tab            | Use it to                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Market         | Add sources, preview suites, install / uninstall, enable / disable and refresh.                                |
| Skills         | Browse skills and create or edit your own reusable instructions.                                               |
| Commands       | Manage prompt templates invoked as `/name`; `$ARGUMENTS` inserts the text supplied after the command.          |
| Agent personas | Select providers and models from DSH, manage role instructions and tools, and delegate through `market_agent`. |
| MCP services   | Configure services, credentials and authorization; inspect connection status and retry failures.               |
| LSP servers    | Configure language servers and inspect their runtime status.                                                   |

A **source** is where content comes from; a **suite** is an installable unit discovered there. Adding a source discovers its suites. Installing and enabling a suite controls its runtime capabilities. Suite details preview files; MCP credentials and overrides are edited in **MCP services**.

Your own skills, commands and personas are stored as Markdown under `~/.dsh/agent-plugins/user/`. Project-native resources stay in the project. See [storage and discovery](docs/guides/usage.md#storage-and-discovery) for paths and precedence.

## Compatibility and boundaries

Supported **layout dialects** describe how files are organized:

| Layout dialect           | Manifest or directory convention                                   |
| ------------------------ | ------------------------------------------------------------------ |
| Claude Code              | `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json` |
| Codex                    | `.codex-plugin/plugin.json`                                        |
| Cursor                   | `.cursor-plugin/plugin.json`                                       |
| Kimi-named compatibility | `.kimi-plugin/plugin.json`; not Kimi's official tool-plugin format |
| Universal compatibility  | `.plugin/plugin.json`; not the agent-plugins.org standard          |
| agent-plugins.org v1     | `plugin.json`, validated with the vendored 1.0.0 schema            |
| Skill collection         | Directories containing `SKILL.md`, without a plugin manifest       |

Supported **runtime surfaces** describe what DSH can use:

| Surface  | Runtime support and conditions                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Skills   | Host skill catalog and user-invocable slash entries; supported root placeholders are expanded.                                            |
| Commands | Slash commands through the host command service.                                                                                          |
| Agents   | Agent instructions as skills; role delegation requires host tools, LLM and subagent services.                                             |
| MCP      | Built-in bridge by default: stdio, Streamable HTTP with OAuth, and legacy SSE. Optional host-client compatibility mode is also available. |
| Hooks    | The command-hook subset mapped by `dsh-hooks-claude-code`.                                                                                |
| LSP      | Live mounts when the host provides LSP packages; the profile must expose the LSP tool for agent use.                                      |

### Layout capability matrix

Checked against official documentation and this plugin's source on 2026-09-08. This table describes **integration by this plugin**. “Shared” means the plugin's common scanning conventions, not an upstream-defined capability. “Partial” requires the limitations below.

| Layout | Skills | Agents | Commands | MCP | Hooks | LSP |
| --- | --- | --- | --- | --- | --- | --- |
| [Claude Code](https://code.claude.com/docs/en/plugins-reference) | Supported | Partial: `agents/*.md` | Partial: `commands/*.md` | Partial: file / inline | Claude command-hook subset | Partial: inline |
| [Codex](https://developers.openai.com/plugins/build/plugins) | Supported | Shared | Shared | Partial: `.mcp.json` | Compatible event subset | Shared inline |
| [Cursor](https://cursor.com/docs/reference/plugins) | Supported | Partial: `.md` only | Partial: `.md` only | Partial: see below | Native events unsupported | Shared inline |
| Kimi-named compatibility layout `.kimi-plugin/` | Shared | Shared | Shared | Shared | Claude-format subset | Shared inline |
| Universal compatibility layout `.plugin/` | Shared | Shared | Shared | Shared | Claude-format subset | Shared inline |
| [agent-plugins.org v1](https://agent-plugins.org/specification) | Supported | Shared, nonstandard | Shared, nonstandard | Standard `mcp.json` | Shared, nonstandard | Directory preview only, nonstandard |
| Manifest-less skill collection | Supported | Shared | Shared | Shared files | Claude-format subset | Directory preview only |
| Project-native `.claude/`, `.agents/` | Supported | Skill instructions | Counted, not registered | Not mounted | Not mounted | Not mounted |

- **Shared scanning:** root `SKILL.md`, `skills/` or manifest `skills` paths, and files directly under `agents/*.md` and `commands/*.md`. Custom manifest agents / commands paths are not read; upstream frontmatter, invocation, and tool semantics are not fully reproduced. Manifest-less roots must first qualify through skill discovery.
- **MCP:** reads `mcp.json`, then `.mcp.json`, then inline manifest `mcpServers`; custom manifest MCP file paths are not followed. Root `mcp.json` must pass the agent-plugins.org schema, so **Cursor's documented schema-less `mcp.json` is unsupported**. `.mcp.json` accepts both the `mcpServers` wrapper and a direct top-level server map, which covers Codex's documented forms; Codex `.app.json` connector bindings are not read. An invalid higher-priority file does not fall back.
- **Hooks:** only `hooks/hooks.json` or root `hooks.json`, using the Claude Code bridge's supported command-hook events. Inline hooks and custom manifest paths are not read. Cursor-native events such as `afterFileEdit` are not integrated by that bridge.
- **LSP:** only validated inline `lspServers` are mounted, including Claude marketplace declarations. **Claude's documented root `.lsp.json` and manifest LSP file paths are not read**. `.claude-plugin/lsp/*.json` and reverse-domain `*/lsp/` entries are counted and previewed only.
- **Specification boundaries:** agent-plugins.org v1 standardizes portable skills and MCP only; shared agents / commands / hooks scanning is not a standard capability. Universal is a compatibility-layout label used by this plugin; the [OpenHands SDK](https://docs.openhands.dev/sdk/guides/plugins) documents the same `.plugin/plugin.json` location and a [Vercel repository](https://github.com/vercel/vercel-plugin/blob/main/.plugin/plugin.json) uses it, but no cross-vendor specification exists.
- **Kimi boundary:** [Kimi's official plugin documentation](https://github.com/MoonshotAI/kimi-cli/blob/main/docs/en/customization/plugins.md) defines `tools` in root `plugin.json`; its [agent documentation](https://github.com/MoonshotAI/kimi-cli/blob/main/docs/en/customization/agents.md) uses YAML. Neither is integrated. Those official documents do not establish a `.kimi-plugin/plugin.json` specification, so this is not full Kimi plugin support.
- **Project directories:** [Claude project skills](https://code.claude.com/docs/en/skills) and [Codex `.agents/skills`](https://developers.openai.com/codex/skills) are documented upstream; `.agents/agents` and `.agents/commands` are this plugin's shared discovery conventions.

Source checks covered `src/catalog/manifests.ts`, `surfaces.ts`, `validate.ts`, `native-project.ts`, and `src/runtime/hooks-mounts.ts`. This is a documentation and source audit, not end-to-end compatibility certification for every platform.

Reading a layout does not guarantee every behavior of its original platform. Invalid declarations are diagnosed and skipped. The project dimension does not mount MCP servers, and project-native commands are not registered because the host command registry is process-scoped.

Review third-party suites before enabling them: enabled services and hooks can execute programs. See the [runtime and security details](docs/guides/usage.md#runtime-and-security).

## FAQ

**Why is an installed skill or tool missing?**

Check that the suite and the relevant capability are enabled. Skills may restrict manual invocation. MCP / LSP panels show credential, dependency and mount failures; project-scoped MCP is not mounted.

**Where do I configure MCP tokens?**

Open the service in **MCP services**. Missing environment references show `needs-credentials`. Host-managed credentials are write-only; launch-environment credentials require changing the environment and restarting DSH.

**What if a source download fails?**

Use a local directory, adopt a manual checkout, or configure a proxy / mirror. See [source configuration](docs/guides/usage.md#configure-marketplace-sources).

**When do local edits become visible?**

There is no file watcher. Local-source discovery caches results for up to 30 seconds; refresh the source to invalidate them immediately. Project discovery has a separate five-second cache. A refresh does not happen automatically on an already-open page.

**Does removing a source delete its files?**

Only when you tick **also delete the managed market directory** in the confirmation. That removes the source's checkout under `~/.dsh/agent-plugins/.sources/<id>` — including one you cloned yourself and adopted. A local-directory source pointing outside `.sources/` is never deleted.

## More documentation

- [Usage guide](docs/guides/usage.md): installation, source configuration, storage, host requirements, MCP / LSP and feedback settings.
- [Contributing](CONTRIBUTING.md): development setup, checks and PR workflow.
- [Security policy](SECURITY.md) · [Release history](CHANGELOG.md) · [MIT license](LICENSE).
- [Domain glossary](CONTEXT.md) · [Architecture](docs/adr/0001-catalog-centered-modular-refactor.md).

See [agent roles and storage](docs/guides/agent-roles.md) for installed-resource editing, model routing and migration.
