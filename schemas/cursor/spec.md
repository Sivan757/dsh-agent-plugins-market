# Cursor plugin and marketplace specification

Reference contract for Cursor plugin repositories. Machine-readable companions: [plugin.schema.json](plugin.schema.json) and [marketplace.schema.json](marketplace.schema.json).

- **Verified:** 2026-09-08.
- **Evidence:** official reference pages [`cursor.com/docs/reference/plugins`](https://cursor.com/docs/reference/plugins) and [`cursor.com/docs/plugins`](https://cursor.com/docs/plugins); the official [`cursor/plugin-template`](https://github.com/cursor/plugin-template); real catalogs (`tldraw/tldraw`, `cloudflare/skills`, `huggingface/skills`, `NVIDIA/skills`, `wshobson/agents`, `vercel/vercel-plugin`).
- **Upstream JSON Schema:** none for `.cursor-plugin/plugin.json` or `.cursor-plugin/marketplace.json` (probed URLs return the SPA HTML). The agent-plugins.org schemas Cursor consumes are published upstream.

## Two accepted formats

Cursor loads a format by manifest location:

| Format                        | Manifest                     | Components                                                                                   |
| ----------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| Agent Plugins (open standard) | root `plugin.json`           | Skills and MCP only; validated by [../1.0.0/plugin.schema.json](../1.0.0/plugin.schema.json) |
| Cursor Plugin                 | `.cursor-plugin/plugin.json` | Skills, MCP, rules, agents, commands, hooks, variables                                       |

Which format wins when both manifests exist is undocumented.

## Plugin manifest (`.cursor-plugin/plugin.json`)

Required: `name` — lowercase kebab-case with optional periods, starting and ending alphanumeric.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `name` | string | — | Plugin identifier. |
| `displayName` | string | — | Used by the official template and vendor repos; missing from the docs field table. |
| `description`, `version`, `homepage`, `repository`, `license` | string | — |  |
| `author` | `{name, email?, url?}` | — | `url` is used in the wild but absent from the docs table. |
| `keywords` | string[] | — |  |
| `logo` | string | — | Relative repository path (resolved to `raw.githubusercontent.com`) or absolute URL; relative is preferred. |
| `rules` | string \| string[] | `rules/` | `.md`, `.mdc`, `.markdown`. |
| `agents` | string \| string[] | `agents/` |  |
| `skills` | string \| string[] | `skills/` |  |
| `commands` | string \| string[] | `commands/` | `.md`, `.mdc`, `.markdown`, `.txt`. |
| `hooks` | string \| object | `hooks/hooks.json` |  |
| `mcpServers` | string \| object \| string[] \| object[] | `mcp.json` | A manifest value overrides default discovery. |
| `variables` | object | — | JSON Schema declaring variable **names** only. `${VAR}` placeholders are substituted into `mcp.json`; values are set by admins in the dashboard. |

`variables` must be `{"type": "object", "properties": {...}}` and accepts only `type`, `title`, `description`, `default`, `enum`, `const`, `properties`, `required`, `items`, and common length/numeric constraints.

Cursor documents no `lspServers`, `outputStyles`, `workflows`, `userConfig`, `settings`, `strict`, or `dependencies` for this manifest. A manifest field replaces folder discovery for that component.

## Marketplace manifest (`.cursor-plugin/marketplace.json`)

Required: `name`, `owner`, `plugins` (max 500 entries).

| Field      | Type                                    | Notes                                                   |
| ---------- | --------------------------------------- | ------------------------------------------------------- |
| `name`     | string                                  | Marketplace identifier.                                 |
| `owner`    | `{name, email?}`                        | Real catalogs also use `url`.                           |
| `plugins`  | array                                   | At most 500 entries.                                    |
| `metadata` | `{description?, version?, pluginRoot?}` | `pluginRoot` is the prefix path for all plugin sources. |

Entry fields: `name` (required), `source` (required), `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `logo`, `category`, `tags`, `skills`, `rules`, `agents`, `commands`, `hooks`, `mcpServers`, `variables`.

`source` is "a path to the plugin directory, or an object with `path` and options" — the docs leave the option set unspecified. Resolution: look for `<source>/.cursor-plugin/plugin.json`, merge it with the entry (**manifest values take precedence**), then discover components inside the source directory using manifest paths where declared.

A bare source name resolves under `metadata.pluginRoot` (for example `tldraw/tldraw`: `pluginRoot: "apps/mcp-app/plugins"`, `source: "tldraw-mcp"`).

## Directory layout

```text
my-plugin/
├── .cursor-plugin/plugin.json   # required manifest
├── rules/                       # .mdc files
├── skills/<name>/SKILL.md
├── agents/
├── commands/
├── hooks/hooks.json
├── mcp.json                     # documented default; the dot-file .mcp.json is not auto-discovered
├── assets/
└── scripts/
```

Hook events include `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `subagentStart`, `subagentStop`, `beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution`, `afterMCPExecution`, `beforeReadFile`, `afterFileEdit`, `beforeSubmitPrompt`, `preCompact`, `stop`, `afterAgentResponse`, `afterAgentThought`, `beforeTabFileRead`, `afterTabFileEdit`, and `workspaceOpen`; entries carry `command` and `matcher`.

## Precedence

1. Marketplace entry versus plugin manifest: manifest values win.
2. Component path versus discovery: a declared field replaces discovery for that component.
3. MCP: a manifest `mcpServers` value overrides `mcp.json` discovery.
4. Local development: `~/.cursor/plugins/local/<name>` loses to an installed marketplace plugin of the same name.

## Evidence gaps

1. `displayName` and `author.url` are used by official repos but missing from the docs table.
2. The marketplace entry `source` object's option set is unspecified.
3. Hook merge precedence (inline versus file, plugin versus project) is undocumented.
4. Format precedence when both a root `plugin.json` and `.cursor-plugin/plugin.json` exist is undocumented.
5. Whether Cursor auto-discovers `.mcp.json` (dot) is unverified; the documented default is `mcp.json`.
6. No LSP support is documented for Cursor plugins.
