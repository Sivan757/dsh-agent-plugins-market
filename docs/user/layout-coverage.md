# Layout compatibility audit

English | [中文](layout-coverage.zh.md) | [README](../../README.md)

**Guide:** [Install](install.md) · [Sources](sources.md) · [Resources](resources.md) · [Services](services.md) · [Translation](translation.md) · [Settings](settings.md) · [Workspace](workspace.md) · [Agent roles](agent-roles.md) · [Layout audit](layout-coverage.md)

The active contracts in `schemas/` describe ten layouts: eight client/convention dialects, agent-plugins v1 (whose schemas are vendored under `1.0.0` and `1.1.0`, plus the [`com.deepseek.harness` namespace contract](../../packages/market-catalog/schemas/com.deepseek.harness/spec.md)), and a manifest-less skill collection. All ten discovery paths are exercised by the compatibility report against their sample repositories. This is not inferred from schema validity or from a higher-priority manifest reading the same repository.

| Layout | README repository fixture | Independently checked behavior |
| --- | --- | --- |
| Claude Code | `grafana/mcp-grafana` | Manifest identity and inline MCP |
| Codex | `saadeghi/daisyui` | Own manifest and skills; API marketplace alias and additive paths in contract cases |
| Cursor | `EveryInc/compound-engineering-plugin` | Own manifest and productive Cursor marketplace; schema-less MCP and component overrides in contract cases |
| Kimi Code | `obra/superpowers` | Compatibility and primary manifest paths, startup skill, appended skill instructions |
| Universal | `muratcankoylan/Agent-Skills-for-Context-Engineering` | Own manifest and skill collection |
| agent-plugins v1 | `saadeghi/daisyui` | Vendored schemas, portable root identity; extension surfaces (commands, agents, hooks, LSP) and per-server MCP policy from the `com.deepseek.harness` namespace in contract cases |
| ZCode | `zenstory-ai/oh-story-claudecode` | Own marketplace, custom commands path, all four process-hook declarations |
| Qoder CLI | `DietrichGebert/ponytail` | Own identity and declared `qoder-hooks.json` |
| GitHub Copilot | `headroomlabs-ai/headroom` | Own marketplace and nested plugin manifest, hooks directory; ponytail also exercises Copilot native event names |
| Skill collection | Universal repository above, with manifests suppressed | Real SKILL.md files remain discoverable without manifests |

## How the claims are checked

The layout claims come from `node scripts/compat-report.mjs`, which clones the sample repositories and reads their manifests with the market's own scanner. The report records what each sample declares and where the scanner found it, and it is the evidence this page cites.

The repository no longer ships an offline fixture set or a layout test suite. Scanning, component declarations, hook normalization and skill-source aggregation have no automated test; check a change by adding the sample repository as a market source in a real host and reading its suite detail.

Explicit marketplace and plugin declarations keep their identities, and undeclared roots with other runtime surfaces stay separate; the [skill collection contract](../../packages/market-catalog/schemas/skill-collection/spec.md#source-grouping) defines installation behavior.

Ten layouts are exercised through the market's source scan: a layout that parses but yields no suite surfaces as a scan note instead of a silent pass.

## Implementation

`component-files.ts` resolves contained paths and normalized resources; `suite-components.ts` normalizes hook and LSP declarations. Catalog counts, command/agent providers, role routing and detail panels consume those same resources. Invalid explicit hooks cannot revive the default hook file. Inline manifest commands remain read-only in the resource editor.

The project dimension reuses that normalization through `native-project.ts`, so `.agents/hooks/hooks.json` and `.agents/hooks.json` mount exactly like a suite's own `hooks.json`; a standalone file may hold the bare event table or a `hooks` key. `.agents/mcp.json` is that layout's own `mcpServers` document, beside root `.mcp.json` for Claude Code and `.cursor/mcp.json` for Cursor; ZCode reads its own files only. The user Agent layout root `~/.agents/` carries the same surfaces: the panel-authored skills, commands and personas, the same two hook file names, and hand-written `mcp.json` / `lsp.json` declarations.

A metadata-only root `plugin.json` keeps its existing identity but inherits missing component declarations from its co-located Claude manifest. Adding ponytail as a market source shows this: its root name-only file would otherwise hide its real hooks.

Kimi system/startup instructions use the existing scoped `systemPrompt` service. ZCode process hooks retain argv boundaries through quoted command adaptation. Supported Copilot/Cursor lifecycle event spellings map to the existing command-hook bridge. No host repository changes or additional dependencies were needed for this increment.

## Boundaries

The tests prove layout parsing and the implemented DSH component adapters. They do not execute arbitrary third-party hooks, start their MCP processes, certify remote credentials/binaries, or reproduce every original client feature. Some published templates still contain installation-specific values (for example ponytail's `PONYTAIL_DIR`); fixture tests retain that source text rather than silently fixing it.

Native editor rules, app connectors, vendor-specific tools/permission engines and hook events without DSH equivalents are not made portable by parsing their manifests. The legacy `kimi-cli` tool-plugin appendix is a different protocol from the active `schemas/kimi/plugin.schema.json` (Kimi Code). Project LSP remains diagnosed and unmounted under the user's no-host-changes constraint; user-suite LSP files and inline tables use the existing mount adapter. These boundaries must not be described as full upstream runtime equivalence.

## Reproduce

```sh
node scripts/compat-report.mjs
pnpm run check:refactor
```

The first command acquires the repositories under `node_modules/.cache/compat-report` and writes the report; the second verifies the tree. Scanning and parsing have no automated test in this repository, so a layout claim is checked through the market in a real host.
