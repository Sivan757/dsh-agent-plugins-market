<img src="https://raw.githubusercontent.com/Sivan757/dsh-agent-plugins-market/main/assets/dsh-agent-plugins.png" alt="Agent Plugins" width="64" height="64" />

# Agent Plugins

`dsh-agent-plugins-market`

**A one-stop skills, subagent, MCP and LSP manager inside [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).**

Run Claude Code, Codex, Cursor, Kimi and agent-plugins suites inside DSH. The plugin reads each layout in place, so you convert no manifest and copy no file. Install it from the DSH Web GUI, then manage skills, commands, agent personas, MCP services and LSP servers in one workspace.

If this plugin is useful to you, a ⭐ on [GitHub](https://github.com/Sivan757/dsh-agent-plugins-market) is appreciated.

English | [简体中文](README.zh.md) | [Documentation](https://sivan757.github.io/dsh-agent-plugins-market/) | [npm](https://www.npmjs.com/package/dsh-agent-plugins-market)

[![npm version](https://img.shields.io/npm/v/dsh-agent-plugins-market)](https://www.npmjs.com/package/dsh-agent-plugins-market) [![License](https://img.shields.io/github/license/Sivan757/dsh-agent-plugins-market)](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/LICENSE)

[Quick start](#quick-start) · [Highlights](#highlights) · [Everyday use](#everyday-use) · [Compatibility](#compatibility) · [FAQ](#faq)

## Pages

<table>
  <tr>
    <td align="center" width="33%">
      <img src="https://raw.githubusercontent.com/Sivan757/dsh-agent-plugins-market/main/docs/screenshots/market.png" alt="Market" width="100%" /><br />
      <b>Market</b><br />Add sources, preview suites, install and enable.
    </td>
    <td align="center" width="33%">
      <img src="https://raw.githubusercontent.com/Sivan757/dsh-agent-plugins-market/main/docs/screenshots/skills.png" alt="Skills" width="100%" /><br />
      <b>Skills</b><br />Browse skills and author your own.
    </td>
    <td align="center" width="33%">
      <img src="https://raw.githubusercontent.com/Sivan757/dsh-agent-plugins-market/main/docs/screenshots/commands.png" alt="Commands" width="100%" /><br />
      <b>Commands</b><br />Manage prompt templates invoked as /name.
    </td>
  </tr>
  <tr>
    <td align="center" width="33%">
      <img src="https://raw.githubusercontent.com/Sivan757/dsh-agent-plugins-market/main/docs/screenshots/personas.png" alt="Agent personas" width="100%" /><br />
      <b>Agent personas</b><br />Roles with an exact provider, model and effort.
    </td>
    <td align="center" width="33%">
      <img src="https://raw.githubusercontent.com/Sivan757/dsh-agent-plugins-market/main/docs/screenshots/mcp.png" alt="MCP services" width="100%" /><br />
      <b>MCP services</b><br />Credentials, authorization and connection status.
    </td>
    <td align="center" width="33%">
      <img src="https://raw.githubusercontent.com/Sivan757/dsh-agent-plugins-market/main/docs/screenshots/lsp.png" alt="LSP servers" width="100%" /><br />
      <b>LSP servers</b><br />Language server configuration and runtime status.
    </td>
  </tr>
</table>

## Quick start

1. In the DSH Web GUI, open **Plugins** in the sidebar.
2. Press **Add plugin**, type `dsh-agent-plugins-market`, then install it. The same dialog accepts a repository URL or a local directory.
3. Restart DSH, then open **Settings → Agent Plugins**.
4. The market already lists one first-party source. Press **Refresh** to fetch its suites. To bring in more, add a source such as `https://github.com/anthropics/claude-plugins-official`.
5. Open a suite, review its contents, then install it and keep it enabled. Skills appear in the **Skills** tab and in the `/` menu. Answer any credential notice on **MCP services** before you use that suite's tools.

Terminal alternative: `dsh plugin --profile <name> add dsh-agent-plugins-market`. Requirements, profile configuration and other install options live in the [usage guide](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/docs/user/usage.md#installation-options).

## Highlights

### Core

- **Any skill repository works.** Add a Git URL whose repository holds `skills/<name>/SKILL.md` and the market discovers it as a suite. No manifest, no conversion, no file copying.
- **Ten suite layouts.** Claude Code, Codex, Cursor, Kimi Code, ZCode, Qoder CLI, GitHub Copilot CLI, Universal `.plugin/`, [agent-plugins](https://agent-plugins.org) and manifest-less skill collections.
- **Sources and downloads.** Add a Git repository, a local directory or an archive, adopt a checkout you cloned yourself, and refresh on demand. Pick a global or China mainland mirror, and refresh every source on a 6-hour timer if you want.
- **Runtime injection.** Enabled suites add skills to the catalog and slash menu, commands as `/name`, agent personas to the subagent catalog, MCP tools as `mcp__*`, hooks to lifecycle events, and language servers to the `lsp` tool. Installing the plugin is the whole LSP setup.
- **One workspace.** Seven tabs cover the market, the resources you author, and the services that run. Every tab has search, filters and a grid or list view.

### Advanced

- **MCP OAuth with nothing to declare.** A remote MCP server that answers `401` starts RFC 9728 discovery, dynamic client registration and PKCE authorization in your browser, and the granted token persists. OAuth is on by default, so a suite needs no declaration for it.
- **Per-server MCP control.** Override a declaration without editing its source, switch one tool off, and set the tool-call and startup timeouts.
- **Project and personal resources.** Turn on **Scan project Agent layouts** to read skills, commands, roles, MCP servers and hooks from the project's own directories. Author your own under `~/.agents/` as Markdown, and disable a resource without deleting its file.
- **Per-workspace control.** Each workspace switches the six mounted surfaces off or on, keeps its own resource filters, and saves a resource-window setup as a favorite that works across projects.
- **Hooks you can read and try.** A hook row opens a declaration card with its event, matcher and timeout, plus a dry run in your home directory.
- **Bilingual by default.** The interface and the injected prompts follow the host language. Descriptions and documents show the original, a translation or both, and stay cached until you clear them.

## Everyday use

The workspace has seven tabs:

| Tab            | Use it to                                                                           |
| -------------- | ----------------------------------------------------------------------------------- |
| Market         | Add sources, preview suites, install or remove them, and switch them on or off.     |
| Skills         | Browse skills and create or edit your own reusable instructions.                    |
| Commands       | Manage prompt templates invoked as `/name`.                                         |
| Agent personas | Save role instructions and model settings, then delegate to them.                   |
| MCP services   | Add a service or configure an installed one, its credentials and its authorization. |
| LSP servers    | Add and configure language servers, and read their runtime status.                  |
| Hooks          | Read each configured hook with its event, matcher and timeout.                      |

A **source** is where content comes from. A **suite** is an installable unit discovered there. Adding a source discovers its suites. Enabling a suite turns its runtime capabilities on.

Your own content lives under `~/.agents/`: skills, commands and personas as Markdown, hooks in `hooks.json`, and the MCP and LSP services you add in `mcp.json` and `lsp.json`. Project-native resources stay in the project. See [storage and discovery](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/docs/user/usage.md#storage-and-discovery).

## Compatibility

The plugin reads ten layout dialects and maps six runtime surfaces. Per-layout support and the manifest priority order are on the [compatible plugins page](https://sivan757.github.io/dsh-agent-plugins-market/compatible-plugins/). Evidence: the [layout audit](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/docs/user/layout-coverage.md) and the [compatibility report](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/docs/reference/compat-report.md).

Reading a layout does not guarantee every behavior of its original platform. Invalid declarations are diagnosed and skipped, never half-mounted.

## FAQ

**Why is an installed skill or tool missing?**

Check that the suite and the relevant capability are enabled. The MCP and LSP panels report failures and missing credentials. Project resources also need the project-scan switch.

**Where do I configure MCP tokens?**

Open the service in **MCP services**. Missing environment references show `needs-credentials`. Host-managed credentials are write-only.

**Do sources refresh automatically?**

Only with **Background source updates** on. It refreshes every configured source every 6 hours, starting one interval after you enable it. The refresh button always works.

**Does removing a source delete its files?**

Only when you tick **also delete the managed market directory** in the confirmation. A local-directory source outside `.sources/` is never deleted.

More questions: [FAQ](https://sivan757.github.io/dsh-agent-plugins-market/faq/).

## Documentation

- [Install guide](https://sivan757.github.io/dsh-agent-plugins-market/install/): prerequisites and the first suite, step by step.
- [Usage guide](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/docs/user/usage.md): source configuration, storage, project layouts, MCP, LSP and settings.
- [Compatible plugins](https://sivan757.github.io/dsh-agent-plugins-market/compatible-plugins/): layouts, precedence and verified samples.
- [Plugin specifications](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/schemas/README.md): per-dialect reference schemas and the [`com.deepseek.harness`](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/schemas/com.deepseek.harness/spec.md) namespace.
- [Contributing](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/CONTRIBUTING.md) · [Security](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/SECURITY.md) · [Changelog](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/CHANGELOG.md) · [License](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/LICENSE).
- [Domain glossary](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/CONTEXT.md) · [Agent roles](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/docs/user/agent-roles.md) · [Release process](https://github.com/Sivan757/dsh-agent-plugins-market/blob/main/docs/developer/release/release-process.md).

## Community

Scan the QR code to join the **dsh-agent-plugins-market** WeChat group, where we answer questions and take feature requests.

<div align="center">
  <img src="https://raw.githubusercontent.com/Sivan757/dsh-agent-plugins-market/main/docs/screenshots/wechat-group.webp" alt="WeChat group QR code for dsh-agent-plugins-market" width="240" />
</div>
