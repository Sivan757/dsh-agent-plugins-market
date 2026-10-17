# ZCode (Z.ai) plugin and marketplace specification

Reference contract for ZCode-compatible plugin repositories. Machine-readable companions: [plugin.schema.json](plugin.schema.json) and [marketplace.schema.json](marketplace.schema.json).

- **Verified:** 2026-09-08 against ZCode 3.11.2.
- **Evidence:** official authoring page `https://zcode.z.ai/en/docs/plugin`; official marketplace repository [`zai-org/zcode-plugins`](https://github.com/zai-org/zcode-plugins) (`marketplace.json`, `docs/distribution.md`, `docs/PLUGIN_DEVELOPMENT.md`, `scripts/validate.py`, `plugins/example-plugin`); shipped runtime constants and on-disk install state under `~/.zcode/cli/plugins/`.
- **Upstream JSON Schema:** none. The docs page contains no `$schema`; the repository ships a hand-written `scripts/validate.py`, not a schema. The schemas in this directory are authored, not vendored.
- **Spec status:** no cross-vendor alignment. ZCode is not listed among agent-plugins.org compatible clients and does not read root `plugin.json` or `mcp.json`.

## Manifest locations and precedence

| Artifact | Lookup order | Evidence |
| --- | --- | --- |
| Plugin manifest | `.zcode-plugin/plugin.json` → `.claude-plugin/plugin.json` → `.codex-plugin/plugin.json` | Docs (first two) + runtime (`findPluginManifestPath`); `.cursor-plugin/plugin.json` appears only in the skill-adapter candidate list |
| Marketplace manifest | explicit `path` from a `github`/`git` source → `.claude-plugin/marketplace.json` → `marketplace.json` | Runtime `Nit()`; there is no `.zcode-plugin/marketplace.json` |
| MCP configuration | `.mcp.json` only; inline manifest `mcpServers` is merged over it per server key | Runtime `EN()`; bare `mcp.json` has zero occurrences in the runtime |
| Hooks configuration | `hooks/hooks.json` | Docs; runtime `join('hooks', 'hooks.json')` |

When no manifest exists and the marketplace entry sets `strict: false`, ZCode synthesizes a manifest from the entry and writes `.claude-plugin/plugin.json` into the install target. Otherwise a missing manifest is a hard error.

## Plugin manifest (`plugin.json`)

Required: `name`. `name` must match `^[a-z0-9][a-z0-9._-]{0,127}$`; the runtime defaults `version` to `0.0.0`.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Plugin identifier; regex above. |
| `version` | string | The official validator requires it to equal the marketplace entry version. |
| `description` | string | English compatibility fallback. |
| `description_i18n` | `{locale: string}` | Not in the docs field table, but required per plugin by the official validator (`en` + `zh-CN`) and must equal the marketplace entry. |
| `author` | string \| `{name, email, url}` |  |
| `homepage`, `repository`, `license`, `keywords` | string / string / string / string[] | `license` is an SPDX id. |
| `commands`, `skills`, `agents`, `hooks`, `mcpServers` | string \| string[] \| object | Paths resolve against the plugin root; `mcpServers` also accepts inline server maps, which win per key over `.mcp.json`. |
| `dependencies` | string[] | `name` or `name@marketplace`. |
| `userConfig` | object | Prompted at enable time; see below. |
| `channels`, `lspServers`, `outputStyles`, `settings` | any | Registered but **diagnostic-only** in the observed runtime: a warning is emitted and the field is not executed. |

`userConfig` entries are strict: `{type?: 'string'|'number'|'boolean'|'directory'|'file', title?, description?, default?: string|number|boolean, required?, sensitive?}`. A `required: true` entry without a default emits a diagnostic. Values are referenced as `${user_config.<key>}`.

## Marketplace manifest (`marketplace.json`)

Required: `name` and `plugins`. The official validator additionally requires `owner` and a top-level `description` plus `description_i18n` with `en` and `zh-CN`.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string |  |
| `description`, `description_i18n` | string, `{locale: string}` |  |
| `owner` | `{name, url}` | Required by the validator; absent from the docs field table. |
| `plugins` | array \| object map | Documented as an array; the runtime also accepts an object keyed by plugin name. |
| `pluginRoot` | string | Documented at the top level; the runtime reads `metadata.pluginRoot` and only surfaces a top-level value on already-normalized manifests. Which wins for a hand-written manifest is unverified. |
| `metadata` | `{description?, pluginRoot?, version?}` | Runtime fallback location for `pluginRoot`. |
| `allowCrossMarketplaceDependenciesOn` | string[] |  |
| `featured` | string[] | Read by the runtime normalizer; undocumented. |
| `version` | number | Seen in per-plugin payload manifests. |

Entry fields (documented): `name`, `source`, `description`, `version`, `category`, `tags`, `dependencies`, `strict`. The official category set is `developer-tools`, `productivity`, `utilities`, `guides`, `finance`, `template`, `other` — the docs example uses `demo`, which fails the validator. `version` drives update checks while the installed version comes from the plugin's own manifest, so both must be bumped.

Entry fields read by the runtime but absent from every field table: `displayName`, `displayName_i18n`, `description_i18n`, `icon`, `author`/`authorUrl`, `homepage`, `privacyPolicy`, `termsOfService`, `heroImage`, `examplePrompts`, `examplePrompts_i18n`, `requiresPaidPlan`, `cachePath`, `keywords`, `_artifact`.

## Plugin sources

| Form                                                                    | Meaning                                                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `"./plugins/hello"`                                                     | Subdirectory relative to the marketplace root.                                                    |
| `{source: 'directory', path}`                                           | Local absolute directory.                                                                         |
| `{source: 'github', repo, path?, ref?}`                                 | GitHub repository, optionally a subdirectory.                                                     |
| `{source: 'git', url, path?, ref?}`                                     | Any Git repository.                                                                               |
| `{source: 'git-subdir', url, path, ref?}`                               | Runtime-only; undocumented.                                                                       |
| `{source: 'file', path}`                                                | Local manifest file.                                                                              |
| `{source: 'url', url, headers?}`                                        | Remote JSON.                                                                                      |
| `{source: 'url', type: 'zip', url, sha256, path, stripRoot?, headers?}` | Verified archive install: `sha256` is mandatory 64-character lowercase hex and HTTPS is enforced. |
| `{source: 'npm', package}`                                              | Documented, but the runtime warns "recognized but not supported in V1 install".                   |

## Public distribution format

A distribution source exposes a static layout under a base URL: `marketplace.json`, `assets/<plugin>/icon.png`, and `plugins/<plugin>/<version>/plugin.zip`. The marketplace entry carries the archive as `source: {source: 'url', type: 'zip', url, sha256, path}` plus an `_artifact: {path, sha256, size}` block whose `path` is relative to the base URL. Installation fetches the catalog, downloads the archive, verifies SHA-256, extracts the declared directory, and records the version. Plugin versions are immutable.

## Directory layout

```text
my-plugin/
├── .zcode-plugin/plugin.json   # manifest (only required file)
├── commands/*.md               # slash commands; $ARGUMENTS, $1, $2
├── skills/<name>/SKILL.md      # name + description (<=1024 chars)
├── agents/*.md                 # name + description; body is the system prompt
├── hooks/hooks.json            # SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, Stop
└── .mcp.json                   # MCP declarations
```

Recognized root entries: `.mcp.json`, `.zcode-plugin`, `README.md`, `agents`, `commands`, `dist`, `docs`, `hooks`, `output-styles`, `package.json`, `scripts`, `skills`, `templates`. `output-styles/` is recognized while the `outputStyles` field is diagnostic-only, and `workflows` is not a plugin component directory.

Placeholders: `${ZCODE_PLUGIN_ROOT}` (alias `${CLAUDE_PLUGIN_ROOT}`), `${ZCODE_PLUGIN_DATA}`, `${ZCODE_PROJECT_DIR}` / `${CLAUDE_PROJECT_DIR}`, `${user_config.<key>}`. Official artifacts use both the `ZCODE_` and `CLAUDE_` spellings, so the canonical form is unverified.

## Evidence gaps

1. `pluginRoot`: top-level (docs) versus `metadata.pluginRoot` (runtime).
2. `plugins` as an object map is undocumented.
3. `npm`/`pip` sources are documented but non-functional in the observed runtime; `git-subdir` is implemented but undocumented.
4. `agents` is documented and appears in status records, yet one external-source compatibility report lists it as diagnostic-only.
5. `output-styles/` versus diagnostic-only `outputStyles`; `workflows` is not a plugin surface.
6. Marketplace listing fields (`displayName`, `icon`, `requiresPaidPlan`, `examplePrompts`, …) are runtime-read and used by the official market but appear in no field table.
7. The docs example category `demo` is outside the official validator's set.
