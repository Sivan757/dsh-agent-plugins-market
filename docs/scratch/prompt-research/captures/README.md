# Claude Code wire captures

Measured request bodies from Claude Code 2.1.308, captured against a local mock of the Anthropic Messages API. Pointing the real CLI at a local server is the only way to see the exact bytes the model receives, and it removes the guesswork of reading decompiled sources.

## How it was taken

There is no working upstream account in this environment, so the capture targets a mock instead of anyrouter. The mock answers every `POST /v1/messages` with a scripted SSE response, which is enough for Claude Code to build its next request with tool results, hook context, and subagent traffic.

| Step | Command                       | Purpose                                                                                                  |
| ---- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1    | `node mock-anthropic.cjs`     | Local Messages API on `127.0.0.1:8789`, writes every request body to `/tmp/cc-mock`                      |
| 2    | `01-setup.sh`                 | Fresh probe workspace: project and user CLAUDE.md, one skill, one command, one subagent, isolated config |
| 3    | `03-scenarios.sh`             | Runs scenarios 00 to 09                                                                                  |
| 4    | `04-scenarios-extra.sh`       | Resume, appended system prompt, MCP server, `/compact`                                                   |
| 5    | `05-scenarios-style-hooks.sh` | Output style, hook JSON with `additionalContext` and `permissionDecision: deny`                          |
| 6    | `06-scenarios-tools.sh`       | The task tool, a denied tool, and a tool that cannot run                                                 |

Each script does `label > /tmp/cc-mock/CURRENT` before the CLI call, so every request in `index.json` carries its scenario name. `02-run.sh` is the per-scenario runner.

## Scenarios and what each one shows

| Label            | What it exercises                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `00-empty`       | Nothing configured: the smallest first request                                            |
| `01-memory`      | User-global plus project CLAUDE.md                                                        |
| `02-bash`        | A Bash tool call and its result envelope                                                  |
| `03-plan`        | Plan mode                                                                                 |
| `04-skill`       | A skill invoked by name                                                                   |
| `05-command`     | A project slash command with an argument                                                  |
| `06-subagent`    | Subagent spawn, the subagent's own request, and the task notification back to the parent  |
| `07-hooks`       | SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop hooks, plain text output |
| `08-read`        | A Read tool result                                                                        |
| `09-compact`     | Auto-compaction forced with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`                             |
| `10-resume`      | A second user turn through `--continue`                                                   |
| `11-thinking`    | An appended system prompt line                                                            |
| `12-mcp`         | A stdio MCP server with `instructions` and one tool                                       |
| `13-compact-cmd` | The bare `/compact` command                                                               |
| `14-style`       | A configured output style                                                                 |
| `15-hook-json`   | Hook JSON: `additionalContext` and `permissionDecision: deny`                             |
| `16-todo`        | The task-tracking tool and its result                                                     |
| `17-denied`      | A permission-denied tool result (`is_error: true`)                                        |
| `18-tool-error`  | A tool that cannot run, also `is_error: true`                                             |

`index.json` is the capture index: one row per request with model, stream, block and message counts, tool names, byte size, and every tag that appears in the body.

## Files

- `text/<name>.system.txt` — the system blocks of that capture, concatenated with a separator.
- `text/<name>.messages.txt` — the messages array, one section per message, tool results unwrapped.
- `text/<name>.tools.txt` — the tool definitions as sent.

The full request bodies stay in `/tmp/cc-mock` during a session and are not committed: the tool schemas alone are about 74 KB per request, and the interesting structure is preserved in `text/`.

## Limits

The mock answers with a fixed script, so a scenario shows the request Claude Code builds, never model behaviour. A few paths stay unmeasured: the compaction summary request (the mock's usage numbers never cross the threshold), real MCP handshake failures, and any server-side feature the CLI probes before sending.

Claude Code 2.1.308 differs from the restored 2.1.88 tree in `docs/scratch/prompt-research/claude-code-prompt-architecture.md`. Where the two disagree, the capture wins: it is what the shipped version sends.
