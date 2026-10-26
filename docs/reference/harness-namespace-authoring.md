# The com.deepseek.harness namespace

Agent Plugins v1 fixes a suite's component set to two types — skills (`skills/<name>/SKILL.md`) and MCP servers (`mcp.json`) — and closes the manifest. Everything else a DeepSeek Harness session consumes (slash commands, agent roles, hooks, LSP declarations, per-server MCP policy) rides the suite's **client extension namespace** under [Agent Plugins specification](https://agent-plugins.org/specification) §8: manifest data in `plugin.json` → `extensions["com.deepseek.harness"]`, files in the top-level `com.deepseek.harness/` directory. The authoritative contract lives in the market plugin's [`schemas/com.deepseek.harness/spec.md`](https://github.com/Sivan757/dsh-agent-plugins-market/blob/dev/packages/market-catalog/schemas/com.deepseek.harness/spec.md); this page is the authoring guide for suite repositories.

## Opening the namespace

Both seats open only when the manifest declares the namespace with a supported contract version:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "my-suite",
  "version": "1.0.0",
  "description": "...",
  "extensions": {
    "com.deepseek.harness": { "schemaVersion": "1.0.0" }
  }
}
```

Without the declaration (or with an unsupported version) the suite still loads — the portable core (`skills/`, `mcp.json`) works everywhere — but the namespace directory is ignored with a scan note.

## Directory layout

```text
my-suite/
├── plugin.json
├── mcp.json                      # portable (optional; skills-only is conformant)
├── skills/<name>/SKILL.md        # portable, one level deep
└── com.deepseek.harness/
    ├── commands/*.md             # slash commands
    ├── agents/*.md               # agent role cards
    ├── hooks/hooks.json          # command hooks (event table)
    └── lsp.json                  # LSP server declarations
```

## Component contracts

### Commands — `com.deepseek.harness/commands/*.md`

Frontmatter: `description` (required, shown in the command list), `argument-hint` (optional input placeholder), `arguments` (optional declared argument names, as one space-separated string or a list). Body is the prompt delivered to the model. The invocation text splits on whitespace, with a quoted phrase kept whole, and fills `$ARGUMENTS` (the whole text), `$1` to `$9` (one word each in order) and each declared name (`$system` for `arguments: system`). A declared name the text does not fill expands to nothing and the reply names it, and a body with no placeholder at all receives the text after one blank line as `User input: <text>`. One command per file, file name = command name.

```markdown
---
description: Deploy the current branch
argument-hint: [environment]
---

Deploy to $ARGUMENTS following the release checklist.
```

### Agent roles — `com.deepseek.harness/agents/*.md`

Frontmatter: `name` (kebab-case, 3–50 chars), `description` (when to delegate), optional `model` + `provider` (an exact pair routes the child's model; anything else inherits the parent), optional `reasoningEffort`, optional `disabled: true`. Body is the agent's system prompt and must be self-contained.

### Hooks — `com.deepseek.harness/hooks/hooks.json`

Event table keyed by lifecycle event names. Recognized events: `PreToolUse`, `PostToolUse`, `SessionStart`, `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop`. Values expand `${PLUGIN_ROOT}` (suite install directory) and `${PLUGIN_DATA}` (per-suite persistent data directory).

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "${PLUGIN_ROOT}/scripts/guard.sh" }] }]
  }
}
```

### LSP — `com.deepseek.harness/lsp.json`

An `lspServers` table (or a bare server map). Each entry requires `command` (executable, no spaces; flags go in `args`) and `extensionToLanguage` (file extension → LSP language ID). Optional: `env`, `initializationOptions`, `settings`, `workspaceFolder`, `startupTimeoutMs`.

```json
{
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensionToLanguage": { ".ts": "typescript", ".tsx": "typescript" }
    }
  }
}
```

### Per-server MCP policy — manifest `extensions["com.deepseek.harness"].mcpServers`

Client policy keyed by the server's own `mcp.json` name; the portable file stays schema-clean. Carries `auth` (OAuth authorization), `enabledTools` / `disabledTools`, `startupTimeoutMs`, `toolCallTimeoutMs`. This seat is also where credential references (`${NAME}`) are allowed — the portable `mcp.json` keeps every other `${VAR}` literal by specification (§9.2).

```json
{
  "extensions": {
    "com.deepseek.harness": {
      "schemaVersion": "1.0.0",
      "mcpServers": {
        "search": { "auth": { "enabled": true }, "toolCallTimeoutMs": 45000 }
      }
    }
  }
}
```

## Failure behavior

| Situation                                                                        | Behavior                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `schemaVersion` missing or unsupported                                           | Namespace seats skipped; portable core loads; scan note |
| One command / agent / hook / LSP entry invalid                                   | That entry skipped with a diagnostic; the rest load     |
| Path resolves outside the suite root                                             | That path rejected                                      |
| Root-level `commands/`, `agents/`, `hooks/`, `.mcp.json` (outside the namespace) | Reported as unread for this dialect                     |

## Worked example

The [plugin-dev plugin](https://github.com/Sivan757/dsh-agent-plugins/tree/main/plugins/plugin-dev) declares the namespace and ships one command and three agent roles; the [toolkit plugin](https://github.com/Sivan757/dsh-agent-plugins/tree/main/plugins/toolkit) ships five commands and two agent roles; the [engineering plugin](https://github.com/Sivan757/dsh-agent-plugins/tree/main/plugins/engineering) ships eleven commands and twelve agent roles, and drives its workflow scripts through `${PLUGIN_ROOT}` — the [dsh-agent-plugins](https://github.com/Sivan757/dsh-agent-plugins) repository doubles as the reference implementation.
