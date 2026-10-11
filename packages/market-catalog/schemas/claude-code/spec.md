# Claude Code plugin and marketplace specification

Reference contract for Claude Code plugin repositories. Machine-readable companions: [plugin.schema.json](plugin.schema.json) and [marketplace.schema.json](marketplace.schema.json).

- **Verified:** 2026-09-08.
- **Evidence:** official reference pages [`plugins-reference`](https://code.claude.com/docs/en/plugins-reference) and [`plugin-marketplaces`](https://code.claude.com/docs/en/plugin-marketplaces); the official catalog [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official) (291 entries).
- **Upstream JSON Schema:** none. The `$schema` URL the official catalog itself declares, `https://anthropic.com/claude-code/marketplace.schema.json`, returns 404. The SchemaStore schemas are community-maintained and stale (generated 2026-04-23, missing `displayName`, `metadata`, `defaultEnabled`, `experimental`, `workflows`, and `renames`).
- **Spec status:** Claude Code is not listed among agent-plugins.org compatible clients.

## Manifest locations and precedence

| Artifact | Location |
| --- | --- |
| Plugin manifest | `.claude-plugin/plugin.json`; optional — without it components are auto-discovered and the name comes from the directory |
| Marketplace manifest | `.claude-plugin/marketplace.json`, or any `marketplace.json` added by direct path or URL |
| Skills | `skills/` (manifest `skills` **adds** to this scan) |
| Commands / agents / workflows / output styles / themes / monitors | `commands/`, `agents/`, `workflows/`, `output-styles/`, `themes/`, `monitors/monitors.json` (manifest fields **replace** these) |
| Hooks | `hooks/hooks.json` or inline |
| MCP | `.mcp.json` or inline `mcpServers` (additive) |
| LSP | `.lsp.json` or inline `lspServers` |
| Executables / settings | `bin/`, `settings.json` (only `agent` and `subagentStatusLine` keys) |

Only `plugin.json` may live inside `.claude-plugin/`; every component directory belongs at the plugin root. A root `SKILL.md` with no `skills/` directory and no `skills` field loads as a single-skill plugin. A root `CLAUDE.md` is not loaded as context.

## Plugin manifest (`plugin.json`)

Required: `name`. All paths are relative to the plugin root and must begin with `./` (`skills` also accepts `"."`); traversal outside the plugin is rejected.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Kebab-case id; namespaces components as `<plugin>:<component>`. |
| `displayName` | string | UI label; falls back to `name`. |
| `version` | string | Pins updates. The manifest value wins over a marketplace entry without warning. |
| `description`, `homepage`, `repository`, `license` | string |  |
| `author` | `{name, email, url}` |  |
| `keywords` | string[] | A wrong type is a load error. |
| `metadata` | object | Free-form; not read by the client. |
| `defaultEnabled` | boolean | Default `true`; a marketplace entry value takes precedence. |
| `$schema` | string | Editor autocomplete only. |
| `skills`, `commands`, `agents`, `workflows`, `outputStyles` | string \| string[] | See precedence above. |
| `hooks`, `mcpServers`, `lspServers` | string \| string[] \| object | Path(s) or inline configuration. |
| `experimental` | `{themes?, monitors?}` | The top-level `themes`/`monitors` spellings still work but warn. |
| `userConfig` | object | Options prompted at enable time; each requires `type`, `title`, `description`, plus optional `sensitive`, `required`, `default`, `multiple` (string), `min`/`max` (number). |
| `channels` | array | Message-channel declarations; each `server` must match a key in `mcpServers`. |
| `dependencies` | (string \| `{name, version?}`)[] |  |
| `settings` | object | `settings.json` takes priority over this field. |

Unrecognized top-level fields are ignored with a warning (`--strict` makes them errors), deliberately so a manifest can double as a VS Code or Cursor extension manifest, a `package.json`, or an MCPB/DXT bundle manifest.

## Marketplace manifest (`marketplace.json`)

Required: `name`, `owner`, `plugins`.

| Field                                 | Type                   | Notes                                                                 |
| ------------------------------------- | ---------------------- | --------------------------------------------------------------------- |
| `name`                                | string                 | Kebab-case; one registration per name per user; reserved names apply. |
| `owner`                               | `{name, email?, url?}` |                                                                       |
| `plugins`                             | array                  |                                                                       |
| `description`, `version`              | string                 | Also accepted under `metadata` for backward compatibility.            |
| `metadata.pluginRoot`                 | string                 | Directory for bare `source` names; ignored for `./` sources.          |
| `allowCrossMarketplaceDependenciesOn` | string[]               | Only the root marketplace's allowlist applies; no transitive trust.   |
| `renames`                             | `{old: new \| null}`   | Chains are followed; cycles are rejected by `claude plugin validate`. |
| `forceRemoveDeletedPlugins`           | boolean                | Community-schema field with no current official documentation.        |

Plugin entries require `name` and `source`; optional fields include `displayName`, `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `metadata`, `category`, `tags`, `strict` (default `true`), `relevance`, `defaultEnabled`, `headers`, `headersHelper`, `skills`, `commands`, `agents`, `hooks`, `mcpServers`, and `lspServers`. With `strict: true` the plugin manifest is authoritative and the entry supplements it; with `strict: false` the entry is the whole definition, and a conflicting component-declaring manifest fails to load.

## Plugin sources

| Variant       | Shape                                    | Notes                                                                                                            |
| ------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| relative path | string                                   | `./…`, or a bare name under `metadata.pluginRoot`; resolved against the marketplace root, not `.claude-plugin/`. |
| `github`      | `{source, repo, ref?, sha?}`             | `owner/repo`.                                                                                                    |
| `url`         | `{source, url, ref?, sha?}`              | Any git URL, including SSH.                                                                                      |
| `git-subdir`  | `{source, url, path, ref?, sha?}`        | Sparse partial clone.                                                                                            |
| `npm`         | `{source, package, version?, registry?}` |                                                                                                                  |
| `archive`     | `{source, url, sha256?}`                 | HTTPS zip, at most 256 MiB.                                                                                      |
| `command`     | `{source, command, timeout?, mode?}`     | Prints one absolute path; `mode` is `copy` (default) or `link`.                                                  |

When both `ref` and `sha` are set, `sha` is the effective pin. In the official catalog the observed distribution is `url` 153, `git-subdir` 85, relative path 53.

## Version and enablement resolution

1. Version: `plugin.json` → marketplace entry → git commit SHA → archive `sha256` prefix → `unknown`.
2. `defaultEnabled`: marketplace entry > manifest; a user's `enabledPlugins` setting beats both.
3. `--plugin-dir` local plugins take precedence over a marketplace install for that session.

## Directory layout

```text
enterprise-plugin/
├── .claude-plugin/plugin.json   # optional manifest
├── skills/  commands/  agents/  workflows/  output-styles/
├── themes/  monitors/monitors.json
├── hooks/hooks.json
├── bin/                         # executables added to PATH
├── settings.json
├── .mcp.json
└── .lsp.json
```

Placeholders: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/{id}/`), `${CLAUDE_PROJECT_DIR}`, `${user_config.KEY}` (rejected in shell-form hooks, monitor commands, and MCP `headersHelper`).

## Evidence gaps

1. Hook, MCP, and LSP merge semantics are described only as "own merge rules"; only MCP's additivity with `.mcp.json` is documented.
2. `.lsp.json` versus inline `lspServers` precedence is unstated.
3. Whether a root `marketplace.json` can coexist with `.claude-plugin/marketplace.json`, and which wins, is undocumented.
4. `forceRemoveDeletedPlugins` has no current official documentation.
