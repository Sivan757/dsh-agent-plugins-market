# Plugin manifest and marketplace specifications

This directory is the specification library for the plugin layouts this manager reads. It holds two kinds of files:

1. **Vendored upstream schemas** in [`1.0.0/`](1.0.0/) — pinned copies of the official agent-plugins.org v1.0.0 schemas. These are bundled into the published package and loaded at runtime by [`src/catalog/validate.ts`](../src/catalog/validate.ts), because the specification requires clients to validate plugin packages without retrieving schemas at load time (§7.2.1: "Clients MUST NOT retrieve a schema while loading a plugin").
2. **Reference contracts** in `<dialect>/` — an authored JSON Schema pair plus a `spec.md` for each layout the manager recognizes. **These are documentation, not runtime validators**: the scanner still applies the strategy-chain rules in `src/catalog/`. They exist so a dialect's field set, file locations, and evidence are pinned in one place.

Every authored schema records its provenance in a `$comment`, and every dialect's `spec.md` records the sources, the verification date, and the unresolved gaps.

## Layout

```text
schemas/
├── 1.0.0/                     # vendored agent-plugins.org v1.0.0 (runtime-loaded)
│   ├── plugin.schema.json
│   └── mcp.schema.json
├── agent-plugins/spec.md      # the published cross-vendor standard (schemas live in 1.0.0/)
├── skill-collection/spec.md   # manifest-less layout; nothing to validate
└── <dialect>/
    ├── plugin.schema.json
    ├── marketplace.schema.json
    └── spec.md
```

## Dialect index

This table records **upstream client conventions**, including their own fallback orders; it does not define this plugin's discovery priority. DSH uses one shared layout order for suite manifests and Marketplace catalogs, shown in the [README priority table](../README.md#layout-detection-precedence) ([中文](../README.zh.md#布局识别优先级)). Catalogs without a dedicated layout use root `marketplace.json` as the final fallback.

| Dialect | Upstream plugin manifest conventions | Upstream marketplace conventions | Upstream schema |
| --- | --- | --- | --- |
| [Claude Code](claude-code/spec.md) | `.claude-plugin/plugin.json` (optional) | `.claude-plugin/marketplace.json`, or any `marketplace.json` added by path/URL | None; the URL the official catalog declares returns 404 |
| [Codex](codex/spec.md) | `plugin.json` (agent-plugins `$schema`) → `.codex-plugin/` → `.claude-plugin/` → `.cursor-plugin/` | `.agents/plugins/marketplace.json` → `.agents/plugins/api_marketplace.json` → `.claude-plugin/` → `.cursor-plugin/` | agent-plugins v1.0.0 for root `plugin.json`; none otherwise |
| [Cursor](cursor/spec.md) | `.cursor-plugin/plugin.json`, or root `plugin.json` (agent-plugins) | `.cursor-plugin/marketplace.json` | None for `.cursor-plugin/`; agent-plugins v1.0.0 for root |
| [Kimi (kimi-code)](kimi/spec.md) | `kimi.plugin.json` → `.kimi-plugin/plugin.json` | `KIMI_CODE_PLUGIN_MARKETPLACE_URL`, default `https://code.kimi.com/kimi-code/plugins/marketplace.json` | None reachable; the declared URI serves HTML |
| [Kimi (kimi-cli, legacy)](kimi/spec.md#kimi-cli-legacy-a-different-format) | `plugin.json` with a `tools` array | None | None |
| [Universal `.plugin/`](universal/spec.md) | `.plugin/plugin.json` | `.plugin/marketplace.json` | None — an observed convention, not a specification |
| [agent-plugins.org v1](agent-plugins/spec.md) | `plugin.json` (required) | Vendor-specific; not part of the standard | **Vendored 1.0.0** |
| [Skill collection](skill-collection/spec.md) | None | None | n/a |
| [ZCode](zcode/spec.md) | `.zcode-plugin/plugin.json` → `.claude-plugin/` → `.codex-plugin/` | `.claude-plugin/marketplace.json` → `marketplace.json` | None |
| [Qoder CLI](qoder/spec.md) | `.qoder-plugin/plugin.json` → `.claude-plugin/plugin.json` | `.qoder-plugin/marketplace.json` → `.claude-plugin/` → `marketplace.json` | None |
| [GitHub Copilot CLI](github-copilot/spec.md) | `.plugin/plugin.json` → `plugin.json` → `.github/plugin/plugin.json` → `.claude-plugin/` | `marketplace.json` → `.plugin/` → `.github/plugin/` → `.claude-plugin/` | None; agent-plugins optional via `$schema` |

## Cross-dialect conventions

These are the points where the layouts actually differ; they cause the most silent failures.

| Dialect              | MCP configuration                                                                     | Hooks                              |
| -------------------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| Claude Code          | `.mcp.json`; inline `mcpServers` is additive                                          | `hooks/hooks.json` or inline       |
| Codex                | legacy: `.mcp.json` (validator rejects `mcp.json`); agent-plugins dialect: `mcp.json` | manifest `hooks` or `hooks/`       |
| Cursor               | `mcp.json` (dot-file only via an explicit `mcpServers` field)                         | `hooks/hooks.json` or inline       |
| Kimi (kimi-code)     | inline `mcpServers` only                                                              | inline `hooks` array               |
| Universal `.plugin/` | `.mcp.json`, `.github/mcp.json`                                                       | `hooks.json` or `hooks/hooks.json` |
| agent-plugins.org v1 | `mcp.json`, required and closed; inline is forbidden                                  | Not defined                        |
| ZCode                | `.mcp.json` only                                                                      | `hooks/hooks.json`                 |
| Qoder CLI            | `.mcp.json` → `mcp.json` (never merged)                                               | `hooks/hooks.json`                 |
| GitHub Copilot CLI   | `.mcp.json`, `.github/mcp.json`                                                       | `hooks.json` or `hooks/hooks.json` |

Claude Code and Copilot (including the Universal convention) define usable LSP declarations. Qoder/ZCode record the field without native execution. Cursor, Codex, Kimi and agent-plugins do not define a native LSP surface; this manager's shared LSP extension must not be confused with an upstream feature.

## Executable coverage

All ten active layouts are covered by [offline README repository tests](../tests/real-layouts.test.ts). Fixtures retain original Git blobs, commit IDs, hashes and licenses. Competing manifests are removed at every suite root in isolated cases, and the scanner reports the productive marketplace rather than inferring it from file presence. [Component contract tests](../tests/component-declarations.test.ts) cover path/array/inline forms and validation failures. See the [coverage audit](../docs/layout-coverage.md) for the exact boundary between layout compatibility and vendor-native runtime behavior.

## Provenance and update policy

- `1.0.0/*.schema.json` are vendored. Replace both files from [`agentplugins/agent-plugins-spec`](https://github.com/agentplugins/agent-plugins-spec) at the pinned spec version and bump the spec-version references in `src/catalog/validate.ts`. Never edit them by hand.
- `<dialect>/*.schema.json` and `spec.md` are authored here. They are **not** upstream copies and carry no upstream compatibility guarantee. When a cited source changes, re-verify and update the schema, the `spec.md`, and the `$comment` provenance line together.
- `agent-plugins/spec.md` documents the published standard but deliberately keeps its schemas in `1.0.0/` so there is exactly one copy in the tree.

## Validation

`tests/schemas.test.ts` compiles every schema with Ajv 2020-12, asserts `$id` uniqueness, pins the vendored ids to the runtime constants in `src/catalog/validate.ts`, and requires each dialect to keep a `spec.md` and a paired marketplace schema. Run `pnpm run test` after touching this directory; run `pnpm run format:check` for formatting.
