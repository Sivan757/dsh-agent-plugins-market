# Agent roles and storage

Installed suites and user entries appear together in the Skills, Commands and Agent personas tabs. Source filters distinguish them; entries retain unique identities even when names match. Editing a managed suite entry updates its Markdown file, including YAML metadata. Upstream refreshes may replace these edits. External local source files are displayed but remain read-only; create a user entry to customize one.

Agent persona details put linked provider and model dropdowns above the Markdown editor. Providers come from DSH's live LLM registry; models load only for the selected provider. Select inheritance to use the parent session. Unavailable saved values are preserved until changed, and failed directory requests can be retried. Tools remain editable in the same frontmatter. Unknown keys, arrays and comments are preserved. Example:

```yaml
---
name: reviewer
description: Review implementation changes
model: my-provider/my-model
reasoning_effort: high
tools: [read_file, search_files]
---
Review correctness and report concrete evidence.
```

Use actual tool names available in your DSH profile. Claude Code tool names and model aliases are not automatically translated. Omit `model`, or use `inherit`, to inherit the parent model. A bare model ID must resolve uniquely from registered providers; an explicit `provider` plus `model` or `provider/model` selects that provider. `tools` and `disallowedTools` accept comma-separated strings or YAML arrays. These fields are enforced through the host subagent request, not merely inserted into the prompt.

`reasoning_effort` sets the model's reasoning intensity; `reasoningEffort` is also accepted, but conflicting values are rejected. Use an effort ID supported by the selected DSH model. The reasoning-effort selector loads the selected model\'s advertised levels and default through DSH. Selecting Automatic removes the explicit effort. Changing the provider or model through the controls clears the old effort; an unavailable saved value remains visible until changed. Inherited or unresolved models offer Automatic and any saved value, without guessing supported levels. Loading failures offer retry. Selecting a level saves `reasoning_effort` and removes the camelCase alias, while preserving unrelated frontmatter and Markdown. An omitted effort inherits the parent's latest request effort only when the effective provider/model route is unchanged; changing the route uses the new model's default effort. The host LLM runtime validates the effective provider, model and effort before a child starts. Invalid values never silently fall back to another model.

The `subagent-catalog` follows DSH's skills catalog mechanism: every `agent/pre-step` reads a current role snapshot, hashes the published entries, and compares them with the latest visible catalog in the session log. The first nonempty catalog is injected once; changes publish a complete replacement; removing all roles publishes an explicit empty catalog. Restore and fork use durable entries, and compaction that hides a catalog causes it to be republished. Incomplete reads do not publish partial replacements. The catalog includes exact IDs, titles, descriptions, configured providers/models and reasoning efforts, but never full persona bodies. It is a durable context message, not hidden storage.

`GET /api/agent-plugins/model-catalog?provider=<id>&model=<id>` resolves only that exact model through `llm.resolveModelInfo`. The response adds `reasoning: { efforts: [{ id, name, description? }], defaultEffort? }`; models without advertised reasoning return an empty effort list. Omitting `model` keeps the provider/model-list behavior. Adapter waits are bounded to ten seconds, and failures return HTTP 503.

Call `subagents_run` with `role` (an exact ID from the current catalog) and `prompt` (the complete task and required context). It replaces `market_agent`; there is no `action`, list call or old-name alias. Execution re-reads the role and installation state, resolves its model configuration, applies its persona and tool restrictions, and waits for the spawned subagent. The child does not inherit the parent conversation. The tool and catalog require host `agents`, `tools`, `llm` and `subagents` services, including the `spawn` backend for execution. Invocation incurs the selected provider's normal model usage; continuable background delegation is not implemented here.

Roles no longer register as `agent-*` or `persona-*` skills or slash commands. Ordinary skills or commands whose own names start with these prefixes remain unchanged. The catalog is visible only where this plugin's exact `subagents_run` tool is visible; hiding or replacing the tool clears a previously published catalog. Project roles are resolved from the calling session's working directory and respect `scanProjectLayouts`. UI edits and enable/disable changes appear at the next model step, not inside an already-sent request. External file discovery retains the existing scan-cache TTLs or explicit refresh; no file watcher is added.

All plugin-owned user storage is under `$DSH_HOME/agent-plugins` (default `~/.dsh/agent-plugins`): checkouts in `.sources`, installation state in `state.json`, authored entries in `user/{skills,commands,agents}`, and mutable suite data/configuration in `data`. Former `userRoot` and `dataRoot` settings are migration inputs only. Startup waits for migration of old roots, `agent-plugins-data`, and `data/user`. Conflicting files remain untouched and block activation with their paths; resolve conflicts before restarting. Project-dimension and externally registered local source directories retain their existing in-place semantics.

Model routing was informed by [DSH Subagent Model Router](https://github.com/CypherNaught-0x/DSH-Subagent-Model-Router); frontmatter follows [Claude Code subagent conventions](https://code.claude.com/docs/en/sub-agents).
