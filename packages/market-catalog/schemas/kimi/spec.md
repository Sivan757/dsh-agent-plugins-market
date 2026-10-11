# Kimi plugin and marketplace specification

Reference contract for Kimi plugin repositories. Machine-readable companions: [plugin.schema.json](plugin.schema.json) and [marketplace.schema.json](marketplace.schema.json), both describing the current **kimi-code** CLI.

- **Verified:** 2026-09-08.
- **Evidence:** `MoonshotAI/kimi-code` `docs/en/customization/plugins.md` and `packages/agent-core-v2/src/app/plugin/{manifest,types,marketplace}.ts`; `MoonshotAI/kimi-cli` `docs/en/customization/plugins.md` and `src/kimi_cli/plugin/__init__.py`.
- **Upstream JSON Schema:** none reachable. MoonshotAI's own shipped plugin declares `$schema: https://kimi.com/schemas/kimi.plugin.schema.json`, but that URL serves the Kimi homepage HTML, not a schema.
- **Critical scoping note:** MoonshotAI ships **two non-overlapping plugin systems**. `.kimi-plugin/plugin.json` is officially documented — by `kimi-code`, not by the `kimi-cli` repository that older research cites. Their field sets are disjoint.

## kimi-code (current): manifest locations

| #   | Path                       | Notes                                                                          |
| --- | -------------------------- | ------------------------------------------------------------------------------ |
| 1   | `kimi.plugin.json`         | Wins when both exist; the other becomes `shadowedManifestPath` in diagnostics. |
| 2   | `.kimi-plugin/plugin.json` | Compatibility layout.                                                          |

When neither exists, a diagnostic reports `No manifest at kimi.plugin.json or .kimi-plugin/plugin.json`.

## kimi-code plugin manifest

Required: `name` (`^[a-z0-9][a-z0-9_-]{0,63}$`, normalized to lowercase). Only `name` invalidates the manifest; every other problem degrades to a diagnostic.

| Field | Type | Notes |
| --- | --- | --- |
| `version`, `description`, `homepage`, `license` | string | Display metadata. |
| `keywords` | string[] |  |
| `author` | string \| `{name?, email?}` | A bare string is coerced to `{name}`. |
| `skills` | string \| string[] | `./`-prefixed paths that must resolve inside the plugin root; defaults to a root `SKILL.md` when present. |
| `agents` | string \| string[] | `./`-prefixed agent files; `agents/` is auto-discovered when omitted. |
| `commands` | string \| string[] | `./` directories or `.md` files exposed as `/<plugin>:<command>`. |
| `sessionStart` | `{skill}` | Loads a named plugin skill at new or resumed session start. |
| `skillInstructions` | string | Extra instructions appended whenever a plugin skill loads. |
| `systemPrompt` | string | Inline system-prompt contribution; 32 KB cap. |
| `systemPromptPath` | string | `./` path to UTF-8 text appended after `systemPrompt`; 32 KB cap; read at install or reload. |
| `mcpServers` | object | Inline server map. A `command` containing `/` must start with `./`; `cwd` must be `./`-relative. |
| `hooks` | array | Inline `{event, matcher, command, timeout}` entries. |
| `interface` | object | `displayName`, `shortDescription`, `longDescription`, `developerName`, `websiteURL`; dropped entirely when all are absent. |
| `tools`, `apps`, `inject`, `configFile`, `config_file`, `bootstrap` | — | Unsupported runtime fields; emit an `info` diagnostic and are ignored. |

Kimi declares MCP **only inline** — there is no `.mcp.json` companion file — and there is no `hooks/hooks.json` convention, no LSP support, and no component declaration fields beyond the ones above.

## kimi-code marketplace manifest

Default catalog `https://code.kimi.com/kimi-code/plugins/marketplace.json`, overridable with `KIMI_CODE_PLUGIN_MARKETPLACE_URL` or `/plugins marketplace <source>`. `http(s)://` sources are remote, `file://` is a local path, and anything else is a local path resolved against the current directory. Relative entry sources resolve against the marketplace URL when remote, or the marketplace file's directory when local.

Top level: `plugins` (required), `version` (optional, used for update checks).

| Entry field   | Type     | Notes                                                                             |
| ------------- | -------- | --------------------------------------------------------------------------------- |
| `id`          | string   | Required registration key.                                                        |
| `source`      | string   | Required. Aliases `url` and `downloadUrl` are accepted; the first non-empty wins. |
| `displayName` | string   | Falls back to `name`, then `id`; alias `name` accepted.                           |
| `tier`        | string   | `official` or `curated`.                                                          |
| `version`     | string   | Derived from a GitHub `tree`, `commit`, or `releases/tag` URL when present.       |
| `description` | string   | Alias `shortDescription` accepted.                                                |
| `homepage`    | string   | Alias `websiteURL` accepted.                                                      |
| `keywords`    | string[] |                                                                                   |
| `type`        | string   | `plugin`; legacy aliases `managed` and `guide`.                                   |
| `builtIn`     | boolean  | Declared in the TypeScript interface but not read by the parser.                  |

## kimi-cli (legacy): a different format

Root `plugin.json` is the only manifest path; there is no marketplace and no `.kimi-plugin/` support. The Pydantic model ignores unknown fields.

| Field         | Type                   | Notes                                                                                                                        |
| ------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `name`        | string                 | Required; lowercase letters, numbers, hyphens.                                                                               |
| `version`     | string                 | Required; semantic version.                                                                                                  |
| `description` | string                 | Default `""`.                                                                                                                |
| `config_file` | string                 | Credential injection target; required when `inject` is present.                                                              |
| `inject`      | object                 | Maps `target.dotted.path` to a source variable (`api_key`, `base_url`).                                                      |
| `tools`       | array                  | `{name, description, command: string[], parameters?}`; scripts read parameters as JSON on stdin and write results to stdout. |
| `runtime`     | `{host, host_version}` | Host-written after install.                                                                                                  |

Install location: `~/.kimi/plugins/<name>/`.

## Directory layout (kimi-code)

```text
<plugin-root>/
├── kimi.plugin.json            # or .kimi-plugin/plugin.json
├── skills/                     # or a root SKILL.md
├── agents/
├── commands/
├── hooks/                      # referenced by the inline hooks array
└── SYSTEM.md                   # via systemPromptPath
```

## Evidence gaps

1. The `$schema` URI declared by MoonshotAI's own plugin does not resolve to a schema.
2. Whether kimi-code also reads a plain root `plugin.json` is unverified.
3. The legacy `kimi-cli` has no marketplace.
4. `builtIn` has no observed effect.
