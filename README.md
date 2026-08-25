# dsh-agent-plugins-market — Claude Code plugin marketplaces for DeepSeek Harness

English | [简体中文](README.zh.md) | [Docs website](https://sivan757.github.io/dsh-agent-plugins-market/)

> **Bring the Claude Code / Codex / Cursor plugin-marketplace ecosystem into DeepSeek Harness (DSH): install and inject agent plugins — skills, MCP servers, hooks and slash commands — from git marketplace repos, with a market page right inside the Web GUI.**

**dsh-agent-plugins-market is the standard way to run Claude Code, Codex, Cursor and Kimi plugin marketplaces inside DeepSeek Harness — zero conversion, zero file copying.**

![npm](https://img.shields.io/npm/v/dsh-agent-plugins-market) ![npm downloads](https://img.shields.io/npm/dm/dsh-agent-plugins-market) ![License](https://img.shields.io/github/license/Sivan757/dsh-agent-plugins-market) ![GitHub stars](https://img.shields.io/github/stars/Sivan757/dsh-agent-plugins-market)

![Agent Plugins Market screenshot](docs/screenshot.png)

![Suite detail (skills / MCP / commands preview)](docs/screenshot-detail.png)

## Why?

DeepSeek Harness is a powerful agent harness — but its plugin ecosystem doesn't yet have the breadth of the **Claude Code plugin marketplace** world. There are hundreds of ready-made plugin marketplaces on GitHub (Claude Code `.claude-plugin/marketplace.json`, Codex `.codex-plugin`, Cursor, Kimi, agent-plugins.org v1.0.0 portable suites) full of skills, MCP servers, hooks and slash commands.

`dsh-agent-plugins-market` is the bridge: **add any git marketplace repo as a source, install its suites, and their skills / MCP servers / hooks / commands are injected into your DSH sessions at runtime** — no manual file copying, no conversion needed. Claude Code-authored skills work verbatim (`${CLAUDE_PLUGIN_ROOT}` is substituted automatically).

## Quick start

> Requires DeepSeek Harness ≥ 0.1.0-rc.6 with a Web profile.

```sh
# install into a dsh profile (npm registry, recommended)
dsh plugin --profile <name> add dsh-agent-plugins-market

# or via pnpm inside the profile
pnpm add dsh-agent-plugins-market
```

Restart dsh, open **Settings → Agent Plugins Market**, add a marketplace repo as a source (e.g. `https://github.com/anthropics/claude-plugins-official`), and install suites with one click. On legacy Web shells without the `settings.section` slot, the same UI falls back to a top-level Agent Plugins Market page entry. Skills appear in the `/` slash menu; MCP tools appear as `mcp__<suite>__<server>__<tool>`; slash commands and `/agent-*` subagents register automatically.

<details>
<summary><strong>More install options</strong></summary>

**GitHub:**

```sh
pnpm add github:Sivan757/dsh-agent-plugins-market
# or
dsh plugin --profile <name> add github:Sivan757/dsh-agent-plugins-market
```

**Manual** — add the package to the profile's `dsh.profile.bundles` (the package's `cordis.patch.yml` inserts the plugin row):

```jsonc
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": { "dsh-agent-plugins-market": "^0.4.6" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-agent-plugins-market"] } }
}
```

Build artifacts (`lib/`, `client/`) are not committed; npm publishes them via `prepack`, and GitHub installs build them automatically through the `prepare` script (requires Node + pnpm toolchain on the installing machine).

</details>

## Features

- **Plugin / suite management** — configure git repository sources (markets), browse every discoverable plugin, install / uninstall / enable / disable / refresh per source or per plugin. Source ids are derived automatically from the repository manifest JSON — no manual input.
- **Market page in the Web GUI** — source pills + search/actions, status tabs, a two-column card grid, and a plugin detail modal with previews for skills / MCP / hooks / commands / LSP. New shells render it as a localized Settings page; legacy shells without `settings.section` receive a guarded top-level page-mode fallback instead of a duplicate surface.
- **Runtime injection**
  - **Skills** — a `ctx.skills` SkillProvider (project rank 250 / user rank 450); `${CLAUDE_PLUGIN_ROOT}` is substituted so Claude Code-authored skills work verbatim, and appear in the `/` slash menu.
  - **MCP servers** — every valid `mcp.json` server of an enabled plugin mounts a live `dsh-mcp-client` child; tools appear as `mcp__<plugin>__<server>__<tool>`.
  - **Hooks** — a plugin's `hooks/hooks.json` mounts the `dsh-hooks-claude-code` bridge on the harness interception points (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart, SubagentStop).
  - **Commands / subagents** — `commands/*.md` register as dsh slash commands; `agents/*.md` register as `agent-<name>` skills.
  - **Model context** — skills flow through the host-native skill catalog and MCP tools register directly through `dsh-mcp-client`; suite inventory and source metadata remain available in the Web market page without adding a redundant model-facing inventory tool.
- **Runtime discovery** — installed plugins are discovered from configured source ids under `~/.dsh/agent-plugins/.sources/<sourceId>/` (user dimension) and `<project>/.dsh/agent-plugins/.sources/<sourceId>/` (project dimension). Stale unmanaged user checkouts are ignored, while project checkouts remain state-authorized. Local sources read the working tree directly, including uncommitted changes.
- **Native project layouts (zero-copy migration)** — a repository's own `.claude/` and `.agents/` directories (skills, agents) are discovered in place as read-only `project-native` suites: no install, no copying, no state file. Repositories migrating from Claude Code or agent-plugins.org conventions work as-is; a project skill shadows an installed suite skill of the same name (project wins).

## Supported plugin layouts

| Layout                           | Manifest                                                         | Notes                                                      |
| -------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| agent-plugins.org v1             | `plugin.json`                                                    | vendored 1.0.0 JSON Schema validation + spec §4 path rules |
| Claude Code market               | `.claude-plugin/marketplace.json` + `.claude-plugin/plugin.json` | marketplace `plugins[].source` relative paths              |
| Universal                        | `.plugin/plugin.json`                                            | multi-client repos (e.g. vercel-plugin)                    |
| Cursor                           | `.cursor-plugin/plugin.json`                                     | declared skills paths                                      |
| Kimi                             | `.kimi-plugin/plugin.json`                                       | inline mcpServers                                          |
| Codex                            | `.codex-plugin/plugin.json`                                      | —                                                          |
| Skill collection (manifest-less) | none (synthetic)                                                 | flat `SKILL.md` directory collections                      |

One repo may carry several dialects at once (vercel/vercel-plugin ships all of them); the suite identity comes from the highest-precedence manifest while surfaces are scanned from the directories. `mcp.json` is validated strictly against the agent-plugins.org schema; `.mcp.json` is parsed leniently — top-level server-map shorthand, `type: http` / `local` / omitted `type` (stdio by `command`) normalization, `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` / `${NAME:-default}` placeholders, and unknown transports are tolerated per server. The marketplace manifest is authoritative for the suite set; manifest-less marketplace entries that carry skills and manifest-bearing container dirs not listed there are supplemented. Remote URL entries show as "remote reference" cards (metadata + source URL, not directly installable; add the repo as a source to install).

## Configure marketplace sources

Sources persist in `~/.dsh/agent-plugins/state.json`; cordis config seeds them (and re-adds missing ids on every boot):

```yaml
- id: dsh-agent-plugins-market
  config:
    sources:
      - { id: agent-plugins, url: 'https://github.com/Sivan757/agent-plugins.git' }
      - { id: mattpocock-skills, url: 'https://github.com/mattpocock/skills.git' }
      - { id: claude-plugins-official, url: 'https://github.com/anthropics/claude-plugins-official' }
      - { id: ui-ux-pro-max, url: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git' }
      - { id: my-local-plugin, url: '/Users/me/work/my-plugin', local: true }
```

A `local: true` source reads the directory in place (live working tree; never deleted on removal).

## Comparison with other DSH ↔ Claude Code bridges

| Capability | **dsh-agent-plugins-market** | [dsh-skills](https://github.com/CocoSgt/dsh-skills) | [@claude2dsh/plugin](https://www.npmjs.com/package/@claude2dsh/plugin) | [@deepseek-ai/dsh-hooks-claude-code](https://github.com/deepseek-ai/deepseek-harness) |
| --- | --- | --- | --- | --- |
| Source | **any git marketplace repo** (`.claude-plugin`, `.codex-plugin`, `.cursor-plugin`, `.kimi-plugin`, agent-plugins.org v1, manifest-less skills) | `~/.claude/skills` dirs, project dirs, `.skill` packages | Claude Code sessions + skills | a Claude Code `hooks.json` config |
| Skills injection | ✅ + `/` slash menu | ✅ global skill library | ✅ | ❌ |
| MCP servers | ✅ live `dsh-mcp-client` mounts | ❌ | — | ❌ |
| Hooks | ✅ via `dsh-hooks-claude-code` bridge | ❌ | — | ✅ (direct) |
| Slash commands / subagents | ✅ `commands/*.md`, `agents/*.md` | ❌ | — | ❌ |
| Market UI | ✅ full market page in the Web GUI | ✅ settings page | — | ❌ |
| Direction | CC / Codex / Cursor ecosystem → DSH | CC skills → DSH | CC ↔ DSH session sync | config → DSH |

Want the opposite direction (dispatch work **from** Claude Code / Codex **to** DSH agents)? See [dsh-crew](https://github.com/ZSeven-W/dsh-crew).

## FAQ

### How do I install Claude Code plugins in DeepSeek Harness (DSH)?

Install this plugin in a dsh profile, then add any Claude Code marketplace repo as a source:

```sh
dsh plugin --profile <name> add dsh-agent-plugins-market
```

Then open **Settings → Agent Plugins Market** in the Web GUI, add the marketplace repo URL, and install suites with one click. Skills, MCP servers, hooks and slash commands are injected into your dsh sessions at runtime — no conversion, no file copying.

### Does DeepSeek Harness support `.claude-plugin/marketplace.json`?

Yes — through this plugin. It reads `.claude-plugin/marketplace.json` + per-plugin `.claude-plugin/plugin.json` natively, plus `.codex-plugin`, `.cursor-plugin`, `.kimi-plugin`, `.plugin` (universal) and agent-plugins.org v1.0.0 `plugin.json` manifests (see the layout table above).

### Can it inject MCP servers from a plugin suite?

Yes. Every valid `mcp.json` server of an enabled suite mounts a live `dsh-mcp-client` child, so MCP tools are callable by the DSH agent. `mcp.json` is validated strictly; `.mcp.json` is parsed leniently with placeholder support (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${NAME:-default}`).

### What about Claude Code hooks?

A suite's `hooks/hooks.json` is mounted through the official `@deepseek-ai/dsh-hooks-claude-code` bridge onto the harness interception points (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart, SubagentStop). Only the mapped command-hook subset runs — see the bridge's README for the exact mapping.

### Do Claude Code-authored skills work verbatim?

Yes. `${CLAUDE_PLUGIN_ROOT}` is substituted automatically at runtime, so Claude Code ecosystem skills run unchanged and appear in the `/` slash menu.

### dsh-agent-plugins-market vs manually copying skill files?

Manual copying breaks `${CLAUDE_PLUGIN_ROOT}` paths, skips MCP servers/hooks/commands, and gives you no update path. This plugin installs whole suites from git sources with per-plugin enable/disable/refresh, and injects every surface (skills, MCP, hooks, commands, subagents) automatically.

### Is it safe to install third-party suites?

The plugin never executes third-party code at install time: git sources clone through `execFile` (no shell), and third-party failures (broken manifests, invalid skills, escaping paths, unknown MCP transports, mount failures) are contained as per-plugin diagnostics. As with any third-party code, review a suite before enabling it.

### Is it free and open source?

Yes — MIT licensed, published on [npm](https://www.npmjs.com/package/dsh-agent-plugins-market), source on [GitHub](https://github.com/Sivan757/dsh-agent-plugins-market).

## Requirements

- `ctx.skills` (dsh-skill) is required.
- Optional peers: `@deepseek-ai/dsh-mcp-client` (MCP injection), `@deepseek-ai/dsh-hooks-claude-code` (hooks bridge); missing capabilities degrade gracefully.
- Web GUI ≥ 0.1.0-rc.6.

## Security model

- Git sources clone through `git` via `execFile` (no shell), depth 1, `--ff-only` pulls, 120s timeouts; local sources are read in place and never deleted.
- Mutating HTTP routes accept same-origin POSTs only; bodies capped at 64 KiB.
- Portable paths must start with `./` and resolve inside the plugin root (symlink escapes rejected); `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` expand.
- Third-party failures are always contained: broken manifests, invalid skills, escaping paths, unknown MCP transports, and mount failures are per-plugin diagnostics.
- An error boundary wraps the whole market section and the detail modal: any preview render failure degrades to a notice instead of crashing the UI.

## Known limitations

- Project-dimension MCP servers are not mounted (dsh has no per-session tool scope); the project dimension covers skills and context.
- Skill discovery has no file watcher: catalog changes apply after a manager action or a host restart (project-dimension snapshots are cached for 5 seconds on the skill-list hot path).
- Claude Code hooks support the mapped bridge subset; LSP is counted and previewed but not executed.
- Native project layouts (`.claude/`, `.agents/`) inject skills and subagents; their `commands/*.md` are not registered as slash commands because the harness command registry is process-scoped, not session-cwd-scoped.

## Development

```sh
pnpm install
pnpm run test        # vitest over fixture suites + multi-dialect parsing
pnpm run typecheck
pnpm run lint        # ESLint over the refactored source and tests
pnpm run format:check
pnpm run check:architecture
pnpm run check:refactor
pnpm run build       # tsc host + tsdown client + module-loader banner
pnpm pack
```

The internal modularization decision and staged migration are documented in [`docs/design/engineering-refactor-plan.md`](docs/design/engineering-refactor-plan.md) and [`docs/adr/0001-catalog-centered-modular-refactor.md`](docs/adr/0001-catalog-centered-modular-refactor.md).

The docs website lives in [`docs-site/`](docs-site/) (Astro, deployed to GitHub Pages).

## Vendored assets

The `schemas/1.0.0/` JSON Schemas are vendored from [agentplugins/agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec) (spec 1.0.0 working draft); the spec forbids fetching schemas at load time.

## Related projects

- [dsh-skills](https://github.com/CocoSgt/dsh-skills) — centralize `~/.claude/skills` and `.skill` packages into a global DSH skill library
- [@claude2dsh/plugin](https://www.npmjs.com/package/@claude2dsh/plugin) — import Claude Code sessions & skills into DSH, sync sessions back
- [dsh-crew](https://github.com/ZSeven-W/dsh-crew) — dispatch work from Claude Code / Codex to DSH agents
- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) — the DeepSeek Harness itself (official)
- [awesome-deepseek-harness-plugins](https://github.com/imsai-sh/awesome-deepseek-harness-plugins) — community DSH plugin directory

---

**If this plugin helps you, please give it a ⭐ on GitHub — it helps more people find the Claude Code ecosystem inside DeepSeek Harness.**
