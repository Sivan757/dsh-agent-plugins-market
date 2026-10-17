# Universal `.plugin/` layout specification (observed convention)

Reference contract for repositories using `.plugin/plugin.json`. Machine-readable companions: [plugin.schema.json](plugin.schema.json) and [marketplace.schema.json](marketplace.schema.json).

- **Verified:** 2026-09-08.
- **Upstream specification:** **none.** `.plugin/plugin.json` is an observed convention with several independent implementers, not a published format. The originating open-plugin specification is not public (`vercel-labs/plugins` returns 404). The real cross-vendor format exists but mandates a root `plugin.json` — see [../agent-plugins/spec.md](../agent-plugins/spec.md).
- **Evidence:** GitHub Copilot CLI official docs (`.plugin/plugin.json` is first in its lookup order); `OpenHands/software-agent-sdk` (`openhands/sdk/plugin/format/claude_code.py`, docs at `docs.openhands.dev/sdk/guides/plugins`); [`vercel/vercel-plugin`](https://github.com/vercel/vercel-plugin) (the only real `.plugin/plugin.json`, 682 bytes, with no component declaration fields); `aaif-goose/goose` (`crates/goose/src/plugins/formats/open_plugins.rs`).

## Implementers and precedence

| Implementer          | Lookup order                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GitHub Copilot CLI   | `.plugin/plugin.json` → `plugin.json` → `.github/plugin/plugin.json` → `.claude-plugin/plugin.json`              |
| OpenHands SDK        | `.plugin/plugin.json` → `.claude-plugin/plugin.json`; falls back to inferring a manifest from the directory name |
| goose                | `.goose-plugin/plugin.json` → `.plugin/plugin.json` → `plugin.json`                                              |
| vercel/vercel-plugin | Ships `.plugin/plugin.json` only                                                                                 |

Marketplace manifests: OpenHands checks `.plugin/marketplace.json` then `.claude-plugin/marketplace.json`; Copilot CLI checks `marketplace.json`, `.plugin/marketplace.json`, `.github/plugin/marketplace.json`, `.claude-plugin/marketplace.json`.

## Plugin manifest fields

There is no authoritative field list, so this schema is the union of the consumers. `vercel/vercel-plugin`'s validator requires `name`, `version`, and `description`; the only real file declares exactly those plus `author`, `repository`, `license`, and `keywords`, and **no component declaration fields at all** — components are discovered from directories.

When Copilot CLI reads `.plugin/plugin.json`, its own manifest schema applies: `name` (required, kebab-case, max 64), `description` (max 1024), `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `category`, `tags`, `agents`, `skills`, `commands`, `hooks`, `extensions`, `mcpServers`, `lspServers`.

| Item | Copilot CLI | OpenHands | vercel-plugin | Agent Plugins (for contrast) |
| --- | --- | --- | --- | --- |
| Skills | `skills/` | `skills/<name>/SKILL.md`, flat `skills/*.md`, root `SKILL.md` | `skills/` | `skills/` (fixed) |
| Agents | `agents/` | `agents/*.md` | `agents/` | not defined |
| Commands | `commands/` | `commands/*.md` | `commands/` | not defined |
| Hooks | `hooks.json` or `hooks/hooks.json` | `hooks/hooks.json` | `hooks/hooks.json` | not defined |
| MCP | `.mcp.json`, `.github/mcp.json` | `.mcp.json` | `.mcp.json` | `mcp.json` (no dot) |
| LSP | `lspServers`, `lsp.json`, `.github/lsp.json`, `lsp-config/servers.json` | marketplace entries only | — | not defined |

## Marketplace manifest fields

The two consumers require different sets:

| Level | Field | OpenHands | Copilot CLI |
| --- | --- | --- | --- |
| top | `name` | required | required |
| top | `owner` | required | required |
| top | `plugins` | optional (default `[]`) | required |
| top | `skills` | optional skill entries | — |
| top | `description`, `metadata` | optional | optional |
| entry | `name`, `source` | required | required |
| entry | `strict` | default `true`; `false` lets the entry define the plugin inline | default `true` |
| entry | component fields (`commands`, `agents`, `hooks`, `mcpServers`, `lspServers`) | declared on the entry | declared on the entry |
| entry | metadata (`description`, `version`, `author`, `category`, `homepage`, `entry_command`, `license`, `keywords`, `tags`, `repository`) | accepted | accepted |

## Status

`.plugin/plugin.json` is not covered by any cross-vendor specification. Treat it as a compatibility layout: repositories that ship it are readable by Copilot CLI and OpenHands, but nothing guarantees field semantics beyond `name`. The portable standard is [agent-plugins.org v1](../agent-plugins/spec.md).
