# Qoder CLI plugin and marketplace specification

Reference contract for Qoder CLI plugin repositories. Machine-readable companions: [plugin.schema.json](plugin.schema.json) and [marketplace.schema.json](marketplace.schema.json).

- **Verified:** 2026-09-08 against `@qoder-ai/qodercli@1.1.47`.
- **Evidence:** official reference pages [`docs.qoder.com/cli/plugins-reference`](https://docs.qoder.com/cli/plugins-reference), [`/cli/plugins`](https://docs.qoder.com/cli/plugins), `/cli/settings-reference`, `/cli/config-scope`; the compiled Zod schemas and path-resolution code inside the shipped `bundle/qodercli.js`; the first-party manifest `bundle/vendor/qoder-security/.qoder-plugin/plugin.json`; third-party catalogs (`apify/apify-qoder-plugin`, `qoder-plugins/oh-my-qoder`, `HarmonyOS-AI/HarmonyOS-Plugins`, `superbasedapp/plugins`).
- **Upstream JSON Schema:** none. Neither Zod schema declares `$schema`, and every probed schema URL returns 404. Qoder's interop mechanism is Claude Code compatibility, not agent-plugins.org.
- **Official marketplace repository:** `QoderAI/qoder-plugins-official` exists but is empty (no branches, no commits).

## Manifest locations and precedence

| Artifact | Lookup order | Evidence |
| --- | --- | --- |
| Plugin manifest | `.qoder-plugin/plugin.json` → `.claude-plugin/plugin.json` | CLI resolver array `[".qoder-plugin", ".claude-plugin"]`; the `.claude-plugin` fallback is undocumented. There is no root-level fallback. |
| Marketplace manifest | `.qoder-plugin/marketplace.json` → `.claude-plugin/marketplace.json` → `marketplace.json` → the supplied path as a JSON file | CLI `Fdr()`; a second cache-write path checks only the first and third, so a marketplace shipping only `.claude-plugin/marketplace.json` installs but is not cached. |
| MCP configuration | `.mcp.json` → `mcp.json` | Documented and implemented; never merged. |
| Hooks configuration | `hooks/hooks.json`, needing the `{"hooks": {…}}` wrapper | Docs. |

The plugin manifest is optional; without it the CLI uses the directory name and the literal version `"local"`.

## Plugin manifest (`plugin.json`)

Required: `name` (non-empty, no spaces). Every component path must begin with `./`.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Unique identifier. |
| `version` | string | Defaults to `"local"` at install time. |
| `displayName`, `description` | string |  |
| `author` | `{name, email?, url?}` | `name` required. |
| `homepage` | string | Must be a valid URL. |
| `repository`, `license` | string | `license` is an SPDX id. |
| `keywords` | string[] |  |
| `dependencies` | (string \| `{name, marketplace?}`)[] | Bare names resolve against the declaring plugin's own marketplace. |
| `commands` | string \| string[] \| object | Object form maps a name to `{source?, content?, description?, argumentHint?, model?, allowedTools?, context?: 'inline'\|'fork', arguments?, effort?, agent?}`; `source` and `content` are mutually exclusive. |
| `agents` | string \| string[] | Paths must end in `.md`. |
| `skills` | string \| string[] |  |
| `outputStyles` | string \| string[] | Overrides the `output-styles/` directory. |
| `workflowsPath` / `workflowsPaths` | string / string[] |  |
| `hooks` | string \| object \| array | A string must end in `.json`. |
| `mcpServers` | string \| object \| array | A string must end in `.json`; an object is keyed by server name. |
| `userConfig` | object | Keys `^[A-Za-z_]\w*$`; values are strict: `{type: 'string'\|'number'\|'boolean'\|'directory'\|'file', title, description, required?, default?, multiple?, sensitive?, min?, max?}`. |
| `settings` | object | Only the allowlisted key `agent` is kept. |
| `lspServers`, `channels` | any | Recognized but not implemented; warned and ignored. |

Unknown keys are stripped (the manifest schema is non-strict).

## Marketplace manifest (`marketplace.json`)

Required: `name`, `owner`, `plugins`.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | 1–100 chars, `^[a-z0-9][-a-z0-9._]*$` case-insensitive, no spaces or non-ASCII. Reserved names and `qoder-*` prefixes are rejected. |
| `owner` | `{name, email?, url?}` |  |
| `plugins` | array |  |
| `forceRemoveDeletedPlugins` | boolean | Uninstalls plugins removed from the marketplace. |
| `metadata` | `{pluginRoot?, version?, description?}` | `pluginRoot` is declared as the base path for relative sources but has no consumer in the observed CLI. |
| `allowCrossMarketplaceDependenciesOn` | string[] |  |

Plugin entries are the plugin-manifest schema made optional, plus:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Required; must match the plugin manifest name. |
| `source` | string \| object | Required. |
| `category`, `tags` | string, string[] |  |
| `strict` | boolean | Default `true`. When `false`, the marketplace entry provides the manifest. |
| inherited manifest fields | — | `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `dependencies`, and every component field are accepted on the entry. |

Top-level `description`/`version` are not in the schema and are silently dropped — use `metadata.*`.

## Plugin sources

| Form                                                   | Notes                             |
| ------------------------------------------------------ | --------------------------------- |
| `"./plugins/foo"`                                      | Relative to the marketplace root. |
| `{source: 'npm'\|'pip', package, version?, registry?}` |                                   |
| `{source: 'url', url, ref?, sha?}`                     |                                   |
| `{source: 'github', repo, ref?, sha?}`                 |                                   |
| `{source: 'git-subdir', url, path, ref?, sha?}`        |                                   |

`sha` must be a full 40-character lowercase hex commit. Marketplace registration (`qoder plugins marketplace add`) classifies `user@host:path`, git URLs, `github.com/owner/repo`, other HTTP(S) URLs, local `.json` files, existing directories, and `owner/repo[#ref]`.

## Directory layout

```text
plugin-name/
├── .qoder-plugin/plugin.json   # manifest (optional; must not be in the plugin root)
├── commands/                   # .md, nested directories allowed
├── agents/                     # .md
├── skills/<name>/SKILL.md
├── hooks/hooks.json
├── output-styles/
├── workflows/
├── bin/                        # added to PATH
└── .mcp.json                   # mcp.json is a fallback only
```

Marketplace repositories place the catalog at the repository root (`.qoder-plugin/marketplace.json`) with plugin directories beside it. On-disk state lives under `$QODER_PLUGIN_CACHE_DIR` or `<configDir>/plugins`, where `configDir` is `$QODER_CONFIG_DIR` or `~/.qoder`: `marketplaces/<name>.json`, `known_marketplaces.json`, `installed_plugins.json`, `installed_plugins_v2.json`, `cache/`.

Hook environment: `QODER_PLUGIN_ROOT`, `QODER_PLUGIN_DATA`, and the undocumented `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA`.

## Evidence gaps

1. `metadata.pluginRoot` is declared but unimplemented.
2. The `strict: false` manifest-synthesis path was not traced.
3. `lspServers` and `channels` are typed `unknown` and explicitly ignored.
4. Docs drift: the CLI has a `managed` install scope, both `.claude-plugin/*` fallbacks, and the settings keys `pluginConfigs`, `extraKnownMarketplaces`, `blockedMarketplaces`, `strictKnownMarketplaces`.
5. The first-party manifest's `logo`, `category`, and `tags` are absent from the schema and unread by the CLI.
6. Marketplace `source: 'npm'` throws "not yet implemented" even though the plugin-level npm source works.
