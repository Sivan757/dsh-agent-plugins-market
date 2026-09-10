# Agent Plugins (agent-plugins.org) v1 specification

The only published cross-vendor plugin format in this directory. Unlike the other dialects, its schemas are **vendored upstream** and loaded at runtime by this plugin.

- **Schemas:** [../1.0.0/plugin.schema.json](../1.0.0/plugin.schema.json), [../1.0.0/mcp.schema.json](../1.0.0/mcp.schema.json)
- **Specification:** https://agent-plugins.org/specification
- **Repository:** [`agentplugins/agent-plugins-spec`](https://github.com/agentplugins/agent-plugins-spec) (`spec/1.0.0.md`, `schemas/1.0.0/`)
- **Status:** 1.0.0 published; 1.1.0 is a working draft whose plugin schema is currently byte-identical to 1.0.0.
- **Runtime use:** `src/catalog/validate.ts` loads both 1.0.0 schemas through Ajv, and `src/catalog/manifests.ts` selects this dialect only when a root `plugin.json` declares a recognized `$schema`.

## Manifest location

Normative (§5.1): clients MUST check for a manifest at `plugin.json` in the plugin root. The core specification defines exactly one portable manifest per plugin, and no other file can replace, supplement, or override its core fields. The specification text contains no reference to `.plugin/`, `.codex-plugin/`, `.claude-plugin/`, `.cursor-plugin/`, or `.kimi-plugin/`.

## Plugin manifest fields

Closed schema: `additionalProperties: false`, `required: ["$schema", "name"]`, and no `default` keyword anywhere.

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `$schema` | string | yes | `const: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` |
| `name` | string | yes | 1–64 chars, `^(?!.*(?:--\|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$` |
| `version` | string | no | SemVer recommended, not enforced. |
| `description` | string | no |  |
| `author` | `{name?, email?, url?}` | no | Closed object; fields unvalidated. |
| `homepage`, `repository` | string | no | Not URL-validated. |
| `license` | string | no | SPDX recommended, not enforced. |
| `keywords` | string[] | no | No `minItems`/`uniqueItems`. |
| `extensions` | object of object | no | Client-specific data keyed by reverse-domain namespace; the specification assigns no semantics to namespace contents. |

## Fixed component locations

Clients MUST discover each supported component type from its fixed location, and `plugin.json` cannot override those locations or carry inline component configuration.

| Component   | Location   | Pattern                                        |
| ----------- | ---------- | ---------------------------------------------- |
| Skills      | `skills/`  | Immediate subdirectories containing `SKILL.md` |
| MCP servers | `mcp.json` | JSON configuration                             |

v1 defines exactly these two component types. Commands, hooks, agents, rules, and LSP servers are explicitly outside the format "until their formats converge". MCP configuration MUST NOT be declared inline in `plugin.json`. The `mcp.json` schema is closed and requires `$schema` and `mcpServers` with no other top-level fields; every server requires `type` and must match exactly one closed variant.

## Governance and adoption

The technical steering committee is Amazon, Cursor, Microsoft, OpenAI, and Vercel (lead), with a rule that no single vendor may control a majority of core maintainer seats. Adopters list Agent Skills and MCP: VS Code, Cursor, GitHub Copilot, ChatGPT and Codex, Kiro, Hermes Agent, OpenClaw, Grok Bot, and NanoClaw. **Claude Code and Vercel are absent from that list**, and Vercel's own `vercel-plugin` repository is non-conformant (no root `plugin.json`, no `$schema`, ships `commands/`/`agents/`/`hooks/`, and puts MCP at `.mcp.json` instead of `mcp.json`). The OpenHands SDK vendors the schema and implements the format but keeps it out of its active format list pending its `mcp.json` loader.

## Update procedure

Replace both files from the upstream repository at the pinned spec version and bump the spec-version references in `src/catalog/validate.ts`. Do not edit the vendored files by hand.
