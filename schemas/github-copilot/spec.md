# GitHub Copilot CLI plugin and marketplace specification

Reference contract for GitHub Copilot CLI plugin repositories. Machine-readable companions: [plugin.schema.json](plugin.schema.json) and [marketplace.schema.json](marketplace.schema.json).

- **Verified:** 2026-09-08.
- **Evidence:** official documentation [`CLI plugin reference`](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference) and [`Creating a plugin marketplace for GitHub Copilot CLI`](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace), read from the raw markdown in `github/docs`.
- **Upstream JSON Schema:** none for these manifests. Copilot CLI additionally supports the agent-plugins.org v1.0.0 schema when `plugin.json` declares its `$schema`.
- **Note:** `.plugin/plugin.json` is first in Copilot's plugin lookup order, which is why the [universal layout](../universal/spec.md) works here.

## Manifest locations and precedence

| Artifact             | Lookup order                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Plugin manifest      | `.plugin/plugin.json` → `plugin.json` → `.github/plugin/plugin.json` → `.claude-plugin/plugin.json`                     |
| Marketplace manifest | `marketplace.json` → `.plugin/marketplace.json` → `.github/plugin/marketplace.json` → `.claude-plugin/marketplace.json` |
| Agents               | `agents/` (default, overridable)                                                                                        |
| Skills               | `skills/` (default, overridable)                                                                                        |
| Hooks                | `hooks.json` or `hooks/hooks.json`                                                                                      |
| MCP                  | `.mcp.json`, `.github/mcp.json`                                                                                         |
| LSP                  | `lsp.json` or `.github/lsp.json`                                                                                        |
| Plugin data          | `${COPILOT_PLUGIN_DATA}` (also `${CLAUDE_PLUGIN_DATA}`)                                                                 |

Installed plugins live under `~/.copilot/installed-plugins/<MARKETPLACE>/<PLUGIN>` (or `_direct/<SOURCE-ID>` for direct installs); the marketplace cache is the platform cache directory, overridable with `COPILOT_CACHE_HOME`.

## Plugin manifest (`plugin.json`)

Required: `name` — kebab-case, letters/numbers/hyphens only, max 64 chars. Plugins opting into Open Plugin Spec support may also use dots.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `$schema` | string | — | Set to the agent-plugins.org v1.0.0 schema URL to opt into spec semantics, additively. |
| `description` | string | — | Max 1024 chars. |
| `version` | string | — | Semantic version. |
| `author` | `{name, email?, url?}` | — | `name` required. |
| `homepage`, `repository`, `license` | string | — |  |
| `keywords` | string[] | — |  |
| `category`, `tags` | string, string[] | — |  |
| `agents` | string \| string[] | `agents/` | Directories of `.agent.md` files. |
| `skills` | string \| string[] | `skills/` | Directories of `SKILL.md` files. |
| `commands` | string \| string[] | — | Command directories. |
| `hooks` | string \| object | — | Configuration path or inline hooks object. |
| `extensions` | string \| string[] \| object | — | Extension directories, or `{paths: [...], exclusive: true}`. Different meaning in Open Plugin Spec mode. |
| `mcpServers` | string \| object | — | Path to a JSON config file (for example `.mcp.json`), or inline servers. |
| `lspServers` | string \| object | — | Path to an LSP config file, or inline definitions. |

LSP server entries require at least one of `command`, `bash`, or `powershell` plus `fileExtensions`; optional keys are `cwd`, `args`, `env`, `rootUri`, `initializationOptions`. Use `${PLUGIN_ROOT}` for plugin-relative paths.

## Marketplace manifest (`marketplace.json`)

Required: `name`, `owner`, `plugins`.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Kebab-case, max 64 chars; dots accepted for Open Plugin Spec plugins. The marketplace's own name becomes its registration key. |
| `owner` | `{name, email?}` |  |
| `plugins` | array |  |
| `metadata` | `{description?, version?, pluginRoot?}` |  |

Plugin entries:

| Field                                          | Type                   | Notes                                                                                     |
| ---------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| `name`                                         | string                 | Required; kebab-case, max 64 chars.                                                       |
| `source`                                       | string \| object       | Required.                                                                                 |
| `description`                                  | string                 | Max 1024 chars.                                                                           |
| `version`, `homepage`, `repository`, `license` | string                 |                                                                                           |
| `author`                                       | `{name, email?, url?}` |                                                                                           |
| `keywords`, `tags`                             | string[]               |                                                                                           |
| `category`                                     | string                 |                                                                                           |
| `commands`, `agents`, `skills`                 | string \| string[]     |                                                                                           |
| `hooks`                                        | string \| object       |                                                                                           |
| `mcpServers`                                   | string \| object       | Inline map or config path, used when the plugin source ships no MCP configuration.        |
| `lspServers`                                   | string \| object       |                                                                                           |
| `strict`                                       | boolean                | Default `true`; `false` enables relaxed validation for direct installs or legacy plugins. |

Sources accept a relative path string, or an object `{source: 'github'|'url', repo|url, ref?, sha?, path?}`. `sha` must be a full 40-character commit SHA and pins installs against force-pushes or moved tags.

## Commands

`copilot plugin install SPECIFICATION` accepts `plugin@marketplace`, `OWNER/REPO`, `OWNER/REPO:PATH/TO/PLUGIN`, a Git URL, or a local path. `copilot plugin marketplace add SOURCE` accepts `owner/repo`, `owner/repo#ref`, a URL, or a local path. Built-in `copilot-plugins` and `awesome-copilot` marketplaces cannot be removed and auto-update at session start unless `autoUpdate` is false or `COPILOT_AUTO_UPDATE=false`; a user-added marketplace opts in with `autoUpdate: true` on its `extraKnownMarketplaces` entry.

## Loading precedence

- **Agents and skills: first-found wins.** A project-level agent or skill with the same name shadows the plugin's. Agents deduplicate by file-derived id; skills by their `SKILL.md` `name`.
- **MCP servers: last-wins.** A plugin's definition overrides an existing server of the same name; `--additional-mcp-config` overrides everything; when two plugins declare the same name the last loaded wins and every prior plugin is named in a warning.
- **Built-in tools and agents** cannot be overridden.

## Directory layout

```text
my-plugin/
├── .plugin/plugin.json         # or plugin.json / .github/plugin/plugin.json / .claude-plugin/plugin.json
├── agents/                     # *.agent.md
├── skills/<name>/SKILL.md
├── commands/
├── hooks.json or hooks/hooks.json
├── .mcp.json or .github/mcp.json
└── lsp.json or .github/lsp.json
```

## Evidence gaps

1. The documentation does not state what happens when several manifest paths exist simultaneously beyond the ordered list.
2. Open Plugin Spec mode changes the meaning of `extensions`; the exact spec-mode field set is defined upstream at agent-plugins.org.
3. `strict: false` is described as "relaxed validation" without an enumerated relaxed rule set.
