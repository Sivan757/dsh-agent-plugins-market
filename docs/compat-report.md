# Compatibility report

Generated 2026-09-09 by `node scripts/compat-report.mjs`. Samples are pinned in `scripts/compat-sources.json`.

Every schema in `schemas/` is exercised against one real GitHub repository: the highest-starred candidate that ships the layout, found with GitHub code search on the selection date. Each row answers two independent questions — does the repository satisfy the schema, and what does this plugin actually do when it reads the checkout.

## Summary

| Layout | Sample repository | Commit | Dialect manifest | Schema | Scanner verdict | Suites | Surfaces |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude-code | [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana) | `75dc30f` | `.claude-plugin/plugin.json` | valid | integrated | 1 | skills 0, commands 0, agents 0, mcp 1, hooks 0, lsp 0 |
| codex | [saadeghi/daisyui](https://github.com/saadeghi/daisyui) | `9a4b5ad` | `.codex-plugin/plugin.json` | valid | shadowed | 1 | skills 5, commands 0, agents 0, mcp 0, hooks 0, lsp 0 |
| cursor | [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) | `8df6779` | `.cursor-plugin/plugin.json` | valid / valid | shadowed | 1 | skills 33, commands 0, agents 0, mcp 0, hooks 0, lsp 0 |
| kimi | [obra/superpowers](https://github.com/obra/superpowers) | `b36e082` | `.kimi-plugin/plugin.json` | valid | shadowed | 1 | skills 14, commands 0, agents 0, mcp 0, hooks 1, lsp 0 |
| universal | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | `6dbe1a1` | `.plugin/plugin.json` | valid | integrated | 1 | skills 18, commands 0, agents 0, mcp 0, hooks 0, lsp 0 |
| agent-plugins | [saadeghi/daisyui](https://github.com/saadeghi/daisyui) | `9a4b5ad` | `plugin.json` | valid | integrated | 1 | skills 5, commands 0, agents 0, mcp 0, hooks 0, lsp 0 |
| zcode | [zenstory-ai/oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode) | `12a300a` | `.zcode-plugin/plugin.json` | valid / valid | shadowed | 1 | skills 13, commands 0, agents 0, mcp 0, hooks 0, lsp 0 |
| qoder | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | `356918e` | `.qoder-plugin/plugin.json` | valid | shadowed | 1 | skills 6, commands 0, agents 0, mcp 0, hooks 3, lsp 0 |
| github-copilot | [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) | `e67b3c8` | `.github/plugin/marketplace.json` | valid | shadowed | 1 | skills 0, commands 0, agents 0, mcp 0, hooks 2, lsp 0 |

## Method

- **Schema.** Each sample dialect manifest is parsed and validated with Ajv 2020-12 against the schema named in the row. The agent-plugins sample uses the vendored schemas/1.0.0/plugin.schema.json.
- **Scanner.** Each checkout is scanned by the shipped catalog scanner (lib/catalog/suite-scanner.js scanSource) after a sparse depth-1 clone, so the row records what this plugin actually does with the repository.
- **Marketplace.** The scanner marketplace lookup order is `.claude-plugin/marketplace.json` then `.agents/plugins/marketplace.json` then `.plugin/marketplace.json` then `.cursor-plugin/marketplace.json` then `.kimi-plugin/marketplace.json` then `.agents/plugins/api_marketplace.json` then `.qoder-plugin/marketplace.json` then `.github/plugin/marketplace.json` then `marketplace.json`; other dialects' marketplace files are listed for context but are not read.
- **Selection.** GitHub code search for the layout's manifest path, then a batched GraphQL star lookup over the first 40 candidates; the highest-starred candidate was verified file-by-file to ship the manifest before being pinned here. This is the highest-starred candidate the search returned, not an exhaustive ranking of every repository on GitHub. Metric: stargazers, checked 2026-09-08.

Verdicts: **integrated** — The scanner read this dialect’s own manifest as the suite identity. **shadowed** — Suites were discovered, but a different dialect’s manifest won. **unread** — The checkout produced no suite. **error** — Acquisition or scanning failed; see the error field.

## Samples

### claude-code

- **Repository:** [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana) @ `75dc30f8fc5960d8b16ba393a8cc1f0e5ed2a6f8` (branch `main`, 3433 stars at selection).
- **Dialect manifest:** `.claude-plugin/plugin.json`
- **Verdict:** **integrated** — The scanner read `.claude-plugin/plugin.json` as the suite identity.
- **Schema (plugin):** `.claude-plugin/plugin.json` against `schemas/claude-code/plugin.schema.json` — valid
- **Scanner:** 1 suite(s); layouts `claude-code`.
- **Surfaces:** skills 0, commands 0, agents 0, mcp 1, hooks 0, lsp 0.
- **Marketplace files present:** none; productive marketplace reported by the scanner: none.
- **Suites read:**
  - `grafana` — layout `claude-code`, identity from `.claude-plugin/plugin.json`, surfaces skills 0, mcp 1, hooks 0, commands 0, agents 0, lsp 0.
- **Why this repository:** A Claude Code plugin that declares its MCP server inline in plugin.json and ships no skills or commands.

### codex

- **Repository:** [saadeghi/daisyui](https://github.com/saadeghi/daisyui) @ `9a4b5ad28edecdad8caedc8059da1a88d0adf50e` (branch `master`, 42328 stars at selection).
- **Dialect manifest:** `.codex-plugin/plugin.json`
- **Verdict:** **shadowed** — The scanner discovered 1 suite(s) but not through `.codex-plugin/plugin.json`; the winning layout was agent-plugin-v1.
- **Schema (plugin):** `.codex-plugin/plugin.json` against `schemas/codex/plugin.schema.json` — valid
- **Scanner:** 1 suite(s); layouts `agent-plugin-v1`.
- **Surfaces:** skills 5, commands 0, agents 0, mcp 0, hooks 0, lsp 0.
- **Marketplace files present:** `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `.cursor-plugin/marketplace.json`; productive marketplace reported by the scanner: `.claude-plugin/marketplace.json`.
- **Suites read:**
  - `daisyui` — layout `agent-plugin-v1`, identity from `plugin.json`, surfaces skills 5, mcp 0, hooks 0, commands 0, agents 0, lsp 0.
- **Scan notes:**
  - marketplace entry "daisyui-blueprint": path "./packages/blueprint" is missing or unreadable
- **Why this repository:** Ships a root plugin.json (agent-plugins v1.0.0), .codex-plugin, .claude-plugin, .cursor-plugin and .agents/plugins marketplace at once; the root manifest wins dialect precedence.

### cursor

- **Repository:** [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) @ `8df67793b9733d2220fa9a7fc37139931471af62` (branch `main`, 24956 stars at selection).
- **Dialect manifest:** `.cursor-plugin/plugin.json` · marketplace `.cursor-plugin/marketplace.json`
- **Verdict:** **shadowed** — The scanner discovered 1 suite(s) but not through `.cursor-plugin/plugin.json`; the winning layout was claude-code.
- **Schema (plugin):** `.cursor-plugin/plugin.json` against `schemas/cursor/plugin.schema.json` — valid
- **Schema (marketplace):** `.cursor-plugin/marketplace.json` against `schemas/cursor/marketplace.schema.json` — valid
- **Scanner:** 1 suite(s); layouts `claude-code`.
- **Surfaces:** skills 33, commands 0, agents 0, mcp 0, hooks 0, lsp 0.
- **Marketplace files present:** `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `.cursor-plugin/marketplace.json`, `.kimi-plugin/marketplace.json`; productive marketplace reported by the scanner: `.claude-plugin/marketplace.json`.
- **Suites read:**
  - `compound-engineering` — layout `claude-code`, identity from `plugin.json`, surfaces skills 33, mcp 0, hooks 0, commands 0, agents 0, lsp 0.
- **Why this repository:** Ships ten dialect directories; the root plugin.json carries no $schema, so the scanner reads it leniently as the Claude layout.

### kimi

- **Repository:** [obra/superpowers](https://github.com/obra/superpowers) @ `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (branch `main`, 283142 stars at selection).
- **Dialect manifest:** `.kimi-plugin/plugin.json`
- **Verdict:** **shadowed** — The scanner discovered 1 suite(s) but not through `.kimi-plugin/plugin.json`; the winning layout was claude-code.
- **Schema (plugin):** `.kimi-plugin/plugin.json` against `schemas/kimi/plugin.schema.json` — valid
- **Scanner:** 1 suite(s); layouts `claude-code`.
- **Surfaces:** skills 14, commands 0, agents 0, mcp 0, hooks 1, lsp 0.
- **Marketplace files present:** `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`; productive marketplace reported by the scanner: `.claude-plugin/marketplace.json`.
- **Suites read:**
  - `superpowers` — layout `claude-code`, identity from `.claude-plugin/plugin.json`, surfaces skills 14, mcp 0, hooks 1, commands 0, agents 0, lsp 0.
- **Why this repository:** Ships .claude-plugin, .codex-plugin, .cursor-plugin and .kimi-plugin; the Claude manifest wins precedence.

### universal

- **Repository:** [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) @ `6dbe1a1d868eab51a3bc9011b0f55e2891513e40` (branch `main`, 17945 stars at selection).
- **Dialect manifest:** `.plugin/plugin.json`
- **Verdict:** **integrated** — The scanner read `.plugin/plugin.json` as the suite identity.
- **Schema (plugin):** `.plugin/plugin.json` against `schemas/universal/plugin.schema.json` — valid
- **Scanner:** 1 suite(s); layouts `universal`.
- **Surfaces:** skills 18, commands 0, agents 0, mcp 0, hooks 0, lsp 0.
- **Marketplace files present:** `.claude-plugin/marketplace.json`; productive marketplace reported by the scanner: `.claude-plugin/marketplace.json`.
- **Suites read:**
  - `context-engineering` — layout `universal`, identity from `.plugin/plugin.json`, surfaces skills 18, mcp 0, hooks 0, commands 0, agents 0, lsp 0.
- **Why this repository:** Ships .plugin/plugin.json with no higher-precedence root manifest, so the universal dialect is read directly.

### agent-plugins

- **Repository:** [saadeghi/daisyui](https://github.com/saadeghi/daisyui) @ `9a4b5ad28edecdad8caedc8059da1a88d0adf50e` (branch `master`, 42328 stars at selection).
- **Dialect manifest:** `plugin.json`
- **Verdict:** **integrated** — The scanner read `plugin.json` as the suite identity.
- **Schema (plugin):** `plugin.json` against `schemas/1.0.0/plugin.schema.json` — valid
- **Scanner:** 1 suite(s); layouts `agent-plugin-v1`.
- **Surfaces:** skills 5, commands 0, agents 0, mcp 0, hooks 0, lsp 0.
- **Marketplace files present:** `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `.cursor-plugin/marketplace.json`; productive marketplace reported by the scanner: `.claude-plugin/marketplace.json`.
- **Suites read:**
  - `daisyui` — layout `agent-plugin-v1`, identity from `plugin.json`, surfaces skills 5, mcp 0, hooks 0, commands 0, agents 0, lsp 0.
- **Scan notes:**
  - marketplace entry "daisyui-blueprint": path "./packages/blueprint" is missing or unreadable
- **Why this repository:** Root plugin.json declares the agent-plugins.org v1.0.0 $schema; validated with the vendored schemas/1.0.0/plugin.schema.json.

### zcode

- **Repository:** [zenstory-ai/oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode) @ `12a300afb9735307657e2f84f27c51f8ca069f24` (branch `main`, 6665 stars at selection).
- **Dialect manifest:** `.zcode-plugin/plugin.json` · marketplace `marketplace.json`
- **Verdict:** **shadowed** — The scanner discovered 1 suite(s) but not through `.zcode-plugin/plugin.json`; the winning layout was claude-code.
- **Schema (plugin):** `.zcode-plugin/plugin.json` against `schemas/zcode/plugin.schema.json` — valid
- **Schema (marketplace):** `marketplace.json` against `schemas/zcode/marketplace.schema.json` — valid
- **Scanner:** 1 suite(s); layouts `claude-code`.
- **Surfaces:** skills 13, commands 0, agents 0, mcp 0, hooks 0, lsp 0.
- **Marketplace files present:** `.claude-plugin/marketplace.json`, `marketplace.json`; productive marketplace reported by the scanner: `.claude-plugin/marketplace.json`.
- **Suites read:**
  - `oh-story` — layout `claude-code`, identity from `.claude-plugin/plugin.json`, surfaces skills 13, mcp 0, hooks 0, commands 0, agents 0, lsp 0.
- **Why this repository:** Ships ZCode and Claude manifests together. The isolated ZCode fixture verifies its custom commands directory and process-hook configuration.

### qoder

- **Repository:** [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) @ `356918eba965ee1eac64bd3a7f0dd02108350de5` (branch `main`, 131816 stars at selection).
- **Dialect manifest:** `.qoder-plugin/plugin.json`
- **Verdict:** **shadowed** — The scanner discovered 1 suite(s) but not through `.qoder-plugin/plugin.json`; the winning layout was claude-code.
- **Schema (plugin):** `.qoder-plugin/plugin.json` against `schemas/qoder/plugin.schema.json` — valid
- **Scanner:** 1 suite(s); layouts `claude-code`.
- **Surfaces:** skills 6, commands 0, agents 0, mcp 0, hooks 3, lsp 0.
- **Marketplace files present:** `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `.github/plugin/marketplace.json`; productive marketplace reported by the scanner: `.claude-plugin/marketplace.json`.
- **Suites read:**
  - `ponytail` — layout `claude-code`, identity from `plugin.json`, surfaces skills 6, mcp 0, hooks 3, commands 0, agents 0, lsp 0.
- **Why this repository:** Ships Qoder beside several higher-precedence manifests. The isolated fixture verifies Qoder identity and its declared hooks/qoder-hooks.json.

### github-copilot

- **Repository:** [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) @ `e67b3c8a29443a60d6b0018fb22f525c5cd7e709` (branch `main`, 70594 stars at selection).
- **Dialect manifest:** `—` · marketplace `.github/plugin/marketplace.json`
- **Verdict:** **shadowed** — The scanner discovered 1 suite(s) but not through `.github/plugin/marketplace.json`; the winning layout was claude-code.
- **Schema (marketplace):** `.github/plugin/marketplace.json` against `schemas/github-copilot/marketplace.schema.json` — valid
- **Scanner:** 1 suite(s); layouts `claude-code`.
- **Surfaces:** skills 0, commands 0, agents 0, mcp 0, hooks 2, lsp 0.
- **Marketplace files present:** `.claude-plugin/marketplace.json`, `.github/plugin/marketplace.json`; productive marketplace reported by the scanner: `.claude-plugin/marketplace.json`.
- **Suites read:**
  - `headroom` — layout `claude-code`, identity from `plugins/headroom-agent-hooks/.claude-plugin/plugin.json`, surfaces skills 0, mcp 0, hooks 2, commands 0, agents 0, lsp 0.
- **Why this repository:** Ships Copilot and Claude marketplaces. The isolated fixture removes Claude manifests at every suite root and verifies Copilot's hooks directory declaration.

## Regenerating

```sh
node scripts/compat-report.mjs            # reuse cached checkouts
node scripts/compat-report.mjs --refresh  # re-clone every sample
node scripts/compat-report.mjs --dialect zcode
```

Checkouts are cached under `node_modules/.cache/compat-report/<dialect>`; acquisition is a sparse, blobless, depth-1 clone, so a multi-gigabyte repository costs under a megabyte. The report is a point-in-time measurement: `tests/compat-report.test.ts` keeps it structurally valid and covered, but it does not re-fetch the repositories.

