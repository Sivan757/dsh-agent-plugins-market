# Agent Plugins (agent-plugins.org) v1 specification

The only published cross-vendor plugin format in this directory. Unlike the other dialects, its schemas are **vendored upstream** and loaded at runtime by this plugin.

- **Schemas:** [`../1.0.0/plugin.schema.json`](../1.0.0/plugin.schema.json), [`../1.0.0/mcp.schema.json`](../1.0.0/mcp.schema.json), [`../1.1.0/plugin.schema.json`](../1.1.0/plugin.schema.json), [`../1.1.0/mcp.schema.json`](../1.1.0/mcp.schema.json)
- **Specification:** https://agent-plugins.org/specification
- **Repository:** [`agentplugins/agent-plugins-spec`](https://github.com/agentplugins/agent-plugins-spec) (`spec/1.0.0.md`, `spec/1.1.0.md`, `schemas/1.0.0/`, `schemas/1.1.0/`)
- **Status:** 1.0.0 published; 1.1.0 is a working draft whose schemas differ from 1.0.0 only in the version string (verified 2026-09-17 at upstream `ff8ab5e`); the spec text additionally renames two phrasings ("claiming conformance to Agent Plugins v1" → "claiming conformance", "Agent Plugins v1 defines no OAuth" → "This specification defines no OAuth"). This manager explicitly recognizes 1.1.0 as compatible (§5.2) and validates each version against its own vendored schemas.
- **Runtime use:** `src/catalog/validate.ts` loads all four vendored schemas through Ajv and selects the validator by the manifest's declared `$schema`; `src/catalog/manifests.ts` selects this dialect only when a root `plugin.json` declares a recognized `$schema`. Client-specific behavior beyond the portable core lives in the [`com.deepseek.harness` namespace](../com.deepseek.harness/spec.md).

## Manifest location

Normative (§5.1): clients MUST check for a manifest at `plugin.json` in the plugin root. The core specification defines exactly one portable manifest per plugin, and no other file can replace, supplement, or override its core fields. The specification text contains no reference to `.plugin/`, `.codex-plugin/`, `.claude-plugin/`, `.cursor-plugin/`, or `.kimi-plugin/`.

## Plugin manifest fields

Closed schema: `additionalProperties: false`, `required: ["$schema", "name"]`, and no `default` keyword anywhere. Per §5.2 an unknown top-level field is reported and ignored while the plugin keeps loading; any other schema violation is fatal.

| Field | Type | Required | Constraints |
| --- | --- | --- | --- |
| `$schema` | string | yes | `const`: the canonical id of one supported release (`1.0.0`, `1.1.0`) |
| `name` | string | yes | 1–64 chars, `^(?!.*(?:--\|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$` |
| `version` | string | no | SemVer recommended, not enforced. |
| `description` | string | no |  |
| `author` | `{name?, email?, url?}` | no | Closed object; fields unvalidated. |
| `homepage`, `repository` | string | no | Not URL-validated. |
| `license` | string | no | SPDX recommended, not enforced. |
| `keywords` | string[] | no | No `minItems`/`uniqueItems`. |
| `extensions` | object of object | no | Client-specific data keyed by reverse-domain namespace; the specification assigns no semantics to namespace contents. Violations inside this subtree are reported and ignored (§8.1). |

## Fixed component locations

Clients MUST discover each supported component type from its fixed location, and `plugin.json` cannot override those locations or carry inline component configuration.

| Component   | Location   | Pattern                                        |
| ----------- | ---------- | ---------------------------------------------- |
| Skills      | `skills/`  | Immediate subdirectories containing `SKILL.md` |
| MCP servers | `mcp.json` | JSON configuration                             |

v1 defines exactly these two component types. Commands, hooks, agents, rules, and LSP servers are explicitly outside the format "until their formats converge". MCP configuration MUST NOT be declared inline in `plugin.json`. The `mcp.json` schema is closed and requires `$schema` and `mcpServers` with no other top-level fields; every server requires `type` and must match exactly one closed variant (§7.2.2 rule 3: a per-server violation skips that server only). `mcp.json` `$schema` MUST name the same release as `plugin.json` (§10.1). Skills discovery covers one level of `skills/` subdirectories and MUST NOT search deeper descendants (§7.1). `mcp.json` fixes a location, not a presence requirement: a suite carrying skills only is conformant, and an absent `mcp.json` contributes zero servers.

## Marketplace catalogs

The specification defines no marketplace format — catalogs of v1 suites are a vendor-side convention, and the standard assigns them no schema. This manager reads three catalog shapes over v1 suite roots, in the shared scan order:

1. `.claude-plugin/marketplace.json` (Claude Code shape) — the format the first-party collection [dsh-agent-plugins](https://github.com/Sivan757/dsh-agent-plugins) ships.
2. Root `marketplace.json` — the fallback catalog for layouts without a dedicated one.
3. No catalog at all — rooted discovery walks the checkout (up to four levels deep) and reads every directory carrying a v1 manifest, so a bare collection is scannable without any catalog file.

A catalog entry's `name`/`version`/`description` are fallbacks: a conformant suite's own `plugin.json` wins for every field it declares. Entries may add display metadata the portable manifest cannot express (`category`, `keywords`). Entry sources resolve relative to the catalog's checkout; with no `source`, each entry resolves against the catalog checkout's own containers.

## Client extensions

§8 gives every client a reverse-domain namespace: manifest data under `extensions`, files under a top-level directory of the same name. Other clients MUST ignore unimplemented namespaces without validating their contents. This manager's namespace is [`com.deepseek.harness`](../com.deepseek.harness/spec.md) — it carries the component types the portable format leaves out and the per-server client policy the closed `mcp.json` schema cannot hold.

## Governance and adoption

The technical steering committee is Amazon, Cursor, Microsoft, OpenAI, and Vercel (lead), with a rule that no single vendor may control a majority of core maintainer seats. Adopters list Agent Skills and MCP: VS Code, Cursor, GitHub Copilot, ChatGPT and Codex, Kiro, Hermes Agent, OpenClaw, Grok Bot, and NanoClaw. **Claude Code and Vercel are absent from that list**, and Vercel's own `vercel-plugin` repository is non-conformant (no root `plugin.json`, no `$schema`, ships `commands/`/`agents/`/`hooks/`, and puts MCP at `.mcp.json` instead of `mcp.json`). The OpenHands SDK vendors the schema and implements the format but keeps it out of its active format list pending its `mcp.json` loader.

## Update procedure

Replace the vendored files from the upstream repository at the pinned spec versions and bump the spec-version references in `src/catalog/validate.ts`. Do not edit the vendored files by hand.
