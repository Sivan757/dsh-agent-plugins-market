# Durable Subagent Role Catalog

Status: implemented

## Context

Role skills, role slash commands and an explicit list tool duplicated the same role inventory. Loading a role as a skill could also encourage the parent to execute its instructions without applying the configured child model and tool restrictions.

## Decision

Use the DSH skills catalog publication mechanism for a separate `subagent-catalog`: compare stable entries at `agent/pre-step`, publish complete durable replacements, and recover from the visible session surface after restore, fork or compaction. Couple catalog visibility to the exact `subagent_run` tool definition. Async discovery failures preserve the last complete publication. User and project roles share parsing and retain exact source-qualified identities.

`subagent_run(agent, prompt)` resolves the saved provider, model and reasoning effort internally, validates them through the host LLM service and delegates through one-shot `spawn`. It applies persona and tool restrictions at child creation. Remove generated role skill/command registrations and the old `market_agent` tool. Reuse the existing DSH services without modifying the host.

Delegation execution and routing were revised by a later decision: see [agent role delegation over the host continuation seam](../../.agents/notes/implemented/architecture/2026-09-10-agent-role-delegation-via-host-continuation.md). The catalog, identity and parsing decisions here still hold.

## Consequences

The latest catalog replaces earlier role inventories; it is a context message rather than a system-prompt mutation. The parent receives summaries and configured model metadata, while the full persona goes to the child. Calls now require only a role ID and a complete task. There is no automatic watcher or old-name alias; continuable background mode arrived later, in the superseding decision above. Full behavior and frontmatter examples live in the bilingual [role guide](../guides/agent-roles.md) ([中文](../guides/agent-roles.zh.md)); rationale and supersession links live in the [Agent Note](../../.agents/notes/implemented/architecture/2026-09-09-subagent-catalog.md).
