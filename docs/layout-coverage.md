# Layout compatibility audit

English | [中文](layout-coverage.zh.md)

The active contracts in `schemas/` describe ten layouts: eight client/convention dialects, agent-plugins v1 (whose schemas are vendored under `1.0.0`), and a manifest-less skill collection. All ten have executable discovery tests. This is not inferred from schema validity or from a higher-priority manifest reading the same repository.

| Layout | README repository fixture | Independently checked behavior |
| --- | --- | --- |
| Claude Code | `grafana/mcp-grafana` | Manifest identity and inline MCP |
| Codex | `saadeghi/daisyui` | Own manifest and skills; API marketplace alias and additive paths in contract cases |
| Cursor | `EveryInc/compound-engineering-plugin` | Own manifest and productive Cursor marketplace; schema-less MCP and component overrides in contract cases |
| Kimi Code | `obra/superpowers` | Compatibility and primary manifest paths, startup skill, appended skill instructions |
| Universal | `muratcankoylan/Agent-Skills-for-Context-Engineering` | Own manifest and skill collection |
| agent-plugins v1 | `saadeghi/daisyui` | Vendored schema and portable root identity |
| ZCode | `zenstory-ai/oh-story-claudecode` | Own marketplace, custom commands path, all four process-hook declarations |
| Qoder CLI | `DietrichGebert/ponytail` | Own identity and declared `qoder-hooks.json` |
| GitHub Copilot | `headroomlabs-ai/headroom` | Own marketplace and nested plugin manifest, hooks directory; ponytail also exercises Copilot native event names |
| Skill collection | Universal repository above, with manifests suppressed in the test | Real SKILL.md files remain discoverable without manifests |

## Test design

`tests/fixtures/real-layouts/` stores selected original declarations and runtime text, pinned to full commit IDs, with per-file SHA-256 and upstream licenses. `scripts/update-layout-fixtures.mjs` reads Git blobs at those commits; it does not trust modifications in cached working trees. Scripts and binaries are not executed by these tests.

`tests/real-layouts.test.ts` checks provenance, validates real manifests against their schemas, scans the original multi-layout tree, then materializes a second tree with competing manifests suppressed at every suite root. Productive marketplace provenance comes from the scanner itself. It also checks runtime command readers, hook normalization, detail projections, and Kimi instruction loading. The skill-collection and primary-Kimi cases are explicit derived layout variants, not claims about unmodified upstream locations.

`tests/component-declarations.test.ts` covers schema forms not present in every sample: file/directory/array paths, Cursor text extensions, MCP file/inline arrays, file LSP configs, Qoder inline commands, Kimi hooks/system prompts/catalog aliases, marketplace pluginRoot and entry-only declarations, Codex API catalogs, and containment/fail-closed cases.

## Implementation

`component-files.ts` resolves contained paths and normalized resources; `suite-components.ts` normalizes hook and LSP declarations. Catalog counts, command/agent providers, role routing and detail panels consume those same resources. Invalid explicit hooks cannot revive the default hook file. Inline manifest commands remain read-only in the resource editor.

A metadata-only root `plugin.json` keeps its existing identity but inherits missing component declarations from its co-located Claude manifest. The unmodified ponytail fixture verifies this behavior; otherwise its root name-only file would still hide its real hooks despite passing isolated tests.

Kimi system/startup instructions use the existing scoped `systemPrompt` service. ZCode process hooks retain argv boundaries through quoted command adaptation. Supported Copilot/Cursor lifecycle event spellings map to the existing command-hook bridge. No host repository changes or additional dependencies were needed for this increment.

## Boundaries

The tests prove layout parsing and the implemented DSH component adapters. They do not execute arbitrary third-party hooks, start their MCP processes, certify remote credentials/binaries, or reproduce every original client feature. Some published templates still contain installation-specific values (for example ponytail's `PONYTAIL_DIR`); fixture tests retain that source text rather than silently fixing it.

Native editor rules, app connectors, vendor-specific tools/permission engines and hook events without DSH equivalents are not made portable by parsing their manifests. The legacy `kimi-cli` tool-plugin appendix is a different protocol from the active `schemas/kimi/plugin.schema.json` (Kimi Code). Project LSP remains diagnosed and unmounted under the user's no-host-changes constraint; user-suite LSP files and inline tables use the existing mount adapter. These boundaries must not be described as full upstream runtime equivalence.

## Reproduce

```sh
node scripts/compat-report.mjs
node scripts/update-layout-fixtures.mjs
pnpm exec vitest run tests/real-layouts.test.ts tests/component-declarations.test.ts
pnpm run check:refactor
```

Only the first command acquires missing repository caches. Normal tests use committed snapshots and never require GitHub access.
