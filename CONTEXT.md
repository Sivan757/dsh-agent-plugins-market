# Domain glossary

## Catalog source

A configured Git repository or local directory from which suites are read. A source identifies where content comes from; it does not describe the manifest format used by that content.

## Plugin layout dialect

An on-disk manifest and directory convention used by a source, such as agent-plugins v1, Claude Code, Codex, Cursor, Kimi, universal, or a manifest-less skill collection.

## Suite

A normalized installable plugin unit discovered from a catalog source. A suite has an identity, metadata, supported runtime surfaces, and an installation state.

## Runtime surface

A capability a suite can provide to the harness, such as skills, MCP servers, hooks, commands, agents, or LSP definitions. A runtime surface is distinct from the layout dialect that describes it.

## Install state

The user-owned record that says whether a suite is installed and enabled, together with its installation metadata. Discovery content and install state are separate facts.

## User and project dimensions

The user dimension applies across sessions. The project dimension applies to a workspace project. The two dimensions can use the same layout dialects but have different ownership and precedence rules.

## Agent layout root

The shared `~/.agents` directory (or `$DSH_AGENTS_HOME`) holding the resources the user authors by hand: `skills/`, `commands/`, `agents/`, and the `mcp.json` / `lsp.json` service declarations. It is distinct from the plugin state root, `~/.dsh/agent-plugins`, which holds checkouts, install state and overrides.

## Translation unit

One translatable field of one entity: the surface it belongs to, the entity's stable id inside that surface, the role (`name` or `description`), and the upstream text exactly as authored. A unit is what the translation cache keys on and what the provider chain answers for.

## Translation provider

One level of the ordered fallback chain that answers a translation unit: Google Translate, Microsoft Translator, the user's default model, or the upstream text when none of them answers. A provider's identity is part of the cache key, so changing the chain re-translates instead of serving text another level produced.
