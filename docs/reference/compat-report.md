# Compatibility report

Generated 2026-09-17 by `node scripts/compat-report.mjs`. Samples are pinned in `scripts/compat-sources.json`.

Every schema in `schemas/` is exercised against one real GitHub repository: the highest-starred candidate that ships the layout, found with GitHub code search on the selection date. Each row answers two independent questions — does the repository satisfy the schema, and what does this plugin actually do when it reads the checkout.

## Summary

| Layout | Sample repository | Commit | Dialect manifest | Schema | Scanner verdict | Suites | Surfaces |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude-code | [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana) | `9ad4c23` | `.claude-plugin/plugin.json` | valid | integrated | 1 | skills 0, commands 0, agents 0, mcp 1, hooks 0, lsp 0 |
| codex | [saadeghi/daisyui](https://github.com/saadeghi/daisyui) | `—` | `.codex-plugin/plugin.json` | — | error | — | — |
| cursor | [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) | `082c83e` | `.cursor-plugin/plugin.json` | valid / valid | shadowed | 1 | skills 35, commands 0, agents 0, mcp 0, hooks 0, lsp 0 |
| kimi | [obra/superpowers](https://github.com/obra/superpowers) | `—` | `.kimi-plugin/plugin.json` | — | error | — | — |
| universal | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | `—` | `.plugin/plugin.json` | — | error | — | — |
| agent-plugins | [saadeghi/daisyui](https://github.com/saadeghi/daisyui) | `dd0a94a` | `plugin.json` | valid | integrated | 1 | skills 1, commands 0, agents 0, mcp 0, hooks 0, lsp 0 |
| zcode | [zenstory-ai/oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode) | `fe1c133` | `.zcode-plugin/plugin.json` | valid / valid | shadowed | 1 | skills 13, commands 0, agents 0, mcp 0, hooks 0, lsp 0 |
| qoder | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | `e3ba2aa` | `.qoder-plugin/plugin.json` | valid | shadowed | 1 | skills 6, commands 0, agents 0, mcp 0, hooks 3, lsp 0 |
| github-copilot | [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) | `2c56a1b` | `.github/plugin/marketplace.json` | valid | shadowed | 1 | skills 0, commands 0, agents 0, mcp 0, hooks 2, lsp 0 |

## Method

- **Schema.** Each sample dialect manifest is parsed and validated with Ajv 2020-12 against the schema named in the row. The agent-plugins sample uses the vendored schemas/1.0.0/plugin.schema.json.
- **Scanner.** Each checkout is scanned by the shipped catalog scanner (lib/catalog/suite-scanner.js scanSource) after a sparse depth-1 clone, so the row records what this plugin actually does with the repository.
- **Marketplace.** The scanner marketplace lookup order is `.plugin/marketplace.json` then `.claude-plugin/marketplace.json` then `.cursor-plugin/marketplace.json` then `.kimi-plugin/marketplace.json` then `.agents/plugins/marketplace.json` then `.agents/plugins/api_marketplace.json` then `.qoder-plugin/marketplace.json` then `.github/plugin/marketplace.json` then `marketplace.json`; other dialects' marketplace files are listed for context but are not read.
- **Selection.** GitHub code search for the layout's manifest path, then a batched GraphQL star lookup over the first 40 candidates; the highest-starred candidate was verified file-by-file to ship the manifest before being pinned here. This is the highest-starred candidate the search returned, not an exhaustive ranking of every repository on GitHub. Metric: stargazers, checked 2026-09-08.

Verdicts: **integrated** — The scanner read this dialect’s own manifest as the suite identity. **shadowed** — Suites were discovered, but a different dialect’s manifest won. **unread** — The checkout produced no suite. **error** — Acquisition or scanning failed; see the error field.

## Samples

### claude-code

- **Repository:** [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana) @ `9ad4c230e7f15e96719273e364f053450b7679c6` (branch `main`, 3433 stars at selection).
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

- **Repository:** [saadeghi/daisyui](https://github.com/saadeghi/daisyui) @ `—` (branch `master`, 42328 stars at selection).
- **Dialect manifest:** `.codex-plugin/plugin.json`
- **Verdict:** **error** — git clone --depth 1 --filter=blob:none --no-checkout --branch master https://github.com/saadeghi/daisyui.git /Users/sivan/workspace/.worktrees/market-ap-namespace/node_modules/.cache/compat-report/codex failed: 正克隆到 '/Users/sivan/workspace/.worktrees/market-ap-namespace/node_modules/.cache/compat-report/codex'... 致命错误：无法访问 'https://github.com/saadeghi/daisyui.git/'：Failed to connect to github.com port 443 after 75007 ms: Couldn't connect to server
- **Why this repository:** Ships a root plugin.json (agent-plugins v1.0.0), .codex-plugin, .claude-plugin, .cursor-plugin and .agents/plugins marketplace at once; the root manifest wins dialect precedence.

### cursor

- **Repository:** [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) @ `082c83e0537c803ac1d927daafc2e6eb6962dedf` (branch `main`, 24956 stars at selection).
- **Dialect manifest:** `.cursor-plugin/plugin.json` · marketplace `.cursor-plugin/marketplace.json`
- **Verdict:** **shadowed** — The scanner discovered 1 suite(s) but not through `.cursor-plugin/plugin.json`; the winning layout was claude-code.
- **Schema (plugin):** `.cursor-plugin/plugin.json` against `schemas/cursor/plugin.schema.json` — valid
- **Schema (marketplace):** `.cursor-plugin/marketplace.json` against `schemas/cursor/marketplace.schema.json` — valid
- **Scanner:** 1 suite(s); layouts `claude-code`.
- **Surfaces:** skills 35, commands 0, agents 0, mcp 0, hooks 0, lsp 0.
- **Marketplace files present:** `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `.cursor-plugin/marketplace.json`, `.kimi-plugin/marketplace.json`; productive marketplace reported by the scanner: `.claude-plugin/marketplace.json`.
- **Suites read:**
  - `compound-engineering` — layout `claude-code`, identity from `plugin.json`, surfaces skills 35, mcp 0, hooks 0, commands 0, agents 0, lsp 0.
- **Why this repository:** Ships ten dialect directories; the root plugin.json carries no $schema, so the scanner reads it leniently as the Claude layout.

### kimi

- **Repository:** [obra/superpowers](https://github.com/obra/superpowers) @ `—` (branch `main`, 283142 stars at selection).
- **Dialect manifest:** `.kimi-plugin/plugin.json`
- **Verdict:** **error** — git -C /Users/sivan/workspace/.worktrees/market-ap-namespace/node_modules/.cache/compat-report/kimi checkout failed: 致命错误：无法访问 'https://github.com/obra/superpowers.git/'：Failed to connect to github.com port 443 after 75004 ms: Couldn't connect to server 致命错误：无法从承诺者远程获取 4e3b4350d5585e4240bb48ac3378f828985f2c8c
- **Why this repository:** Ships .claude-plugin, .codex-plugin, .cursor-plugin and .kimi-plugin; the Claude manifest wins precedence.

### universal

- **Repository:** [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) @ `—` (branch `main`, 17945 stars at selection).
- **Dialect manifest:** `.plugin/plugin.json`
- **Verdict:** **error** — git clone --depth 1 --filter=blob:none --no-checkout --branch main https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering.git /Users/sivan/workspace/.worktrees/market-ap-namespace/node_modules/.cache/compat-report/universal failed: 正克隆到 '/Users/sivan/workspace/.worktrees/market-ap-namespace/node_modules/.cache/compat-report/universal'... 致命错误：无法访问 'https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering.git/'：Failed to connect to github.com port 443 after 75005 ms: Couldn't connect to server
- **Why this repository:** Ships .plugin/plugin.json with no higher-precedence root manifest, so the universal dialect is read directly.

### agent-plugins

- **Repository:** [saadeghi/daisyui](https://github.com/saadeghi/daisyui) @ `dd0a94a20ae35c7587017766cef9f0c109ff819b` (branch `master`, 42328 stars at selection).
- **Dialect manifest:** `plugin.json`
- **Verdict:** **integrated** — The scanner read `plugin.json` as the suite identity.
- **Schema (plugin):** `plugin.json` against `schemas/1.0.0/plugin.schema.json` — valid
- **Scanner:** 1 suite(s); layouts `agent-plugin-v1`.
- **Surfaces:** skills 1, commands 0, agents 0, mcp 0, hooks 0, lsp 0.
- **Marketplace files present:** `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, `.cursor-plugin/marketplace.json`; productive marketplace reported by the scanner: `.claude-plugin/marketplace.json`.
- **Suites read:**
  - `daisyui` — layout `agent-plugin-v1`, identity from `plugin.json`, surfaces skills 1, mcp 0, hooks 0, commands 0, agents 0, lsp 0.
- **Scan notes:**
  - marketplace entry "daisyui-blueprint": path "./packages/blueprint" is missing or unreadable
- **Why this repository:** Root plugin.json declares the agent-plugins.org v1.0.0 $schema; validated with the vendored schemas/1.0.0/plugin.schema.json.

### zcode

- **Repository:** [zenstory-ai/oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode) @ `fe1c133167ae758663c69bd9e5198543958c8b35` (branch `main`, 6665 stars at selection).
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

- **Repository:** [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) @ `e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156` (branch `main`, 131816 stars at selection).
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

- **Repository:** [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) @ `2c56a1b3a7b991a42858543f6086e0a4936dbf2b` (branch `main`, 70594 stars at selection).
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
