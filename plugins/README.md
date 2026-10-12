# dsh-agent-plugins

First-party plugin collection for [dsh-agent-plugins-market](https://github.com/Sivan757/dsh-agent-plugins-market), the DeepSeek Harness plugin that installs agent plugins in place. Every directory under `plugins/` conforms to the [Agent Plugins v1 specification](https://agent-plugins.org/specification): a root `plugin.json`, skills under `skills/`, MCP servers in `mcp.json`, and DeepSeek Harness-specific surfaces (commands, agent roles, hooks, LSP declarations) under the `com.deepseek.harness/` extension namespace.

The repository is the authoring home for these plugins, and the market plugin ships a pre-registered source record pointing at it — a fresh install lists this collection without anyone pasting a URL.

## Plugins

### `plugin-dev` — authoring toolkit

Ported and adapted from the plugin-development toolkit of the reference ecosystem, with the skill creator and eval suites fused in. 8 skills, 1 command, 3 agent roles.

| Surface | Assets |
| --- | --- |
| Skills | `plugin-structure`, `agent-development`, `command-development`, `hook-development`, `mcp-integration`, `plugin-settings` |
| Creation + evaluation | `skill-creator` (create, improve, benchmark, and optimize skill triggering), `plugin-evals` (eval suites with graders and a no-plugin baseline) |
| Commands | `/create-plugin` |
| Agent roles | `agent-creator`, `plugin-validator`, `skill-reviewer` |

### `toolkit` — built-in toolset

Everyday capabilities for a project session. 7 skills, 5 commands, 2 agent roles.

| Surface | Assets |
| --- | --- |
| Skills | `init`, `explore`, `verify`, `simplify`, `insight` (local review of recorded sessions: a self-contained HTML dashboard and JSON report, offline and self-sufficient), `agents-md-audit` (audit and improve AGENTS.md against quality criteria), `automation-recommender` (read a codebase and recommend the hooks, skills, agents and MCP servers it needs) |
| Commands | `/code-reviewer`, `/revise-agents-md` |
| Agent roles | `code-reviewer`, `code-simplifier` |

A skill needs no separate command: each one is already a slash entry under its own name, so `/init`, `/explore`, `/verify`, `/simplify`, `/insight`, `/agents-md-audit` and `/automation-recommender` all invoke the skill directly. The two commands above exist because they do something a single skill cannot — `/code-reviewer` orchestrates two review agents over the current diff, and `/revise-agents-md` turns this session's learnings into AGENTS.md additions.

### `engineering` — engineering workflows

Workflows for building and modernizing systems. 2 skills, 11 commands, 12 agent roles, plus the workflow scripts they drive.

| Surface | Assets |
| --- | --- |
| Skills | `playground` (self-contained interactive HTML explorers), `frontend-design` (visual design direction) |
| Feature development | `/feature-dev` with the `code-explorer`, `code-architect` and `code-reviewer` agent roles |
| Legacy modernization | `/modernize-preflight`, `/modernize-assess`, `/modernize-map`, `/modernize-extract-rules`, `/modernize-brief`, `/modernize-reimagine`, `/modernize-transform`, `/modernize-uplift`, `/modernize-harden`, `/modernize-status`, driven by six workflow scripts, with eight specialized agent roles |
| Security | `security-reviewer` — reviews a diff for exploitable weaknesses and reports only high-confidence findings |

## Installing

Installing [dsh-agent-plugins-market](https://github.com/Sivan757/dsh-agent-plugins-market) is enough: the market presets a source record for this repository, so refresh that source to fetch the plugins and install them from there. Adding this repository as a source by hand works too — the path for a plugin under development, or for a market whose record was removed.

## Repository rules

- `plugins/<name>/` is one plugin: the directory itself is what the market installs, and it is authored by hand.
- `plugin.json` follows the Agent Plugins v1 schema (`$schema` names the release); the `com.deepseek.harness` namespace is declared in `extensions` and only then is the namespace directory read — see [the namespace guide](../docs/reference/harness-namespace-authoring.md).
- Skills live at `skills/<name>/SKILL.md` — one level deep, exactly as the specification fixes discovery.
- Namespaced extension surfaces: `com.deepseek.harness/commands/*.md`, `com.deepseek.harness/agents/*.md`, `com.deepseek.harness/hooks/hooks.json`, `com.deepseek.harness/lsp.json`.
- Ported content keeps its source text as the base; adaptation is mechanical only — tool names, file names, paths, frontmatter keys, and vendor wording.
- Credentials are never written as literal values; user-owned `~/.agents/mcp.json` entries reference credentials as `${NAME}`.

## License

[MIT](../LICENSE). `plugins/plugin-dev` and `plugins/engineering` port content distributed under the Apache-2.0 license — each carries that [license](plugin-dev/LICENSE) with the plugin, and the bundled `skill-creator` skill keeps [its own copy](plugins/plugin-dev/skills/skill-creator/LICENSE.txt).
