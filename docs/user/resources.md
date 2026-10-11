# Your own resources

English | [简体中文](resources.zh.md) | [README](../../README.md)

**Guide:** [Install](install.md) · [Sources](sources.md) · [Resources](resources.md) · [Services](services.md) · [Translation](translation.md) · [Settings](settings.md) · [Workspace](workspace.md)

## Storage and discovery

Plugin state lives under `~/.dsh/agent-plugins/`; setting `DSH_HOME` changes it to `$DSH_HOME/agent-plugins/`.

| Path under the root      | Contents                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| `state.json`             | Configured sources and install state                                     |
| `.sources/<sourceId>/`   | Source checkouts                                                         |
| `data/`                  | Overrides, suite `${PLUGIN_DATA}` directories, feedback rate-limit stamp |
| `translation-cache.json` | Cached translations, keyed by content and provider (kept until cleared)  |

Content you author yourself lives in the shared Agent layout root, `~/.agents/` (`$DSH_AGENTS_HOME` overrides it) — the same directory shape this plugin reads from a project's `.agents/`:

| Path                   | Contents                                                         |
| ---------------------- | ---------------------------------------------------------------- |
| `skills/`              | Your skills: `<name>.md`, or the tool-authored `<name>/SKILL.md` |
| `commands/`            | Your command Markdown files, flat or nested in subdirectories    |
| `agents/`              | Your persona Markdown files, flat or nested in subdirectories    |
| `hooks.json`, `hooks/` | Command hooks, in `hooks.json` or `hooks/hooks.json`             |
| `mcp.json`             | MCP services added in the workspace (`mcpServers`)               |
| `lsp.json`             | LSP servers added in the workspace (`lspServers`)                |

User entries support `disabled: true` frontmatter to stop registration without deleting the file. The skills panel switches a skill by writing the harness's own `disable-model-invocation: true` with `user-invocable: false` — the one off state every reader of that file honors — and drops the older `disabled` key on the first switch. A skill in the `<name>/SKILL.md` spelling keeps whatever sits beside that document; deleting it from the panel removes the document only, never the `references/` or `scripts/` files another tool put there. A skill registers under the `name` its frontmatter declares — the name the panel shows — and one the harness reader would reject is listed under its file name, disabled, with the reason instead of joining the catalog. Commands forward their body to the model, replacing `$ARGUMENTS` with the invocation text. A command or persona in a subdirectory is named by its path (`git/commit`), or by the `name` its frontmatter declares, and a command registers under that name with each `/` flattened to `-`, so `/git-commit` invokes it. User personas appear in the dynamic [subagent catalog](agent-roles.md), not the skill or slash-command menus. `mcp.json` and `lsp.json` are read as local declaration files: `mcp.json` needs no `$schema`, so a service another tool wrote there is read as it stands. A service declared there mounts under its own key — `mcp__<server>__<tool>`, with no suite namespace in between — the same name that declaration carries in every other MCP client.

Project-dimension state and checkouts live under `<project>/.dsh/agent-plugins/`. Native layouts listed under [project layouts](#project-layouts) are read in place without install state. Project skills win same-name conflicts with installed user suites, and a skill you author under the Agent layout root wins over a suite skill of the same name. Rename an entry if it is shadowed.

## Project layouts

**Scan project Agent layouts** is off by default. With it on, the project a session runs in contributes its own resources; saving with it off removes every candidate below on the next discovery pass. Configured sources and installed suites are unaffected. Files are read in place and are never installed, rewritten or deleted.

Skill directories are read under `.claude`, `.agents`, `.codex`, `.cursor`, `.kimi`, `.zcode`, `.qoder` and `.github`. Portable Markdown agents are enabled for all of them except `.codex` and `.kimi`, whose TOML/YAML formats need separate adapters. Role execution resolves the calling session's project. Project commands, supported MCP servers and mapped command hooks register in each agent's scoped context and refresh on session startup or catalog changes.

MCP reads root `.mcp.json`, the `.agents` layout's `.agents/mcp.json`, `.cursor/mcp.json`, and the `mcpServers` tables in `.qoder/settings.json` and `.qoder/settings.local.json` (local keys override project keys). ZCode reads `mcp.servers` from `zcode.json` and `.zcode/config.json`. Codex reads `[mcp_servers.*]` from `.codex/config.toml` through `smol-toml`, preserving stdio/HTTP configuration, environment and header references, enabled flags, tool filters and timeouts; unsupported server options are diagnosed. Relative executables resolve from the project root.

Claude/Qoder settings hooks, the Agent layout's `.agents/hooks/hooks.json` or `.agents/hooks.json` (either a bare event table or a `hooks` key), and enabled ZCode configuration hooks use the bridge's supported command-event subset. The user Agent layout root is read through the same two file names, with no project directory: a user-level hook sees the calling session's workspace as `${CLAUDE_PROJECT_DIR}`. Validated hooks become private temporary runtime files that are removed on teardown; project files stay unchanged. Project LSP is diagnosed and not mounted: the host LSP registry does not isolate projects. This plugin does not modify host APIs.

Unmanaged user checkouts do not become runtime installations just because they exist on disk. Adopt and install them explicitly. There is no file watcher; project discovery snapshots are cached for five seconds.
