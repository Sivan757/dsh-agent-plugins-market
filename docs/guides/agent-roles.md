# Agent roles and storage

Installed suites and user entries appear together in the Skills, Commands and Agent personas tabs. Source filters distinguish them; entries retain unique identities even when names match. Editing a managed suite entry updates its Markdown file, including YAML metadata. Upstream refreshes may replace these edits. External local source files are displayed but remain read-only; create a user entry to customize one.

Agent persona details put linked provider and model dropdowns above the Markdown editor. Providers come from DSH's live LLM registry; models load only for the selected provider. Select inheritance to use the parent session. Unavailable saved values are preserved until changed, and failed directory requests can be retried. Tools remain editable in the same frontmatter. Unknown keys, arrays and comments are preserved. Example:

```yaml
---
name: reviewer
description: Review implementation changes
model: my-provider/my-model
tools: [read_file, search_files]
---
Review correctness and report concrete evidence.
```

Use actual tool names available in your DSH profile. Claude Code tool names and model aliases are not automatically translated. Omit `model`, or use `inherit`, to inherit the parent model. A bare model ID must resolve uniquely from registered providers; an explicit `provider` plus `model` or `provider/model` selects that provider. `tools` and `disallowedTools` accept comma-separated strings or YAML arrays. These fields are enforced through the host subagent request, not merely inserted into the prompt.

The `market_agent` tool lists enabled roles (`action: list`) and runs one (`action: run`, `role`, `prompt`). Use the exact identity returned by the list. Execution re-reads the file and installation state, applies the role body as the persona, and waits for the spawned subagent. It requires the host `tools`, `llm`, and `subagents` services; unavailable models, invalid metadata, and disabled roles return errors. Execution incurs the selected provider's normal model usage.

All plugin-owned user storage is under `$DSH_HOME/agent-plugins` (default `~/.dsh/agent-plugins`): checkouts in `.sources`, installation state in `state.json`, authored entries in `user/{skills,commands,agents}`, and mutable suite data/configuration in `data`. Former `userRoot` and `dataRoot` settings are migration inputs only. Startup waits for migration of old roots, `agent-plugins-data`, and `data/user`. Conflicting files remain untouched and block activation with their paths; resolve conflicts before restarting. Project-dimension and externally registered local source directories retain their existing in-place semantics.

Model routing was informed by [DSH Subagent Model Router](https://github.com/CypherNaught-0x/DSH-Subagent-Model-Router); frontmatter follows [Claude Code subagent conventions](https://code.claude.com/docs/en/sub-agents).
