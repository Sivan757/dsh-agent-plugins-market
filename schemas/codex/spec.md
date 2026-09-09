# Codex plugin and marketplace specification

Reference contract for Codex plugin repositories. Machine-readable companion: [marketplace.schema.json](marketplace.schema.json). The legacy nested manifest is described by [plugin.schema.json](plugin.schema.json); root `plugin.json` is validated by the vendored agent-plugins.org schema in [../1.0.0/plugin.schema.json](../1.0.0/plugin.schema.json).

- **Verified:** 2026-09-08 against the `openai/codex` source.
- **Evidence:** `codex-rs/core-plugins/src/manifest.rs` and `marketplace.rs`, `codex-rs/utils/plugins/src/plugin_namespace.rs`, `codex-rs/exec-server-protocol/src/protocol.rs`, `codex-rs/core-plugins/src/{installed_marketplaces,marketplace_add/source}.rs`, `codex-rs/cli/src/plugin_cmd.rs`, and the bundled `plugin-creator` skill (`plugin-json-spec.md`, `validate_plugin.py`). OpenAI's prose documentation (`developers.openai.com/plugins/build/plugins`) returns HTTP 403 to automated fetch, so every fact here rests on source.
- **Upstream JSON Schema:** none for the legacy manifest or the marketplace manifest. Root `plugin.json` uses the published agent-plugins.org v1.0.0 schema.

## Plugin manifest paths and precedence

First match wins:

| #   | Path                         | Dialect                                                                                            |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | `plugin.json`                | Agent Plugins, only when `$schema` is `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` |
| 2   | `.codex-plugin/plugin.json`  | Legacy                                                                                             |
| 3   | `.claude-plugin/plugin.json` | Legacy                                                                                             |
| 4   | `.cursor-plugin/plugin.json` | Legacy                                                                                             |

A symlinked root `plugin.json` is rejected. When path 1 wins, Codex also reads `.codex-plugin/plugin.json` as an **overlay** and takes only its `apps`, `hooks`, and `interface` values.

In the Agent Plugins dialect Codex hard-codes the component locations `./skills` and `./mcp.json` (no leading dot) and accepts only `$schema`, `name`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, and `extensions`; `repository` and `license` are parsed and discarded, and only the `com.openai` namespace of `extensions` is read.

## Legacy manifest fields (`.codex-plugin/plugin.json`)

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Falls back to the directory name; runtime pattern `[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*`. |
| `id` | string | Scaffold validator only; not read by the runtime. |
| `version` | string | Required by the validator; cachebuster form `<base>+codex.<token>`. |
| `description`, `homepage`, `repository`, `license` | string |  |
| `author` | `{name, email?, url?}` | `name` required by the validator; `url` must be absolute `https://`. |
| `keywords` | string[] |  |
| `skills` | string \| string[] | Supplements default discovery. |
| `mcpServers` | string \| object | The validator requires a path normalizing to exactly `.mcp.json`; `mcp.json` without the dot is rejected. |
| `apps` | string | Path to `.app.json`, containing `{"apps": {"<key>": {"id", "category"?}}}`. |
| `hooks` | string \| string[] \| object \| object[] | Read by the runtime; rejected by the scaffold validator. |
| `commands` | string \| string[] | Read by the runtime for command-to-skill migration; rejected by the validator. |
| `interface` | object | Required by the validator: `displayName`, `shortDescription`, `longDescription`, `developerName`, `category`, `capabilities`, `defaultPrompt` (max 3 entries, 128 chars each). Optional: `websiteURL`/`websiteUrl`, `privacyPolicyURL`, `termsOfServiceURL`, `brandColor` (`#RRGGBB`), `composerIcon`, `logo`, `logoDark`, `screenshots` (PNG under `./assets/`). |

The runtime deserializer and the scaffold validator disagree (tracked upstream as `openai/codex#27141`).

## Marketplace manifest paths and precedence

First match wins: `.agents/plugins/marketplace.json` → `.agents/plugins/api_marketplace.json` → `.claude-plugin/marketplace.json` → `.cursor-plugin/marketplace.json`.

`~/.agents/plugins/marketplace.json` is the personal marketplace and needs no explicit add. Repo and team marketplaces are opt-in. Remote sources install under `$CODEX_HOME/.tmp/marketplaces/<name>/` and are recorded in `config.toml` under `[marketplaces.<name>]` with `source_type`, `source`, `ref`, and `sparse`.

CLI: `codex plugin marketplace add <source>` / `list` / `upgrade` / `remove`; `codex plugin add PLUGIN@MARKETPLACE` / `list` / `remove`. The `add` grammar accepts `owner/repo`, any git URL, an SSH URL, or a local directory; `--ref` and `--sparse` are git-only; a file is rejected.

## Marketplace fields

Top level: `name` (required, `[A-Za-z0-9_-]+`), `plugins` (required, ordered = render order), `interface.displayName` (optional).

Entry: `name` (required; must match the folder and manifest name), `source` (required), `category`, `policy`, plus any plugin-manifest field inlined as a flattened fallback.

`policy`: `installation` (`NOT_AVAILABLE` \| `AVAILABLE` \| `INSTALLED_BY_DEFAULT`, default `AVAILABLE`), `authentication` (`ON_INSTALL` \| `ON_USE`, default `ON_INSTALL`), `products` (empty array denies every product).

Sources — a bare string is a local relative path:

| Form         | Shape                                                                        |
| ------------ | ---------------------------------------------------------------------------- |
| `local`      | `{source, path}`                                                             |
| `url`        | `{source, url, path?, ref?, sha?}`                                           |
| `git-subdir` | `{source, url, path, ref?, sha?}`                                            |
| `npm`        | `{source, package, version?, registry?}`                                     |
| `github`     | **Not supported** — the tagged enum has only Local, Url, GitSubdir, and Npm. |

GitHub shorthand `owner/repo` is normalized to `https://github.com/owner/repo.git` inside `url`/`git-subdir`.

## Directory layout

```text
<plugin-root>/
├── .codex-plugin/plugin.json          # manifest (or overlay)
├── .codex-plugin/migrated-command-skills/
├── skills/<name>/SKILL.md
├── hooks/
├── scripts/
├── assets/                            # composerIcon, logo, logoDark, screenshots
├── .mcp.json
└── .app.json
```

Codex has no LSP field and no LSP component location.

## Evidence gaps

1. OpenAI's prose documentation is not machine-readable, so no prose doc was quoted.
2. The runtime/validator disagreement on `hooks` and `commands` has no documented resolution.
3. No published schema exists for the legacy manifest or the marketplace manifest; `validate_plugin.py` claims to mirror an internal ingestion schema that is not public.
