# 0003 — Agent Plugins v1 conformance floor and the client extension namespace

- Status: accepted (2026-09-17)
- Related: [Agent Note](../../.agents/notes/implemented/architecture/2026-09-17-agent-plugins-v1-conformance-and-harness-namespace.md), [namespace contract](../../schemas/com.deepseek.harness/spec.md), [0001-catalog-centered-modular-refactor](0001-catalog-centered-modular-refactor.md)

## Context

The market reads ten suite layouts. Only one, agent-plugins.org v1, is a published cross-vendor specification with a conformance checklist (its Appendix A). Before this decision the manager's v1 support was partial and locally extended: unknown manifest top-level fields were fatal (§5.2 makes them non-fatal), one broken `mcp.json` server killed the whole file (§7.2.2 rule 3 requires per-server isolation), `PLUGIN_ROOT`/`PLUGIN_DATA` were expanded but never injected into the child environment and the data directory was never created (§9.1), skills discovery ignored the spec's one-level shape (§7.1), remote URLs/headers carried no §7.2.1 validation, and the OAuth `auth` field lived in a hand-edited vendored schema that no longer matched its canonical id (§10.1).

At the same time every v1 extension this manager ships (commands, agents, hooks, LSP, OAuth policy) sat outside the specification's extension mechanism (§8: `extensions` data plus a reverse-domain namespace directory), so a conformant upstream tool could not load our extensions without guessing.

## Decision

1. **The portable dialect is conformance-first.** `agent-plugin-v1` reads only `skills/`, `mcp.json`, and the `com.deepseek.harness` namespace. Failure boundaries follow the spec: fatal manifest violations reject the candidate; unknown top-level fields and the whole `extensions` subtree are reported and ignored; `mcp.json` file-level violations disable MCP for the suite while per-server violations skip their server; skills discovery is one level with realpath containment; child processes get a created `PLUGIN_DATA` directory and both variables injected after the configured env overlay.
2. **Client extensions live in the namespace.** `com.deepseek.harness` has two seats — manifest data (namespace `schemaVersion` plus per-server policy) and a top-level directory (`commands/`, `agents/`, `hooks/hooks.json`, `lsp.json`). Both open only when the manifest declares a supported `schemaVersion`. The contract is documented in `schemas/com.deepseek.harness/` and evolves under its own version, independent of upstream releases.
3. **Vendored schemas are inviolable.** `schemas/1.0.0/` and `schemas/1.1.0/` are byte-copies of upstream; client-specific fields never extend them. Both released versions are recognized (explicit compatible mapping, §5.2) and the manifest/MCP `$schema` versions must match (§10.1).

## Consequences

- Third-party v1 suites without the namespace contribute skills and MCP only. This is the point: what a conformant package means no longer depends on this manager's private conventions.
- Credential handling splits by data ownership: package data (portable `mcp.json`) stays literal per §9.2; user data (overrides, `~/.agents/mcp.json`, project-native files) keeps the `${NAME}` credential seam.
- The namespace is this manager's contract surface for future capabilities. Anything that cannot live in the portable core needs a namespace seat and a `schemaVersion` bump, never a vendored-schema edit.
